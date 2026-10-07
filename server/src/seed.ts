import bcrypt from 'bcryptjs';
import { prisma } from './db';
import { defaultSettings } from './lib/settings';

/** Idempotent: creates the first super admin, starter packages and default settings if missing. */
async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? (process.env.NODE_ENV === 'production' ? '' : 'ChangeMe123!');
  if (password.length < 8) throw new Error('Set SEED_ADMIN_PASSWORD (at least 8 characters) before seeding in production');

  if (!(await prisma.user.findUnique({ where: { email } }))) {
    await prisma.user.create({
      data: { email, name: 'Administrator', role: 'SUPER_ADMIN', passwordHash: await bcrypt.hash(password, 10) },
    });
    console.log(`Created super admin ${email} / ${password}  (change this password after first login)`);
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
    console.log('Created starter packages (edit prices in Admin → Packages)');
  }

  if (!(await prisma.setting.findUnique({ where: { key: 'site' } }))) {
    await prisma.setting.create({ data: { key: 'site', value: defaultSettings } });
    console.log('Created default site settings (edit in Admin → Settings)');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
