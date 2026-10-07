import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { accountNo, addDays, DAY_MS, fmtDate, invoiceNo } from '../lib/format';
import { badRequest } from '../lib/http';
import { audit } from '../lib/audit';
import { getSettings } from '../lib/settings';
import { getNetworkAdapter } from '../network/adapter';
import { notify } from './notify';

type Tx = Prisma.TransactionClient;

/** The subscription period covering `now`, if any. */
export function currentSubscription(customerId: string, now = new Date(), tx: Tx | typeof prisma = prisma) {
  return tx.subscription.findFirst({
    where: { customerId, status: 'ACTIVE', startsAt: { lte: now }, expiresAt: { gt: now } },
    orderBy: { expiresAt: 'desc' },
    include: { plan: true },
  });
}

/** When the customer's paid-up time runs out (including renewals queued after the current period). */
export async function coverageEnd(customerId: string, now = new Date(), tx: Tx | typeof prisma = prisma) {
  const last = await tx.subscription.findFirst({
    where: { customerId, status: 'ACTIVE', expiresAt: { gt: now } },
    orderBy: { expiresAt: 'desc' },
    select: { expiresAt: true },
  });
  return last?.expiresAt ?? null;
}

/**
 * Marks an invoice paid and creates the subscription period for it.
 * Renewing while still active stacks the new period after the current one, so no paid days are lost.
 */
export async function activateInvoice(tx: Tx, invoiceId: string, actorId: string | null) {
  const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { plan: true } });
  if (invoice.status === 'PAID') throw badRequest('Invoice is already paid');
  if (invoice.status === 'CANCELLED') throw badRequest('Invoice was cancelled');

  const now = new Date();
  const end = await coverageEnd(invoice.customerId, now, tx);
  const startsAt = end && end > now ? end : now;
  const expiresAt = addDays(startsAt, invoice.plan.durationDays);

  await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'PAID', paidAt: now } });
  const sub = await tx.subscription.create({
    data: { customerId: invoice.customerId, planId: invoice.planId, invoiceId: invoice.id, startsAt, expiresAt },
  });
  await audit(actorId, 'subscription.activate', 'Subscription', sub.id, { invoice: invoiceNo(invoice.seq) }, tx);
  return sub;
}

function randomPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(8), (b) => alphabet[b % alphabet.length]).join('');
}

export async function ensureNetworkAccount(customerId: string) {
  const existing = await prisma.networkAccount.findUnique({ where: { customerId } });
  if (existing) return existing;
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
  return prisma.networkAccount.create({
    data: { customerId, username: accountNo(customer.seq).replace('-', '').toLowerCase(), password: randomPassword() },
  });
}

/** Recompute whether the customer should have internet and push it to the network adapter. */
export async function syncAccess(customerId: string) {
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
  const sub = await currentSubscription(customerId);
  const desired = customer.status === 'ACTIVE' && !!sub;

  const account = await ensureNetworkAccount(customerId);
  const adapter = getNetworkAdapter();
  let applied = false;
  if (adapter.automatic && account.enabled !== desired) {
    try {
      applied = await adapter.setAccess(account, desired);
    } catch (err) {
      console.error(`[network] ${adapter.name} failed for ${account.username}`, err);
    }
  }
  return prisma.networkAccount.update({
    where: { id: account.id },
    data: {
      desiredEnabled: desired,
      ...(applied ? { enabled: desired, lastSyncedAt: new Date() } : {}),
    },
  });
}

/** Flip finished periods to EXPIRED and cut access. Safe to run repeatedly. */
export async function expireDueSubscriptions() {
  const now = new Date();
  const due = await prisma.subscription.findMany({
    where: { status: 'ACTIVE', expiresAt: { lte: now } },
    include: { customer: true, plan: true },
  });
  if (!due.length) return 0;
  await prisma.subscription.updateMany({ where: { id: { in: due.map((s) => s.id) } }, data: { status: 'EXPIRED' } });

  const customers = new Map(due.map((s) => [s.customerId, s]));
  for (const [customerId, sub] of customers) {
    const account = await syncAccess(customerId);
    if (!account.desiredEnabled) {
      await notify(
        sub.customer.userId,
        'Your internet subscription has expired',
        `Your ${sub.plan.name} plan expired on ${fmtDate(sub.expiresAt)}. Renew from your dashboard to reconnect.`,
        `expired:${sub.id}`,
      );
    }
  }
  return due.length;
}

/** One reminder per configured threshold (e.g. 7, 3 and 1 days before coverage ends). */
export async function sendExpiryReminders() {
  const { reminderDays } = await getSettings();
  if (!reminderDays.length) return 0;
  const thresholds = [...new Set(reminderDays)].sort((a, b) => a - b);
  const maxDays = thresholds[thresholds.length - 1];
  const now = new Date();

  const active = await prisma.subscription.findMany({
    where: { status: 'ACTIVE', expiresAt: { gt: now } },
    orderBy: { expiresAt: 'desc' },
    distinct: ['customerId'],
    include: { customer: true, plan: true },
  });

  let sent = 0;
  for (const sub of active) {
    if (sub.customer.status !== 'ACTIVE') continue;
    const daysLeft = Math.ceil((sub.expiresAt.getTime() - now.getTime()) / DAY_MS);
    if (daysLeft > maxDays) continue;
    const threshold = thresholds.find((t) => daysLeft <= t)!;
    const created = await notify(
      sub.customer.userId,
      daysLeft <= 1 ? 'Your internet expires tomorrow' : `Your internet expires in ${daysLeft} days`,
      `Your ${sub.plan.name} subscription ends on ${fmtDate(sub.expiresAt)}. Renew now to avoid disconnection.`,
      `remind:${sub.customerId}:${sub.expiresAt.toISOString()}:${threshold}`,
    );
    if (created) sent++;
  }
  return sent;
}
