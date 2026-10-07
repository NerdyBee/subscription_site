import { Router } from 'express';
import { requireAuth, requireRole } from '../../lib/auth';
import { billingRouter } from './billing';
import { customersRouter } from './customers';
import { dashboardRouter } from './dashboard';
import { opsRouter } from './ops';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'));
adminRouter.use(dashboardRouter);
adminRouter.use('/customers', customersRouter);
adminRouter.use(billingRouter);
adminRouter.use(opsRouter);
