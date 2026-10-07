import { Router } from 'express';
import { prisma } from '../db';
import { isStaff, requireAuth } from '../lib/auth';
import { notFound } from '../lib/http';
import { proofFile } from '../lib/uploads';

export const commonRouter = Router();

commonRouter.get('/notifications', requireAuth, async (req, res) => {
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId: req.auth!.userId }, orderBy: { createdAt: 'desc' }, take: 30 }),
    prisma.notification.count({ where: { userId: req.auth!.userId, readAt: null } }),
  ]);
  res.json({ unread, items });
});

commonRouter.post('/notifications/read-all', requireAuth, async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.auth!.userId, readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true });
});

// Payment receipts are private: only staff or the customer who uploaded them.
commonRouter.get('/payments/:id/proof', requireAuth, async (req, res) => {
  const payment = await prisma.payment.findUnique({ where: { id: String(req.params.id) } });
  const allowed = payment && (isStaff(req.auth!.role) || payment.customerId === req.auth!.customerId);
  if (!allowed || !payment.proofPath) throw notFound('Receipt not found');
  res.sendFile(proofFile(payment.proofPath));
});
