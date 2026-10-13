import { prisma } from './db';
import { ensureSeedData } from './services/bootstrap';

// Manual seeding (`npm run seed`). The server also does this on startup.
ensureSeedData()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
