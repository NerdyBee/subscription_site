import { Router } from 'express';
import { prisma } from '../../db';
import { paymentView } from '../../services/views';
import { accountNo } from '../../lib/format';
import { serviceStatusIndex } from './shared';
import { expireDueSubscriptions, sendExpiryReminders } from '../../services/subscriptions';
import { audit } from '../../lib/audit';

export const dashboardRouter = Router();

const monthStart = (d: Date, offset = 0) => new Date(d.getFullYear(), d.getMonth() + offset, 1);

dashboardRouter.get('/stats', async (_req, res) => {
  const now = new Date();
  const index = await serviceStatusIndex(now);
  const counts = { ACTIVE: 0, EXPIRING: 0, EXPIRED: 0, SUSPENDED: 0, NO_SUBSCRIPTION: 0 };
  const connectedOffices = new Set<string>();
  for (const v of index.values()) {
    counts[v.status]++;
    if ((v.status === 'ACTIVE' || v.status === 'EXPIRING') && v.officeId) connectedOffices.add(v.officeId);
  }

  const sixMonthsAgo = monthStart(now, -5);
  const [paidInvoices, pendingPayments, unpaidInvoices, openTickets, networkTodo, recentPayments] = await Promise.all([
    prisma.invoice.findMany({
      where: { status: 'PAID', paidAt: { gte: sixMonthsAgo } },
      select: { amountKobo: true, paidAt: true },
    }),
    prisma.payment.count({ where: { status: 'PENDING' } }),
    prisma.invoice.count({ where: { status: 'UNPAID' } }),
    prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
    prisma.$queryRaw<[{ n: bigint }]>`SELECT COUNT(*) AS n FROM "NetworkAccount" WHERE "desiredEnabled" <> "enabled"`,
    prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { invoice: { include: { plan: true } }, customer: true },
    }),
  ]);

  const revenueByMonth = Array.from({ length: 6 }, (_, i) => {
    const start = monthStart(now, i - 5);
    const end = monthStart(now, i - 4);
    const total = paidInvoices
      .filter((inv) => inv.paidAt! >= start && inv.paidAt! < end)
      .reduce((sum, inv) => sum + inv.amountKobo, 0);
    const month = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
    return { month, totalKobo: total };
  });

  res.json({
    customers: { total: index.size, ...counts },
    activeSubscribers: counts.ACTIVE + counts.EXPIRING,
    officesConnected: connectedOffices.size,
    revenueThisMonthKobo: revenueByMonth[5].totalKobo,
    revenueByMonth,
    pendingPayments,
    unpaidInvoices,
    openTickets,
    networkTodo: Number(networkTodo[0].n),
    recentPayments: recentPayments.map((p) => ({
      ...paymentView(p),
      customer: { id: p.customer.id, companyName: p.customer.companyName, accountNo: accountNo(p.customer.seq) },
    })),
  });
});

dashboardRouter.post('/jobs/run', async (req, res) => {
  const expired = await expireDueSubscriptions();
  const reminders = await sendExpiryReminders();
  await audit(req.auth!.userId, 'jobs.run', 'System', null, { expired, reminders });
  res.json({ expired, reminders });
});

dashboardRouter.get('/audit', async (_req, res) => {
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { actor: { select: { name: true, email: true, role: true } } },
  });
  res.json(logs);
});
