import { admin, callerId, conf } from '../_shared/db.ts';
import { accessToken } from '../_shared/google.ts';
import { json, preflight } from '../_shared/cors.ts';
import { type AccountRow, syncAccount, syncThread } from '../_shared/mailsync.ts';
import { pushToUser } from '../_shared/push.ts';

/**
 * Runs a sync pass. Two callers:
 *  - pg_cron every minute, with `x-cron-secret`: syncs every account.
 *  - the phone ("pull to refresh"), with the user's JWT: syncs that user's accounts.
 * `{testPush: true}` sends one test notification instead of syncing.
 * `{reparseInvites: true}` re-reads threads that carry an .ics attachment.
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

  if (body?.reparseInvites) {
    let aq = db.from('accounts').select('id, user_id, email, history_id, calendar_synced_at');
    if (userId) aq = aq.eq('user_id', userId);
    const { data: accts } = await aq;
    let reparsed = 0;
    for (const acct of (accts ?? []) as AccountRow[]) {
      const { data: rows } = await db
        .from('messages')
        .select('thread_id, attachments')
        .eq('account_id', acct.id);
      const ids = [
        ...new Set(
          (rows ?? [])
            .filter((r) =>
              (r.attachments as { contentType?: string }[] | null)?.some(
                (a) => a.contentType === 'text/calendar',
              ),
            )
            .map((r) => r.thread_id as string),
        ),
      ].slice(0, 150);
      if (!ids.length) continue;
      const { data: threads } = await db.from('threads').select('gmail_thread_id').in('id', ids);
      const token = await accessToken(db, acct.id);
      for (const t of threads ?? []) {
        await syncThread(db, token, acct, t.gmail_thread_id as string).catch((e) => console.error(e));
        reparsed++;
      }
    }
    return json({ reparsed });
  }

  let q = db.from('accounts').select('id, user_id, email, history_id, calendar_synced_at');
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const results = await Promise.all((data as AccountRow[]).map((a) => syncAccount(db, a)));
  return json({ accounts: results.length, newMail: results.reduce((n, r) => n + r.newMail, 0) });
});
