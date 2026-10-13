import { execFileSync } from 'node:child_process';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';
import { defaultSettings } from '../lib/settings';

/**
 * Applies pending database migrations with the Prisma CLI.
 * Run at startup on hosts without a terminal (cPanel / Passenger), so a deploy is just
 * "upload and restart". Concurrent processes are safe: Prisma takes a database lock.
 */
export function runMigrations() {
  const cli = require.resolve('prisma/build/index.js');
  const schema = path.resolve(__dirname, '../../prisma/schema.prisma');
  console.log('[startup] applying database migrations…');
  execFileSync(process.execPath, [cli, 'migrate', 'deploy', '--schema', schema], {
    stdio: 'inherit',
    env: process.env,
    timeout: 120_000,
  });
}

/**
 * Idempotent first-run data: the first super admin, starter packages and default settings.
 * The admin is created only while no super admin exists, from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
 */
export async function ensureSeedData() {
  const hasAdmin = await prisma.user.count({ where: { role: 'SUPER_ADMIN' } });
  if (!hasAdmin) {
    const isProd = process.env.NODE_ENV === 'production';
    const email = (process.env.SEED_ADMIN_EMAIL ?? (isProd ? '' : 'admin@example.com')).trim().toLowerCase();
    const password = process.env.SEED_ADMIN_PASSWORD ?? (isProd ? '' : 'ChangeMe123!');
    if (!email || password.length < 8) {
      console.warn(
        '[startup] No super admin yet. Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (8+ characters) and restart the app.',
      );
    } else {
      await prisma.user.create({
        data: { email, name: 'Administrator', role: 'SUPER_ADMIN', passwordHash: await bcrypt.hash(password, 10) },
      });
      console.log(`[startup] Created super admin ${email}. Change the password after first login.`);
    }
  }

  if ((await prisma.plan.count()) === 0) {
    await prisma.plan.createMany({
      data: [
        {
          name: 'Office Basic',
          speed: 'Up to 25 Mbps',
          description: 'For small offices with a few staff.',
          durationDays: 30,
          priceKobo: 20_000_00,
          features: ['Up to 5 devices', 'Email & browsing', 'WhatsApp support'],
          sortOrder: 1,
        },
        {
          name: 'Office Plus',
          speed: 'Up to 50 Mbps',
          description: 'Video calls and cloud apps without the lag.',
          durationDays: 30,
          priceKobo: 35_000_00,
          features: ['Up to 15 devices', 'Smooth video calls', 'Priority support'],
          isFeatured: true,
          sortOrder: 2,
        },
        {
          name: 'Business Pro',
          speed: 'Up to 100 Mbps',
          description: 'Priority allocation for busy teams.',
          durationDays: 30,
          priceKobo: 60_000_00,
          features: ['Unlimited devices', 'Priority bandwidth', 'Dedicated support line'],
          sortOrder: 3,
        },
        {
          name: 'Daily Pass',
          speed: 'Up to 25 Mbps',
          description: 'Just need a day? Get online now.',
          durationDays: 1,
          priceKobo: 2_000_00,
          features: ['Up to 3 devices'],
          sortOrder: 4,
        },
      ],
    });
    console.log('[startup] Created starter packages (edit prices in Admin → Packages)');
  }

  if (!(await prisma.setting.findUnique({ where: { key: 'site' } }))) {
    await prisma.setting.create({ data: { key: 'site', value: defaultSettings } });
    console.log('[startup] Created default site settings (edit in Admin → Settings)');
  }
}
