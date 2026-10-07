import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db';
import {
  authInfoFor,
  clearRefreshCookie,
  REFRESH_COOKIE,
  requireAuth,
  setRefreshCookie,
  signAccess,
  verifyRefresh,
} from '../lib/auth';
import { badRequest, unauthorized } from '../lib/http';
import { audit } from '../lib/audit';
import { accountNo } from '../lib/format';
import { notifyStaff } from '../services/notify';

export const authRouter = Router();

export const passwordSchema = z.string().min(8, 'must be at least 8 characters').max(100);

async function session(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { customer: true } });
  const info = await authInfoFor(user.id);
  return {
    accessToken: signAccess(info),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      customerId: user.customer?.id ?? null,
      companyName: user.customer?.companyName ?? null,
      accountNo: user.customer ? accountNo(user.customer.seq) : null,
    },
  };
}

const registerSchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  contactName: z.string().trim().min(2).max(120),
  email: z.email().trim().toLowerCase(),
  phone: z.string().trim().min(7).max(20),
  officeUnit: z.string().trim().max(40).optional().or(z.literal('')),
  password: passwordSchema,
});

authRouter.post('/register', async (req, res) => {
  const body = registerSchema.parse(req.body);
  if (await prisma.user.findUnique({ where: { email: body.email } })) {
    throw badRequest('An account with this email already exists. Try logging in.');
  }
  const office = body.officeUnit
    ? await prisma.office.upsert({ where: { unit: body.officeUnit }, create: { unit: body.officeUnit }, update: {} })
    : null;
  const user = await prisma.user.create({
    data: {
      email: body.email,
      name: body.contactName,
      phone: body.phone,
      passwordHash: await bcrypt.hash(body.password, 10),
      role: 'CUSTOMER',
      customer: {
        create: {
          companyName: body.companyName,
          contactName: body.contactName,
          phone: body.phone,
          whatsapp: body.phone,
          officeId: office?.id,
        },
      },
    },
    include: { customer: true },
  });
  await audit(user.id, 'customer.register', 'Customer', user.customer!.id);
  await notifyStaff('New customer registered', `${body.companyName}${office ? ` (${office.unit})` : ''} just signed up.`);
  setRefreshCookie(res, user);
  res.status(201).json(await session(user.id));
});

const loginSchema = z.object({ email: z.string().trim().toLowerCase(), password: z.string() });

authRouter.post('/login', async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw unauthorized('Incorrect email or password');
  }
  if (!user.isActive) throw unauthorized('This account has been disabled. Please contact support.');
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  setRefreshCookie(res, user);
  res.json(await session(user.id));
});

authRouter.post('/refresh', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) {
    res.status(204).end();
    return;
  }
  let payload;
  try {
    payload = verifyRefresh(token);
  } catch {
    clearRefreshCookie(res);
    throw unauthorized('Session expired');
  }
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive || user.tokenVersion !== payload.v) {
    clearRefreshCookie(res);
    throw unauthorized('Session expired');
  }
  setRefreshCookie(res, user);
  res.json(await session(user.id));
});

authRouter.post('/logout', (_req, res) => {
  clearRefreshCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json((await session(req.auth!.userId)).user);
});

const changePasswordSchema = z.object({ currentPassword: z.string(), newPassword: passwordSchema });

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw badRequest('Current password is incorrect');
  // Bumping tokenVersion signs out every other device.
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(newPassword, 10), tokenVersion: { increment: 1 } },
  });
  await audit(user.id, 'user.change_password', 'User', user.id);
  setRefreshCookie(res, updated);
  res.json({ ok: true });
});
