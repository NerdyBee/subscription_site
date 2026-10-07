import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../db';
import { audit } from '../../lib/audit';
import { addDays, fmtDate, invoiceNo, naira } from '../../lib/format';
import { badRequest, notFound } from '../../lib/http';
import { notify } from '../../services/notify';
import { activateInvoice, coverageEnd, currentSubscription, syncAccess } from '../../services/subscriptions';
import {
  customerOverview,
  customerView,
  invoiceView,
  paymentView,
  subscriptionView,
  ticketView,
} from '../../services/views';
import { nairaToKobo, serviceStatusIndex, tempPassword, type ServiceStatus } from './shared';

export const customersRouter = Router();

customersRouter.get('/', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const status = String(req.query.status ?? '') as ServiceStatus | '';
  const customers = await prisma.customer.findMany({
    where: q
      ? {
          OR: [
            { companyName: { contains: q, mode: 'insensitive' } },
            { contactName: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
            { user: { email: { contains: q, mode: 'insensitive' } } },
            { office: { unit: { contains: q, mode: 'insensitive' } } },
            ...(/^\d+$/.test(q.replace(/^net-?/i, '')) ? [{ seq: Number(q.replace(/^net-?/i, '')) }] : []),
          ],
        }
      : undefined,
    include: { office: true, user: { select: { email: true } }, network: true },
    orderBy: { companyName: 'asc' },
  });
  const index = await serviceStatusIndex();
  const rows = customers
    .map((c) => ({
      ...customerView(c),
      service: index.get(c.id)!,
      network: c.network ? { enabled: c.network.enabled, desiredEnabled: c.network.desiredEnabled } : null,
    }))
    .filter((r) => !status || r.service.status === status);
  res.json(rows);
});

const createSchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  contactName: z.string().trim().min(2).max(120),
  email: z.email().trim().toLowerCase(),
  phone: z.string().trim().min(7).max(20),
  whatsapp: z.string().trim().max(20).optional().or(z.literal('')),
  officeId: z.string().optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional(),
});

customersRouter.post('/', async (req, res) => {
  const body = createSchema.parse(req.body);
  const password = tempPassword();
  const user = await prisma.user.create({
    data: {
      email: body.email,
      name: body.contactName,
      phone: body.phone,
      passwordHash: await bcrypt.hash(password, 10),
      customer: {
        create: {
          companyName: body.companyName,
          contactName: body.contactName,
          phone: body.phone,
          whatsapp: body.whatsapp || body.phone,
          officeId: body.officeId || null,
          notes: body.notes || null,
        },
      },
    },
    include: { customer: true },
  });
  await audit(req.auth!.userId, 'customer.create', 'Customer', user.customer!.id, { email: body.email });
  res.status(201).json({ id: user.customer!.id, tempPassword: password });
});

customersRouter.get('/:id', async (req, res) => {
  const id = req.params.id;
  const overview = await customerOverview(id);
  const [subscriptions, invoices, payments, tickets] = await Promise.all([
    prisma.subscription.findMany({ where: { customerId: id }, orderBy: { startsAt: 'desc' }, include: { plan: true } }),
    prisma.invoice.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' }, include: { plan: true } }),
    prisma.payment.findMany({
      where: { customerId: id },
      orderBy: { createdAt: 'desc' },
      include: { invoice: { include: { plan: true } } },
    }),
    prisma.supportTicket.findMany({ where: { customerId: id }, orderBy: { updatedAt: 'desc' } }),
  ]);
  const user = await prisma.customer.findUniqueOrThrow({
    where: { id },
    select: { user: { select: { lastLoginAt: true, isActive: true } } },
  });
  res.json({
    ...overview,
    lastLoginAt: user.user.lastLoginAt,
    subscriptions: subscriptions.map(subscriptionView),
    invoices: invoices.map(invoiceView),
    payments: payments.map(paymentView),
    tickets: tickets.map(ticketView),
  });
});

const updateSchema = createSchema.omit({ email: true }).partial();

customersRouter.patch('/:id', async (req, res) => {
  const body = updateSchema.parse(req.body);
  const customer = await prisma.customer.update({
    where: { id: req.params.id },
    data: {
      ...body,
      whatsapp: body.whatsapp === '' ? null : body.whatsapp,
      officeId: body.officeId === '' ? null : body.officeId,
    },
  });
  if (body.contactName || body.phone) {
    await prisma.user.update({
      where: { id: customer.userId },
      data: { name: body.contactName, phone: body.phone },
    });
  }
  await audit(req.auth!.userId, 'customer.update', 'Customer', customer.id, body);
  res.json({ ok: true });
});

customersRouter.post('/:id/suspend', async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().max(500).optional() }).parse(req.body ?? {});
  const customer = await prisma.customer.update({ where: { id: req.params.id }, data: { status: 'SUSPENDED' } });
  await syncAccess(customer.id);
  await audit(req.auth!.userId, 'customer.suspend', 'Customer', customer.id, { reason });
  await notify(customer.userId, 'Your service has been suspended', reason || 'Please contact support for details.');
  res.json({ ok: true });
});

customersRouter.post('/:id/reactivate', async (req, res) => {
  const customer = await prisma.customer.update({ where: { id: req.params.id }, data: { status: 'ACTIVE' } });
  await syncAccess(customer.id);
  await audit(req.auth!.userId, 'customer.reactivate', 'Customer', customer.id);
  await notify(customer.userId, 'Your service has been restored', 'Your account is active again.');
  res.json({ ok: true });
});

customersRouter.post('/:id/reset-password', async (req, res) => {
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: req.params.id } });
  const password = tempPassword();
  await prisma.user.update({
    where: { id: customer.userId },
    data: { passwordHash: await bcrypt.hash(password, 10), tokenVersion: { increment: 1 } },
  });
  await audit(req.auth!.userId, 'customer.reset_password', 'Customer', customer.id);
  res.json({ tempPassword: password });
});

const extendSchema = z.object({
  days: z.coerce.number().int().min(1).max(366),
  planId: z.string().optional(),
  reason: z.string().trim().min(2).max(500),
});

/** Free days (outage compensation, goodwill, etc). Extends the latest period, or starts one. */
customersRouter.post('/:id/extend', async (req, res) => {
  const body = extendSchema.parse(req.body);
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: req.params.id } });
  const now = new Date();
  const latest = await prisma.subscription.findFirst({
    where: { customerId: customer.id, status: 'ACTIVE', expiresAt: { gt: now } },
    orderBy: { expiresAt: 'desc' },
  });
  let expiresAt: Date;
  if (latest) {
    expiresAt = addDays(latest.expiresAt, body.days);
    await prisma.subscription.update({ where: { id: latest.id }, data: { expiresAt } });
  } else {
    const planId =
      body.planId ??
      (await prisma.subscription.findFirst({ where: { customerId: customer.id }, orderBy: { expiresAt: 'desc' } }))?.planId;
    if (!planId) throw badRequest('Choose a package for this customer’s first subscription');
    expiresAt = addDays(now, body.days);
    await prisma.subscription.create({ data: { customerId: customer.id, planId, startsAt: now, expiresAt } });
  }
  await syncAccess(customer.id);
  await audit(req.auth!.userId, 'subscription.extend', 'Customer', customer.id, { days: body.days, reason: body.reason });
  await notify(
    customer.userId,
    `${body.days} day${body.days > 1 ? 's' : ''} added to your subscription`,
    `Your internet now runs until ${fmtDate(expiresAt)}. ${body.reason}`,
  );
  res.json({ ok: true, expiresAt });
});

/** Switch the plan of the running period (e.g. an immediate upgrade). Billing is handled separately. */
customersRouter.post('/:id/change-plan', async (req, res) => {
  const { planId } = z.object({ planId: z.string() }).parse(req.body);
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) throw notFound('Package not found');
  const current = await currentSubscription(req.params.id);
  if (!current) throw badRequest('This customer has no running subscription. Record a payment instead.');
  await prisma.subscription.update({ where: { id: current.id }, data: { planId } });
  await audit(req.auth!.userId, 'subscription.change_plan', 'Subscription', current.id, {
    from: current.plan.name,
    to: plan.name,
  });
  res.json({ ok: true });
});

const recordSchema = z.object({
  invoiceId: z.string().optional(),
  planId: z.string().optional(),
  amount: nairaToKobo.optional(),
  method: z.enum(['BANK_TRANSFER', 'CASH', 'POS', 'OTHER']),
  transferRef: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

/** Payment received outside the portal (cash, direct transfer). Activates immediately. */
customersRouter.post('/:id/record-payment', async (req, res) => {
  const body = recordSchema.parse(req.body);
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: req.params.id } });
  const actor = req.auth!.userId;

  const result = await prisma.$transaction(async (tx) => {
    let invoice;
    if (body.invoiceId) {
      invoice = await tx.invoice.findFirst({ where: { id: body.invoiceId, customerId: customer.id }, include: { plan: true } });
      if (!invoice) throw notFound('Invoice not found');
      if (invoice.status === 'PAID' || invoice.status === 'CANCELLED') throw badRequest('Invoice is not open');
      // Any receipt the customer uploaded for it is superseded by this confirmation.
      await tx.payment.updateMany({
        where: { invoiceId: invoice.id, status: 'PENDING' },
        data: { status: 'APPROVED', reviewedById: actor, reviewedAt: new Date() },
      });
    } else {
      if (!body.planId) throw badRequest('Choose a package');
      const plan = await tx.plan.findUniqueOrThrow({ where: { id: body.planId } });
      // A fresh payment replaces whatever the customer had left open.
      await tx.invoice.updateMany({
        where: { customerId: customer.id, status: 'UNPAID' },
        data: { status: 'CANCELLED' },
      });
      invoice = await tx.invoice.create({
        data: { customerId: customer.id, planId: plan.id, amountKobo: body.amount ?? plan.priceKobo },
        include: { plan: true },
      });
    }
    const alreadyApproved = await tx.payment.count({ where: { invoiceId: invoice.id, status: 'APPROVED' } });
    if (!alreadyApproved) {
      await tx.payment.create({
        data: {
          invoiceId: invoice.id,
          customerId: customer.id,
          amountKobo: body.amount ?? invoice.amountKobo,
          method: body.method,
          status: 'APPROVED',
          transferRef: body.transferRef || null,
          note: body.note || null,
          recordedById: actor,
          reviewedById: actor,
          reviewedAt: new Date(),
        },
      });
    }
    const sub = await activateInvoice(tx, invoice.id, actor);
    await audit(actor, 'payment.record', 'Invoice', invoice.id, { method: body.method }, tx);
    return { invoice, sub };
  });

  await syncAccess(customer.id);
  await notify(
    customer.userId,
    'Payment received — thank you!',
    `We received ${naira(result.invoice.amountKobo)} for ${result.invoice.plan.name} (${invoiceNo(result.invoice.seq)}). Your internet runs until ${fmtDate(result.sub.expiresAt)}.`,
  );
  res.json({ ok: true, expiresAt: result.sub.expiresAt });
});

customersRouter.post('/:id/subscriptions/:subId/cancel', async (req, res) => {
  const sub = await prisma.subscription.findFirst({ where: { id: req.params.subId, customerId: req.params.id } });
  if (!sub) throw notFound('Subscription not found');
  await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'CANCELLED' } });
  await syncAccess(sub.customerId);
  await audit(req.auth!.userId, 'subscription.cancel', 'Subscription', sub.id);
  res.json({ ok: true, coverageEnd: await coverageEnd(sub.customerId) });
});
