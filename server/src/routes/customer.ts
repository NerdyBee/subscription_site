import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireCustomer } from '../lib/auth';
import { badRequest, notFound } from '../lib/http';
import { audit } from '../lib/audit';
import { invoiceNo, naira } from '../lib/format';
import { proofUpload } from '../lib/uploads';
import { notifyStaff } from '../services/notify';
import { customerOverview, invoiceView, paymentView, subscriptionView, ticketView } from '../services/views';

export const customerRouter = Router();
customerRouter.use(requireAuth, requireCustomer);

const cid = (req: Express.Request) => req.auth!.customerId!;

customerRouter.get('/overview', async (req, res) => {
  res.json(await customerOverview(cid(req)));
});

const profileSchema = z.object({
  contactName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(20),
  whatsapp: z.string().trim().max(20).optional().or(z.literal('')),
});

customerRouter.patch('/profile', async (req, res) => {
  const body = profileSchema.parse(req.body);
  await prisma.customer.update({
    where: { id: cid(req) },
    data: { contactName: body.contactName, phone: body.phone, whatsapp: body.whatsapp || null },
  });
  await prisma.user.update({ where: { id: req.auth!.userId }, data: { name: body.contactName, phone: body.phone } });
  res.json(await customerOverview(cid(req)));
});

customerRouter.get('/subscriptions', async (req, res) => {
  const subs = await prisma.subscription.findMany({
    where: { customerId: cid(req) },
    orderBy: { startsAt: 'desc' },
    include: { plan: true },
  });
  res.json(subs.map(subscriptionView));
});

// ---- Invoices & payments -------------------------------------------------------------

customerRouter.get('/invoices', async (req, res) => {
  const invoices = await prisma.invoice.findMany({
    where: { customerId: cid(req) },
    orderBy: { createdAt: 'desc' },
    include: { plan: true, payments: { orderBy: { createdAt: 'desc' } } },
  });
  res.json(invoices.map(invoiceView));
});

customerRouter.get('/invoices/:id', async (req, res) => {
  const invoice = await prisma.invoice.findFirst({
    where: { id: req.params.id, customerId: cid(req) },
    include: { plan: true, payments: { orderBy: { createdAt: 'desc' } }, subscription: true },
  });
  if (!invoice) throw notFound('Invoice not found');
  res.json({
    ...invoiceView(invoice),
    subscription: invoice.subscription
      ? { startsAt: invoice.subscription.startsAt, expiresAt: invoice.subscription.expiresAt }
      : null,
  });
});

customerRouter.post('/invoices', async (req, res) => {
  const { planId } = z.object({ planId: z.string() }).parse(req.body);
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: cid(req) } });
  if (customer.status === 'SUSPENDED') throw badRequest('Your account is suspended. Please contact support.');
  const plan = await prisma.plan.findFirst({ where: { id: planId, isActive: true } });
  if (!plan) throw notFound('That package is no longer available');

  // Only one open invoice at a time keeps the admin queue clean; picking another plan replaces it.
  const open = await prisma.invoice.findFirst({
    where: { customerId: customer.id, status: { in: ['UNPAID', 'PENDING_VERIFICATION'] } },
    include: { plan: true },
  });
  if (open?.status === 'PENDING_VERIFICATION') {
    throw badRequest(`We're still confirming your payment for ${invoiceNo(open.seq)}. Please wait for it to be verified.`);
  }
  if (open && open.planId === plan.id && open.amountKobo === plan.priceKobo) {
    res.json(invoiceView(open));
    return;
  }
  if (open) await prisma.invoice.update({ where: { id: open.id }, data: { status: 'CANCELLED' } });

  const invoice = await prisma.invoice.create({
    data: { customerId: customer.id, planId: plan.id, amountKobo: plan.priceKobo },
    include: { plan: true },
  });
  await audit(req.auth!.userId, 'invoice.create', 'Invoice', invoice.id, { plan: plan.name });
  res.status(201).json(invoiceView(invoice));
});

customerRouter.post('/invoices/:id/cancel', async (req, res) => {
  const invoice = await prisma.invoice.findFirst({ where: { id: req.params.id, customerId: cid(req) } });
  if (!invoice) throw notFound('Invoice not found');
  if (invoice.status !== 'UNPAID') throw badRequest('Only unpaid invoices can be cancelled');
  await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'CANCELLED' } });
  res.json({ ok: true });
});

const paymentSchema = z.object({
  senderName: z.string().trim().min(2).max(120),
  senderBank: z.string().trim().max(80).optional(),
  transferRef: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

customerRouter.post('/invoices/:id/payments', proofUpload.single('proof'), async (req, res) => {
  const body = paymentSchema.parse(req.body);
  const invoice = await prisma.invoice.findFirst({
    where: { id: req.params.id as string, customerId: cid(req) },
    include: { customer: true, plan: true },
  });
  if (!invoice) throw notFound('Invoice not found');
  if (invoice.status !== 'UNPAID') throw badRequest('This invoice is not awaiting payment');

  const payment = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.create({
      data: {
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        amountKobo: invoice.amountKobo,
        method: 'BANK_TRANSFER',
        senderName: body.senderName,
        senderBank: body.senderBank || null,
        transferRef: body.transferRef || null,
        note: body.note || null,
        proofPath: req.file?.filename ?? null,
      },
    });
    await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'PENDING_VERIFICATION' } });
    await audit(req.auth!.userId, 'payment.submit', 'Payment', p.id, { invoice: invoiceNo(invoice.seq) }, tx);
    return p;
  });

  await notifyStaff(
    'Payment awaiting confirmation',
    `${invoice.customer.companyName} says they paid ${naira(invoice.amountKobo)} for ${invoice.plan.name} (${invoiceNo(invoice.seq)}).`,
  );
  res.status(201).json(paymentView(payment));
});

customerRouter.get('/payments', async (req, res) => {
  const payments = await prisma.payment.findMany({
    where: { customerId: cid(req) },
    orderBy: { createdAt: 'desc' },
    include: { invoice: { include: { plan: true } } },
  });
  res.json(payments.map(paymentView));
});

// ---- Support -------------------------------------------------------------------------

customerRouter.get('/tickets', async (req, res) => {
  const tickets = await prisma.supportTicket.findMany({ where: { customerId: cid(req) }, orderBy: { updatedAt: 'desc' } });
  res.json(tickets.map(ticketView));
});

const ticketSchema = z.object({
  subject: z.string().trim().min(3).max(150),
  body: z.string().trim().min(3).max(4000),
});

customerRouter.post('/tickets', async (req, res) => {
  const body = ticketSchema.parse(req.body);
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: cid(req) } });
  const ticket = await prisma.supportTicket.create({
    data: {
      customerId: customer.id,
      subject: body.subject,
      messages: { create: { authorId: req.auth!.userId, body: body.body } },
    },
  });
  await notifyStaff('New support request', `${customer.companyName}: ${body.subject}`);
  res.status(201).json(ticketView(ticket));
});

customerRouter.get('/tickets/:id', async (req, res) => {
  const ticket = await prisma.supportTicket.findFirst({
    where: { id: req.params.id, customerId: cid(req) },
    include: { messages: { orderBy: { createdAt: 'asc' }, include: { author: { select: { name: true, role: true } } } } },
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

customerRouter.post('/tickets/:id/messages', async (req, res) => {
  const { body } = z.object({ body: z.string().trim().min(1).max(4000) }).parse(req.body);
  const ticket = await prisma.supportTicket.findFirst({
    where: { id: req.params.id, customerId: cid(req) },
    include: { customer: true },
  });
  if (!ticket) throw notFound('Ticket not found');
  await prisma.$transaction([
    prisma.ticketMessage.create({ data: { ticketId: ticket.id, authorId: req.auth!.userId, body } }),
    prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { status: ticket.status === 'RESOLVED' || ticket.status === 'CLOSED' ? 'OPEN' : ticket.status },
    }),
  ]);
  await notifyStaff('Support reply', `${ticket.customer.companyName} replied on "${ticket.subject}"`);
  res.status(201).json({ ok: true });
});
