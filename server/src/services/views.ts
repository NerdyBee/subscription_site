import type { Customer, Invoice, Office, Payment, Plan, Subscription, SupportTicket, User } from '@prisma/client';
import { prisma } from '../db';
import { accountNo, DAY_MS, invoiceNo, ticketNo } from '../lib/format';
import { notFound } from '../lib/http';
import { coverageEnd, currentSubscription } from './subscriptions';

// Shapes sent to the client. Kept in one place so customer and admin views agree.

export const planView = (p: Plan) => ({
  id: p.id,
  name: p.name,
  description: p.description,
  speed: p.speed,
  durationDays: p.durationDays,
  priceKobo: p.priceKobo,
  features: p.features,
  isActive: p.isActive,
  isFeatured: p.isFeatured,
  sortOrder: p.sortOrder,
});

export const customerView = (c: Customer & { office?: Office | null; user?: Pick<User, 'email'> }) => ({
  id: c.id,
  accountNo: accountNo(c.seq),
  companyName: c.companyName,
  contactName: c.contactName,
  phone: c.phone,
  whatsapp: c.whatsapp,
  email: c.user?.email,
  status: c.status,
  notes: c.notes,
  office: c.office ? { id: c.office.id, unit: c.office.unit, floor: c.office.floor, block: c.office.block } : null,
  createdAt: c.createdAt,
});

export const subscriptionView = (s: Subscription & { plan: Plan }) => ({
  id: s.id,
  status: s.status,
  startsAt: s.startsAt,
  expiresAt: s.expiresAt,
  plan: { id: s.plan.id, name: s.plan.name, speed: s.plan.speed, priceKobo: s.plan.priceKobo, durationDays: s.plan.durationDays },
  invoiceId: s.invoiceId,
  createdAt: s.createdAt,
});

export const paymentView = (p: Payment & { invoice?: Invoice & { plan?: Plan } }) => ({
  id: p.id,
  invoiceId: p.invoiceId,
  invoiceNo: p.invoice ? invoiceNo(p.invoice.seq) : undefined,
  planName: p.invoice?.plan?.name,
  amountKobo: p.amountKobo,
  method: p.method,
  status: p.status,
  senderName: p.senderName,
  senderBank: p.senderBank,
  transferRef: p.transferRef,
  hasProof: !!p.proofPath,
  note: p.note,
  rejectReason: p.rejectReason,
  reviewedAt: p.reviewedAt,
  createdAt: p.createdAt,
});

export const invoiceView = (i: Invoice & { plan: Plan; payments?: Payment[] }) => ({
  id: i.id,
  number: invoiceNo(i.seq),
  status: i.status,
  amountKobo: i.amountKobo,
  plan: { id: i.plan.id, name: i.plan.name, speed: i.plan.speed, durationDays: i.plan.durationDays },
  paidAt: i.paidAt,
  createdAt: i.createdAt,
  payments: i.payments?.map((p) => paymentView(p)),
});

export const ticketView = (t: SupportTicket & { customer?: Customer }) => ({
  id: t.id,
  number: ticketNo(t.seq),
  subject: t.subject,
  status: t.status,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
  customer: t.customer ? { id: t.customer.id, companyName: t.customer.companyName, accountNo: accountNo(t.customer.seq) } : undefined,
});

/** Everything the customer dashboard (and the admin's customer page header) needs. */
export async function customerOverview(customerId: string) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: { office: true, user: { select: { email: true } }, network: true },
  });
  if (!customer) throw notFound('Customer not found');

  const now = new Date();
  const [current, end, upcoming, lastSub, recentPayments, openInvoice] = await Promise.all([
    currentSubscription(customerId, now),
    coverageEnd(customerId, now),
    prisma.subscription.findMany({
      where: { customerId, status: 'ACTIVE', startsAt: { gt: now } },
      orderBy: { startsAt: 'asc' },
      include: { plan: true },
    }),
    prisma.subscription.findFirst({ where: { customerId }, orderBy: { expiresAt: 'desc' }, include: { plan: true } }),
    prisma.payment.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { invoice: { include: { plan: true } } },
    }),
    prisma.invoice.findFirst({
      where: { customerId, status: { in: ['UNPAID', 'PENDING_VERIFICATION'] } },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    }),
  ]);

  const daysRemaining = end ? Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS)) : 0;
  const serviceStatus =
    customer.status === 'SUSPENDED' ? 'SUSPENDED' : current ? 'ACTIVE' : lastSub ? 'EXPIRED' : 'NO_SUBSCRIPTION';

  return {
    customer: customerView(customer),
    serviceStatus,
    current: current ? subscriptionView(current) : null,
    lastPlan: lastSub ? subscriptionView(lastSub).plan : null,
    coverageEnd: end,
    daysRemaining,
    upcoming: upcoming.map(subscriptionView),
    network: customer.network
      ? {
          username: customer.network.username,
          password: customer.network.password,
          enabled: customer.network.enabled,
          desiredEnabled: customer.network.desiredEnabled,
        }
      : null,
    recentPayments: recentPayments.map(paymentView),
    openInvoice: openInvoice ? invoiceView(openInvoice) : null,
  };
}
