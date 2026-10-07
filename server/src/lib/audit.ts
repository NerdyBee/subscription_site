import type { Prisma } from '@prisma/client';
import { prisma } from '../db';

type Tx = Prisma.TransactionClient | typeof prisma;

export function audit(
  actorId: string | null | undefined,
  action: string,
  entity: string,
  entityId?: string | null,
  meta?: Prisma.InputJsonValue,
  tx: Tx = prisma,
) {
  return tx.auditLog.create({ data: { actorId: actorId ?? null, action, entity, entityId: entityId ?? null, meta } });
}
