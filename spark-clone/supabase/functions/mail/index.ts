import { admin, callerId } from '../_shared/db.ts';
import { json, preflight } from '../_shared/cors.ts';
import { type Addr, accessToken, buildMime, CAL, encodeB64Url, GMAIL, gfetch } from '../_shared/google.ts';
import { type AccountRow, syncCalendar, syncThread } from '../_shared/mailsync.ts';

type Body =
  | { action: 'archive' | 'trash' | 'inbox'; threadId: string }
  | { action: 'read'; threadId: string; read: boolean }
  | { action: 'pin'; threadId: string; pinned: boolean }
  | { action: 'snooze'; threadId: string; until: number }
  | { action: 'send'; accountId: string; to: Addr[]; cc: Addr[]; bcc?: Addr[]; subject: string; body: string; threadId?: string; inReplyToMessageId?: string }
  | { action: 'rsvp'; eventId: string; answer: 'accepted' | 'tentative' | 'declined' }
  | { action: 'propose'; eventId: string; startMs: number; endMs: number; note?: string; label?: string }
  | { action: 'freebusy'; accountId: string; emails: string[]; fromMs: number; toMs: number }
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
          bcc: b.bcc ?? [],
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

      case 'propose': {
        // Google's API has no "propose a new time" call. Like Gmail, Outlook and
        // the desktop app, send the organizer an iTIP COUNTER; Google Calendar
        // shows it on the event as a proposed new time.
        const { data: ev } = await db
          .from('events')
          .select('id, account_id, calendar_id, google_event_id')
          .eq('id', b.eventId)
          .eq('user_id', userId)
          .single();
        if (!ev) throw new Error('event not found');
        if (!(b.endMs > b.startMs)) throw new Error('bad time');
        const acct = await account(ev.account_id);
        const token = await accessToken(db, acct.id);
        const g = await gfetch<{
          iCalUID: string;
          sequence?: number;
          summary?: string;
          location?: string;
          organizer?: { email: string; displayName?: string };
          originalStartTime?: { dateTime?: string; date?: string };
        }>(token, `${CAL}/calendars/${encodeURIComponent(ev.calendar_id)}/events/${ev.google_event_id}`);
        if (!g.organizer?.email) throw new Error('this event has no organizer to ask');
        const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
        const esc = (t: string) => t.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
        const q = (t: string) => `"${t.replace(/"/g, "'")}"`;
        const rid = g.originalStartTime?.dateTime
          ? `RECURRENCE-ID:${stamp(Date.parse(g.originalStartTime.dateTime))}`
          : g.originalStartTime?.date
            ? `RECURRENCE-ID;VALUE=DATE:${g.originalStartTime.date.replace(/-/g, '')}`
            : null;
        const fold = (l: string) => {
          const out: string[] = [];
          let rest = l;
          while (rest.length > 74) {
            out.push(rest.slice(0, 74));
            rest = ' ' + rest.slice(74);
          }
          out.push(rest);
          return out.join('\r\n');
        };
        const summary = g.summary || 'Invitation';
        const ics =
          [
            'BEGIN:VCALENDAR',
            'PRODID:-//Uniox//Mail//EN',
            'VERSION:2.0',
            'CALSCALE:GREGORIAN',
            'METHOD:COUNTER',
            'BEGIN:VEVENT',
            `UID:${g.iCalUID}`,
            ...(rid ? [rid] : []),
            `SEQUENCE:${g.sequence ?? 0}`,
            `DTSTAMP:${stamp(Date.now())}`,
            `DTSTART:${stamp(b.startMs)}`,
            `DTEND:${stamp(b.endMs)}`,
            `SUMMARY:${esc(summary)}`,
            ...(g.location ? [`LOCATION:${esc(g.location)}`] : []),
            `ORGANIZER${g.organizer.displayName ? `;CN=${q(g.organizer.displayName)}` : ''}:mailto:${g.organizer.email}`,
            `ATTENDEE;PARTSTAT=TENTATIVE${acct.display_name ? `;CN=${q(acct.display_name)}` : ''}:mailto:${acct.email}`,
            ...(b.note?.trim() ? [`COMMENT:${esc(b.note.trim())}`] : []),
            'END:VEVENT',
            'END:VCALENDAR',
          ]
            .map(fold)
            .join('\r\n') + '\r\n';
        const when = b.label?.slice(0, 80) || new Date(b.startMs).toUTCString();
        const mime = buildMime({
          from: { email: acct.email, name: acct.display_name || undefined },
          to: [{ email: g.organizer.email, name: g.organizer.displayName }],
          cc: [],
          subject: `New time proposed: ${summary}`,
          body: `${acct.display_name || acct.email} proposed a new time for ${summary}: ${when}.${b.note?.trim() ? `\n\n${b.note.trim()}` : ''}`,
          calendar: { method: 'COUNTER', content: ics },
        });
        await gfetch(token, `${GMAIL}/messages/send`, { method: 'POST', body: JSON.stringify({ raw: encodeB64Url(mime) }) });
        return json({ ok: true });
      }

      case 'freebusy': {
        // Busy times for you and the other guests, for the propose-time picker.
        // People outside your organization usually come back empty (no access).
        const acct = await account(b.accountId);
        const token = await accessToken(db, acct.id);
        const emails = [...new Set([acct.email, ...b.emails.slice(0, 20)].map((e) => e.toLowerCase()))];
        const r = await gfetch<{ calendars: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }> }>(
          token,
          `${CAL}/freeBusy`,
          {
            method: 'POST',
            body: JSON.stringify({
              timeMin: new Date(b.fromMs).toISOString(),
              timeMax: new Date(b.toMs).toISOString(),
              items: emails.map((id) => ({ id: id === acct.email.toLowerCase() ? 'primary' : id })),
            }),
          },
        );
        const out: Record<string, { startMs: number; endMs: number }[] | null> = {};
        for (const e of emails) {
          const c = r.calendars[e === acct.email.toLowerCase() ? 'primary' : e];
          out[e] = !c || c.errors?.length ? null : (c.busy ?? []).map((x) => ({ startMs: Date.parse(x.start), endMs: Date.parse(x.end) }));
        }
        return json({ me: acct.email.toLowerCase(), busy: out });
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
