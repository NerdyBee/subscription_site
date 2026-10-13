import cron from 'node-cron';
import { expireDueSubscriptions, sendExpiryReminders } from './services/subscriptions';

export async function runSubscriptionJobs() {
  try {
    const expired = await expireDueSubscriptions();
    const reminders = await sendExpiryReminders();
    if (expired || reminders) console.log(`[jobs] expired=${expired} reminders=${reminders}`);
    return { ok: true, expired, reminders };
  } catch (err) {
    console.error('[jobs] failed', err);
    return { ok: false, expired: 0, reminders: 0 };
  }
}

export function startJobs() {
  // Every 10 minutes: expiry is checked often so access is cut close to the real end time.
  cron.schedule('*/10 * * * *', runSubscriptionJobs);
  void runSubscriptionJobs();
}
