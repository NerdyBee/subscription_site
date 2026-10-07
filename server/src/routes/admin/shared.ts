import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../db';
import { DAY_MS } from '../../lib/format';

export const nairaToKobo = z.coerce
  .number()
  .nonnegative()
  .transform((n) => Math.round(n * 100));

export const tempPassword = () => crypto.randomBytes(6).toString('base64url');

export type ServiceStatus = 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'SUSPENDED' | 'NO_SUBSCRIPTION';
export const EXPIRING_DAYS = 7;

/** Bulk version of the per-customer status logic in customerOverview, for lists and stats. */
export async function serviceStatusIndex(now = new Date()) {
  const [customers, live, everSubscribed] = await Promise.all([
    prisma.customer.findMany({ select: { id: true, status: true, officeId: true } }),
    prisma.subscription.findMany({
      where: { status: 'ACTIVE', expiresAt: { gt: now } },
      select: { customerId: true, startsAt: true, expiresAt: true, plan: { select: { name: true } } },
    }),
    prisma.subscription.groupBy({ by: ['customerId'] }),
  ]);
  const had = new Set(everSubscribed.map((s) => s.customerId));
  const index = new Map<
    string,
    { status: ServiceStatus; planName: string | null; coverageEnd: Date | null; daysRemaining: number; officeId: string | null }
  >();

  for (const c of customers) {
    const subs = live.filter((s) => s.customerId === c.id);
    const current = subs.find((s) => s.startsAt <= now);
    const end = subs.reduce<Date | null>((acc, s) => (!acc || s.expiresAt > acc ? s.expiresAt : acc), null);
    const daysRemaining = end ? Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS)) : 0;
    let status: ServiceStatus;
    if (c.status === 'SUSPENDED') status = 'SUSPENDED';
    else if (current) status = daysRemaining <= EXPIRING_DAYS ? 'EXPIRING' : 'ACTIVE';
    else status = had.has(c.id) ? 'EXPIRED' : 'NO_SUBSCRIPTION';
    index.set(c.id, { status, planName: current?.plan.name ?? null, coverageEnd: end, daysRemaining, officeId: c.officeId });
  }
  return index;
}
