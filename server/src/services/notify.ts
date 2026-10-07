import { prisma } from '../db';

/**
 * In-app notification. `dedupeKey` makes repeated calls (e.g. the hourly reminder job) a no-op.
 * Email/SMS/WhatsApp delivery can hook in here later.
 */
export async function notify(userId: string, title: string, body: string, dedupeKey?: string): Promise<boolean> {
  if (dedupeKey) {
    const { count } = await prisma.notification.createMany({
      data: [{ userId, title, body, dedupeKey }],
      skipDuplicates: true,
    });
    return count > 0;
  }
  await prisma.notification.create({ data: { userId, title, body } });
  return true;
}

export async function notifyStaff(title: string, body: string) {
  const staff = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, isActive: true },
    select: { id: true },
  });
  if (staff.length) {
    await prisma.notification.createMany({ data: staff.map((s) => ({ userId: s.id, title, body })) });
  }
}
