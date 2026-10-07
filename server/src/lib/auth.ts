import type { RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role, User } from '@prisma/client';
import { env, isProd } from '../env';
import { forbidden, unauthorized } from './http';
import { prisma } from '../db';

export interface AuthInfo {
  userId: string;
  role: Role;
  customerId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthInfo;
    }
  }
}

const ACCESS_TTL = '15m';
const REFRESH_TTL_DAYS = 30;
export const REFRESH_COOKIE = 'np_refresh';

export function signAccess(info: AuthInfo) {
  return jwt.sign(info, env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TTL });
}

export function setRefreshCookie(res: Response, user: Pick<User, 'id' | 'tokenVersion'>) {
  const token = jwt.sign({ sub: user.id, v: user.tokenVersion }, env.JWT_REFRESH_SECRET, {
    expiresIn: `${REFRESH_TTL_DAYS}d`,
  });
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/api/auth',
    maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}

export function verifyRefresh(token: string): { sub: string; v: number } {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as { sub: string; v: number };
}

export async function authInfoFor(userId: string): Promise<AuthInfo> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { customer: true } });
  return { userId: user.id, role: user.role, customerId: user.customer?.id ?? null };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(unauthorized());
  try {
    const p = jwt.verify(token, env.JWT_ACCESS_SECRET) as AuthInfo;
    req.auth = { userId: p.userId, role: p.role, customerId: p.customerId };
    next();
  } catch {
    next(unauthorized('Session expired'));
  }
};

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth || !roles.includes(req.auth.role)) return next(forbidden());
    next();
  };

export const requireCustomer: RequestHandler = (req, _res, next) => {
  if (!req.auth?.customerId) return next(forbidden('Customer account required'));
  next();
};

export const isStaff = (role: Role) => role === 'ADMIN' || role === 'SUPER_ADMIN';
