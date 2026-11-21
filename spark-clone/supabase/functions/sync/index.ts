import { admin, callerId, env } from '../_shared/db.ts';
import { json, preflight } from '../_shared/cors.ts';
import { type AccountRow, syncAccount } from '../_shared/mailsync.ts';

/**
 * Runs a sync pass. Two callers:
 *  - pg_cron every minute, with `x-cron-secret`: syncs every account.
 *  - the phone ("pull to refresh"), with the user's JWT: syncs that user's accounts.
 */
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const db = admin();
  const fromCron = req.headers.get('x-cron-secret') === env('CRON_SECRET', crypto.randomUUID());
  const userId = fromCron ? null : await callerId(req);
  if (!fromCron && !userId) return json({ error: 'unauthorized' }, 401);

  let q = db.from('accounts').select('id, user_id, email, history_id, calendar_synced_at');
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const results = await Promise.all((data as AccountRow[]).map((a) => syncAccount(db, a)));
  return json({ accounts: results.length, newMail: results.reduce((n, r) => n + r.newMail, 0) });
});
