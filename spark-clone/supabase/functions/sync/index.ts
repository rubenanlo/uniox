import { admin, callerId, conf } from '../_shared/db.ts';
import { json, preflight } from '../_shared/cors.ts';
import { type AccountRow, syncAccount } from '../_shared/mailsync.ts';
import { pushToUser } from '../_shared/push.ts';

/**
 * Runs a sync pass. Two callers:
 *  - pg_cron every minute, with `x-cron-secret`: syncs every account.
 *  - the phone ("pull to refresh"), with the user's JWT: syncs that user's accounts.
 * `{testPush: true}` sends one test notification instead of syncing.
 */
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const db = admin();
  const cronSecret = await conf(db, 'CRON_SECRET');
  const fromCron = !!cronSecret && req.headers.get('x-cron-secret') === cronSecret;
  const userId = fromCron ? null : await callerId(req);
  if (!fromCron && !userId) return json({ error: 'unauthorized' }, 401);

  // "Send test notification": proves the path from this server to the device.
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  if (body?.testPush) {
    const target = userId ?? (typeof body.userId === 'string' ? body.userId : null);
    if (!target) return json({ error: 'no user' }, 400);
    const sent = await pushToUser(db, target, {
      title: 'Uniox',
      body: 'Test notification. Push is working on this device.',
      url: '/#/settings',
      tag: 'uniox-test',
    });
    return json({ devices: sent.length, sent });
  }

  let q = db.from('accounts').select('id, user_id, email, history_id, calendar_synced_at');
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const results = await Promise.all((data as AccountRow[]).map((a) => syncAccount(db, a)));
  return json({ accounts: results.length, newMail: results.reduce((n, r) => n + r.newMail, 0) });
});
