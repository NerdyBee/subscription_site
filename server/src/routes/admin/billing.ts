import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { audit } from '../../lib/audit';
import { accountNo, fmtDate, invoiceNo, naira } from '../../lib/format';
import { badRequest, notFound } from '../../lib/http';
import { notify } from '../../services/notify';
import { activateInvoice, syncAccess } from '../../services/subscriptions';
import { invoiceView, paymentView, planView, subscriptionView } from '../../services/views';
import { nairaToKobo } from './shared';

export const billingRouter = Router();

const customerRef = (c: { id: string; seq: number; companyName: string }) => ({
  id: c.id,
  companyName: c.companyName,
  accountNo: accountNo(c.seq),
});

// ---- Plans ---------------------------------------------------------------------------

billingRouter.get('/plans', async (_req, res) => {
  const plans = await prisma.plan.findMany({
    orderBy: [{ sortOrder: 'asc' }, { priceKobo: 'asc' }],
    include: { _count: { select: { subscriptions: true } } },
  });
  res.json(plans.map((p) => ({ ...planView(p), subscriptionCount: p._count.subscriptions })));
});

const planSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional().or(z.literal('')),
  speed: z.string().trim().min(1).max(60),
  durationDays: z.coerce.number().int().min(1).max(366),
  price: nairaToKobo,
  features: z.array(z.string().trim().min(1).max(100)).max(12).default([]),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  sortOrder: z.coerce.number().int().default(0),
});

const planData = ({ price, description, ...rest }: z.infer<typeof planSchema>) => ({
  ...rest,
  description: description || null,
  priceKobo: price,
});

billingRouter.post('/plans', async (req, res) => {
  const plan = await prisma.plan.create({ data: planData(planSchema.parse(req.body)) });
  await audit(req.auth!.userId, 'plan.create', 'Plan', plan.id, { name: plan.name });
  res.status(201).json(planView(plan));
});

billingRouter.put('/plans/:id', async (req, res) => {
  const plan = await prisma.plan.update({ where: { id: req.params.id }, data: planData(planSchema.parse(req.body)) });
  await audit(req.auth!.userId, 'plan.update', 'Plan', plan.id, { name: plan.name });
  res.json(planView(plan));
});

billingRouter.delete('/plans/:id', async (req, res) => {
  const used = await prisma.invoice.count({ where: { planId: req.params.id } });
  if (used) throw badRequest('This package has invoices. Hide it instead of deleting it.');
  await prisma.plan.delete({ where: { id: req.params.id } });
  await audit(req.auth!.userId, 'plan.delete', 'Plan', req.params.id);
  res.json({ ok: true });
});

// ---- Payments ------------------------------------------------------------------------

billingRouter.get('/payments', async (req, res) => {
  const status = z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional().parse(req.query.status || undefined);
  const payments = await prisma.payment.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: status === 'PENDING' ? 'asc' : 'desc' },
    take: 300,
    include: { invoice: { include: { plan: true } }, customer: true },
  });
  res.json(payments.map((p) => ({ ...paymentView(p), customer: customerRef(p.customer) })));
});

billingRouter.post('/payments/:id/approve', async (req, res) => {
  const actor = req.auth!.userId;
  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: req.params.id },
      include: { invoice: { include: { plan: true } }, customer: true },
    });
    if (!payment) throw notFound('Payment not found');
    if (payment.status !== 'PENDING') throw badRequest('This payment has already been reviewed');
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'APPROVED', reviewedById: actor, reviewedAt: new Date() },
    });
    const sub = await activateInvoice(tx, payment.invoiceId, actor);
    await audit(actor, 'payment.approve', 'Payment', payment.id, { invoice: invoiceNo(payment.invoice.seq) }, tx);
    return { payment, sub };
  });

  const { payment, sub } = result;
  await syncAccess(payment.customerId);
  await notify(
    payment.customer.userId,
    'Payment confirmed — you’re connected!',
    `We confirmed ${naira(payment.amountKobo)} for ${payment.invoice.plan.name}. Your subscription runs ${fmtDate(sub.startsAt)} – ${fmtDate(sub.expiresAt)}.`,
  );
  res.json({ ok: true });
});

billingRouter.post('/payments/:id/reject', async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
  const payment = await prisma.payment.findUnique({ where: { id: req.params.id }, include: { customer: true, invoice: true } });
  if (!payment) throw notFound('Payment not found');
  if (payment.status !== 'PENDING') throw badRequest('This payment has already been reviewed');
  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'REJECTED', rejectReason: reason, reviewedById: req.auth!.userId, reviewedAt: new Date() },
    }),
    prisma.invoice.update({ where: { id: payment.invoiceId }, data: { status: 'UNPAID' } }),
  ]);
  await audit(req.auth!.userId, 'payment.reject', 'Payment', payment.id, { reason });
  await notify(
    payment.customer.userId,
    'We could not confirm your payment',
    `${invoiceNo(payment.invoice.seq)}: ${reason}. You can submit the payment details again from your dashboard.`,
  );
  res.json({ ok: true });
});

// ---- Invoices & subscriptions ----------------------------------------------------------

billingRouter.get('/invoices', async (req, res) => {
  const status = z
    .enum(['UNPAID', 'PENDING_VERIFICATION', 'PAID', 'CANCELLED'])
    .optional()
    .parse(req.query.status || undefined);
  const invoices = await prisma.invoice.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 300,
    include: { plan: true, customer: true },
  });
  res.json(invoices.map((i) => ({ ...invoiceView(i), customer: customerRef(i.customer) })));
});

billingRouter.post('/invoices/:id/cancel', async (req, res) => {
  const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
  if (!invoice) throw notFound('Invoice not found');
  if (invoice.status === 'PAID') throw badRequest('Paid invoices cannot be cancelled');
  await prisma.$transaction([
    prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'CANCELLED' } }),
    prisma.payment.updateMany({
      where: { invoiceId: invoice.id, status: 'PENDING' },
      data: { status: 'REJECTED', rejectReason: 'Invoice cancelled', reviewedById: req.auth!.userId, reviewedAt: new Date() },
    }),
  ]);
  await audit(req.auth!.userId, 'invoice.cancel', 'Invoice', invoice.id);
  res.json({ ok: true });
});

billingRouter.get('/subscriptions', async (req, res) => {
  const filter = String(req.query.filter ?? 'active');
  const now = new Date();
  const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const where =
    filter === 'expiring'
      ? { status: 'ACTIVE' as const, expiresAt: { gt: now, lte: soon } }
      : filter === 'expired'
        ? { status: 'EXPIRED' as const }
        : filter === 'all'
          ? {}
          : { status: 'ACTIVE' as const, expiresAt: { gt: now } };
  const subs = await prisma.subscription.findMany({
    where,
    orderBy: { expiresAt: filter === 'expired' || filter === 'all' ? 'desc' : 'asc' },
    take: 300,
    include: { plan: true, customer: true },
  });
  res.json(subs.map((s) => ({ ...subscriptionView(s), customer: customerRef(s.customer) })));
});
