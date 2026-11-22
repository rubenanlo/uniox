import { admin, callerId } from '../_shared/db.ts';
import { json, preflight } from '../_shared/cors.ts';
import { type Addr, accessToken, buildMime, CAL, encodeB64Url, GMAIL, gfetch } from '../_shared/google.ts';
import { type AccountRow, syncCalendar, syncThread } from '../_shared/mailsync.ts';

type Body =
  | { action: 'archive' | 'trash' | 'inbox'; threadId: string }
  | { action: 'read'; threadId: string; read: boolean }
  | { action: 'pin'; threadId: string; pinned: boolean }
  | { action: 'snooze'; threadId: string; until: number }
  | { action: 'send'; accountId: string; to: Addr[]; cc: Addr[]; subject: string; body: string; threadId?: string; inReplyToMessageId?: string }
  | { action: 'rsvp'; eventId: string; answer: 'accepted' | 'tentative' | 'declined' }
  | { action: 'createEvent'; accountId: string; title: string; startMs: number; endMs: number; addMeet: boolean };

/** Mail and calendar writes for the phone. Every call acts on the caller's own data. */
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const userId = await callerId(req);
  if (!userId) return json({ error: 'unauthorized' }, 401);
  const db = admin();
  const b = (await req.json()) as Body;

  const account = async (id: string) => {
    const { data } = await db.from('accounts').select('id, user_id, email, display_name, history_id, calendar_synced_at').eq('id', id).eq('user_id', userId).single();
    if (!data) throw new Error('account not found');
    return data as AccountRow & { display_name: string };
  };
  const thread = async (id: string) => {
    const { data } = await db.from('threads').select('id, account_id, gmail_thread_id').eq('id', id).eq('user_id', userId).single();
    if (!data) throw new Error('thread not found');
    return data as { id: string; account_id: string; gmail_thread_id: string };
  };

  try {
    switch (b.action) {
      case 'archive':
      case 'inbox':
      case 'trash':
      case 'read':
      case 'pin':
      case 'snooze': {
        const t = await thread(b.threadId);
        const token = await accessToken(db, t.account_id);
        const base = `${GMAIL}/threads/${t.gmail_thread_id}`;
        if (b.action === 'trash') {
          await gfetch(token, `${base}/trash`, { method: 'POST' });
          await db.from('threads').update({ in_inbox: false }).eq('id', t.id);
        } else {
          let mod: { addLabelIds?: string[]; removeLabelIds?: string[] };
          let local: Record<string, unknown>;
          if (b.action === 'archive') {
            mod = { removeLabelIds: ['INBOX'] };
            local = { in_inbox: false };
          } else if (b.action === 'inbox') {
            mod = { addLabelIds: ['INBOX'] };
            local = { in_inbox: true, snooze_until: null };
          } else if (b.action === 'snooze') {
            mod = { removeLabelIds: ['INBOX'] };
            local = { in_inbox: false, snooze_until: b.until };
          } else if (b.action === 'read') {
            mod = b.read ? { removeLabelIds: ['UNREAD'] } : { addLabelIds: ['UNREAD'] };
            local = { unread_count: b.read ? 0 : 1 };
          } else {
            const pinned = (b as { pinned: boolean }).pinned;
            mod = pinned ? { addLabelIds: ['STARRED'] } : { removeLabelIds: ['STARRED'] };
            local = { pinned };
          }
          await gfetch(token, `${base}/modify`, { method: 'POST', body: JSON.stringify(mod) });
          await db.from('threads').update(local).eq('id', t.id);
          if (b.action === 'read') await db.from('messages').update({ unread: !b.read }).eq('thread_id', t.id);
        }
        return json({ ok: true });
      }

      case 'send': {
        const acct = await account(b.accountId);
        const token = await accessToken(db, acct.id);
        let inReplyTo: string | null = null;
        let references: string | null = null;
        let gmailThreadId: string | undefined;
        if (b.threadId) {
          const t = await thread(b.threadId);
          gmailThreadId = t.gmail_thread_id;
          const { data: m } = await db
            .from('messages')
            .select('rfc_message_id, rfc_references')
            .eq('thread_id', t.id)
            .order('date', { ascending: false })
            .limit(1)
            .maybeSingle();
          inReplyTo = m?.rfc_message_id ?? null;
          references = m?.rfc_references ?? null;
        }
        const { data: s } = await db.from('settings').select('data').eq('user_id', userId).maybeSingle();
        const sig = (s?.data as { signatures?: Record<string, string> } | undefined)?.signatures?.[acct.email];
        const mime = buildMime({
          from: { email: acct.email, name: acct.display_name || undefined },
          to: b.to,
          cc: b.cc,
          subject: b.subject,
          body: sig ? `${b.body}\n\n${sig}` : b.body,
          inReplyTo,
          references,
        });
        const sent = await gfetch<{ threadId: string }>(token, `${GMAIL}/messages/send`, {
          method: 'POST',
          body: JSON.stringify({ raw: encodeB64Url(mime), ...(gmailThreadId ? { threadId: gmailThreadId } : {}) }),
        });
        await syncThread(db, token, acct, sent.threadId);
        return json({ ok: true });
      }

      case 'rsvp': {
        const { data: ev } = await db
          .from('events')
          .select('id, account_id, calendar_id, google_event_id')
          .eq('id', b.eventId)
          .eq('user_id', userId)
          .single();
        if (!ev) throw new Error('event not found');
        const acct = await account(ev.account_id);
        const token = await accessToken(db, acct.id);
        const url = `${CAL}/calendars/${encodeURIComponent(ev.calendar_id)}/events/${ev.google_event_id}`;
        const g = await gfetch<{ attendees?: { email: string; self?: boolean; responseStatus?: string }[] }>(token, url);
        const attendees = (g.attendees ?? []).map((a) =>
          a.self || a.email.toLowerCase() === acct.email.toLowerCase() ? { ...a, responseStatus: b.answer } : a,
        );
        await gfetch(token, `${url}?sendUpdates=all`, { method: 'PATCH', body: JSON.stringify({ attendees }) });
        await db.from('events').update({ my_answer: b.answer }).eq('id', ev.id);
        // Reflect the answer on invite cards that point at this event.
        const { data: msgs } = await db.from('messages').select('id, invite').eq('user_id', userId).filter('invite->>eventId', 'eq', ev.id);
        for (const m of msgs ?? []) await db.from('messages').update({ invite: { ...m.invite, myAnswer: b.answer } }).eq('id', m.id);
        return json({ ok: true });
      }

      case 'createEvent': {
        const acct = await account(b.accountId);
        const token = await accessToken(db, acct.id);
        await gfetch(token, `${CAL}/calendars/primary/events?conferenceDataVersion=1`, {
          method: 'POST',
          body: JSON.stringify({
            summary: b.title,
            start: { dateTime: new Date(b.startMs).toISOString() },
            end: { dateTime: new Date(b.endMs).toISOString() },
            ...(b.addMeet ? { conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
          }),
        });
        await syncCalendar(db, token, acct);
        return json({ ok: true });
      }
    }
    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
