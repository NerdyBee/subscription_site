process.env.TZ ||= 'Africa/Lagos';

import { env } from './env';
import { createApp } from './app';
import { startJobs } from './jobs';

createApp().listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
  startJobs();
});
