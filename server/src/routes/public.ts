import { Router } from 'express';
import { prisma } from '../db';
import { getSettings } from '../lib/settings';
import { planView } from '../services/views';

export const publicRouter = Router();

publicRouter.get('/site', async (_req, res) => {
  const s = await getSettings();
  res.json(s);
});

publicRouter.get('/plans', async (_req, res) => {
  const plans = await prisma.plan.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { priceKobo: 'asc' }],
  });
  res.json(plans.map(planView));
});
