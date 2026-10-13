import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './env';
import { errorHandler, notFound } from './lib/http';
import { authRouter } from './routes/auth';
import { publicRouter } from './routes/public';
import { customerRouter } from './routes/customer';
import { commonRouter } from './routes/common';
import { adminRouter } from './routes/admin';
import { runSubscriptionJobs } from './jobs';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  // For a host cron job (shared hosting stops idle apps, so in-process timers can't be relied on):
  //   curl -s "https://your-site/api/cron?key=CRON_SECRET"
  app.get('/api/cron', async (req, res, next) => {
    const key = Buffer.from(String(req.query.key ?? ''));
    const secret = Buffer.from(env.CRON_SECRET);
    if (!secret.length || key.length !== secret.length || !crypto.timingSafeEqual(key, secret)) return next(notFound());
    res.json(await runSubscriptionJobs());
  });
  app.use('/api/auth', authRouter);
  app.use('/api/public', publicRouter);
  app.use('/api/me', customerRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', commonRouter);
  app.use('/api', (_req, _res, next) => next(notFound()));

  // In production the API also serves the built React app: from server/public in the upload
  // package (see scripts/package.mjs), or straight from the client build in the repo.
  const clientDist = [path.resolve(__dirname, '../public'), path.resolve(__dirname, '../../client/dist')].find((d) =>
    fs.existsSync(path.join(d, 'index.html')),
  );
  if (clientDist) {
    app.use(express.static(clientDist, { index: false }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
