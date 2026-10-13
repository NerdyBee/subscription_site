process.env.TZ ||= 'Africa/Lagos';

import { env, isProd } from './env';
import { createApp } from './app';
import { startJobs } from './jobs';
import { ensureSeedData, runMigrations } from './services/bootstrap';

async function main() {
  // On shared hosting there is no terminal, so production startup migrates and seeds itself.
  if (isProd && process.env.AUTO_MIGRATE !== 'false') runMigrations();
  await ensureSeedData();

  createApp().listen(env.PORT, () => {
    console.log(`API listening on http://localhost:${env.PORT}`);
    startJobs();
  });
}

main().catch((err) => {
  console.error('[startup] failed', err);
  process.exit(1);
});
