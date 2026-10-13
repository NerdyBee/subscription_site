import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../db';
import { audit } from '../../lib/audit';
import { requireRole } from '../../lib/auth';
import { accountNo, stringList } from '../../lib/format';
import { badRequest, notFound } from '../../lib/http';
import { getSettings, saveSettings, settingsSchema } from '../../lib/settings';
import { getNetworkAdapter } from '../../network/adapter';
import { notify } from '../../services/notify';
import { ensureNetworkAccount, syncAccess } from '../../services/subscriptions';
import { ticketView } from '../../services/views';
import { tempPassword } from './shared';

export const opsRouter = Router();

// ---- Network access ------------------------------------------------------------------

opsRouter.get('/network', async (req, res) => {
  // Make sure every customer has an access account so nobody is missing from the list.
  const missing = await prisma.customer.findMany({ where: { network: null }, select: { id: true } });
  for (const c of missing) await syncAccess(c.id);

  const todoOnly = req.query.todo === '1';
  const accounts = await prisma.networkAccount.findMany({
    include: { customer: { include: { office: true } } },
    orderBy: { customer: { companyName: 'asc' } },
  });
  const adapter = getNetworkAdapter();
  res.json({
    adapter: { name: adapter.name, automatic: adapter.automatic },
    accounts: accounts
      .filter((a) => !todoOnly || a.enabled !== a.desiredEnabled)
      .map((a) => ({
        id: a.id,
        username: a.username,
        password: a.password,
        macAddresses: stringList(a.macAddresses),
        enabled: a.enabled,
        desiredEnabled: a.desiredEnabled,
        lastSyncedAt: a.lastSyncedAt,
        notes: a.notes,
        customer: {
          id: a.customer.id,
          companyName: a.customer.companyName,
          accountNo: accountNo(a.customer.seq),
          office: a.customer.office?.unit ?? null,
        },
      })),
  });
});

const networkSchema = z.object({
  enabled: z.boolean().optional(),
  username: z.string().trim().min(3).max(60).optional(),
  password: z.string().trim().min(4).max(60).optional(),
  macAddresses: z.array(z.string().trim().regex(/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/, 'invalid MAC address')).optional(),
  notes: z.string().trim().max(1000).optional(),
});

/** The admin confirms what they did on the router (or edits the access credentials). */
opsRouter.patch('/network/:id', async (req, res) => {
  const body = networkSchema.parse(req.body);
  const account = await prisma.networkAccount.update({
    where: { id: req.params.id },
    data: { ...body, ...(body.enabled !== undefined ? { lastSyncedAt: new Date() } : {}) },
  });
  await audit(req.auth!.userId, 'network.update', 'NetworkAccount', account.id, body);
  res.json({ ok: true });
});

opsRouter.post('/network/customer/:customerId/regenerate', async (req, res) => {
  const account = await ensureNetworkAccount(req.params.customerId);
  const password = tempPassword().slice(0, 8);
  await prisma.networkAccount.update({ where: { id: account.id }, data: { password } });
  await audit(req.auth!.userId, 'network.reset_password', 'NetworkAccount', account.id);
  res.json({ password });
});

// ---- Offices -------------------------------------------------------------------------

opsRouter.get('/offices', async (_req, res) => {
  const offices = await prisma.office.findMany({
    orderBy: { unit: 'asc' },
    include: { customers: { select: { id: true, companyName: true, seq: true } } },
  });
  res.json(
    offices.map((o) => ({
      ...o,
      customers: o.customers.map((c) => ({ id: c.id, companyName: c.companyName, accountNo: accountNo(c.seq) })),
    })),
  );
});

const officeSchema = z.object({
  unit: z.string().trim().min(1).max(40),
  floor: z.string().trim().max(40).optional().or(z.literal('')),
  block: z.string().trim().max(40).optional().or(z.literal('')),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
});

const officeData = (b: z.infer<typeof officeSchema>) => ({
  unit: b.unit,
  floor: b.floor || null,
  block: b.block || null,
  notes: b.notes || null,
});

opsRouter.post('/offices', async (req, res) => {
  const office = await prisma.office.create({ data: officeData(officeSchema.parse(req.body)) });
  await audit(req.auth!.userId, 'office.create', 'Office', office.id, { unit: office.unit });
  res.status(201).json(office);
});

opsRouter.put('/offices/:id', async (req, res) => {
  const office = await prisma.office.update({ where: { id: req.params.id }, data: officeData(officeSchema.parse(req.body)) });
  await audit(req.auth!.userId, 'office.update', 'Office', office.id, { unit: office.unit });
  res.json(office);
});

opsRouter.delete('/offices/:id', async (req, res) => {
  await prisma.office.delete({ where: { id: req.params.id } });
  await audit(req.auth!.userId, 'office.delete', 'Office', req.params.id);
  res.json({ ok: true });
});

// ---- Support tickets -----------------------------------------------------------------

opsRouter.get('/tickets', async (req, res) => {
  const status = z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional().parse(req.query.status || undefined);
  const tickets = await prisma.supportTicket.findMany({
    where: status ? { status } : undefined,
    orderBy: { updatedAt: 'desc' },
    take: 300,
    include: { customer: true },
  });
  res.json(tickets.map(ticketView));
});

opsRouter.get('/tickets/:id', async (req, res) => {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: req.params.id },
    include: {
      customer: true,
      messages: { orderBy: { createdAt: 'asc' }, include: { author: { select: { name: true, role: true } } } },
    },
  });
  if (!ticket) throw notFound('Ticket not found');
  res.json({
    ...ticketView(ticket),
    messages: ticket.messages.map((m) => ({
      id: m.id,
      body: m.body,
      createdAt: m.createdAt,
      authorName: m.author.name,
      fromStaff: m.author.role !== 'CUSTOMER',
    })),
  });
});

opsRouter.post('/tickets/:id/messages', async (req, res) => {
  const body = z
    .object({
      body: z.string().trim().min(1).max(4000),
      status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
    })
    .parse(req.body);
  const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id }, include: { customer: true } });
  if (!ticket) throw notFound('Ticket not found');
  await prisma.$transaction([
    prisma.ticketMessage.create({ data: { ticketId: ticket.id, authorId: req.auth!.userId, body: body.body } }),
    prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { status: body.status ?? (ticket.status === 'OPEN' ? 'IN_PROGRESS' : ticket.status) },
    }),
  ]);
  await notify(ticket.customer.userId, `Support replied: ${ticket.subject}`, body.body.slice(0, 200));
  res.status(201).json({ ok: true });
});

opsRouter.patch('/tickets/:id', async (req, res) => {
  const { status } = z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']) }).parse(req.body);
  await prisma.supportTicket.update({ where: { id: req.params.id }, data: { status } });
  await audit(req.auth!.userId, 'ticket.status', 'SupportTicket', req.params.id, { status });
  res.json({ ok: true });
});

// ---- Settings & staff (super admin) --------------------------------------------------

opsRouter.get('/settings', async (_req, res) => {
  res.json(await getSettings());
});

opsRouter.put('/settings', requireRole('SUPER_ADMIN'), async (req, res) => {
  const saved = await saveSettings(settingsSchema.parse(req.body));
  await audit(req.auth!.userId, 'settings.update', 'Setting', 'site');
  res.json(saved);
});

opsRouter.get('/staff', requireRole('SUPER_ADMIN'), async (_req, res) => {
  const staff = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, email: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
  });
  res.json(staff);
});

const staffSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().trim().toLowerCase(),
  role: z.enum(['ADMIN', 'SUPER_ADMIN']),
});

opsRouter.post('/staff', requireRole('SUPER_ADMIN'), async (req, res) => {
  const body = staffSchema.parse(req.body);
  const password = tempPassword();
  const user = await prisma.user.create({
    data: { ...body, passwordHash: await bcrypt.hash(password, 10) },
  });
  await audit(req.auth!.userId, 'staff.create', 'User', user.id, { email: body.email, role: body.role });
  res.status(201).json({ id: user.id, tempPassword: password });
});

opsRouter.patch('/staff/:id', requireRole('SUPER_ADMIN'), async (req, res) => {
  const body = z.object({ isActive: z.boolean().optional(), role: z.enum(['ADMIN', 'SUPER_ADMIN']).optional() }).parse(req.body);
  const id = String(req.params.id);
  if (id === req.auth!.userId) throw badRequest('You cannot change your own access');
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role === 'CUSTOMER') throw notFound('Staff member not found');
  await prisma.user.update({
    where: { id: user.id },
    data: { ...body, ...(body.isActive === false ? { tokenVersion: { increment: 1 } } : {}) },
  });
  await audit(req.auth!.userId, 'staff.update', 'User', user.id, body);
  res.json({ ok: true });
});
