import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.2';
import { categorize, sameOrgDomain } from './categorize.ts';
import {
  type Addr,
  accessToken,
  CAL,
  decodeB64Url,
  GMAIL,
  GoogleError,
  gfetch,
  type GmailMessage,
  type ParsedMessage,
  parseIcs,
  parseMessage,
} from './google.ts';
import { pushToUser } from './push.ts';

export interface AccountRow {
  id: string;
  user_id: string;
  email: string;
  history_id: string | null;
  calendar_synced_at: string | null;
}

const INITIAL_THREADS = 150;
const INITIAL_BATCH = 40;
const PARALLEL = 5;
/** Threads re-read per run when catching up on history, to stay under Gmail's per-minute quota. */
const HISTORY_BATCH = 60;
const CAL_PAST_DAYS = 14;
const CAL_FUTURE_DAYS = 90;
const CAL_EVERY_MS = 5 * 60_000;

export const threadKey = (accountId: string, gmailThreadId: string) => `${accountId}:${gmailThreadId}`;

/** One sync pass for an account: mail (incremental via history), calendar, snoozes. */
export async function syncAccount(db: SupabaseClient, acct: AccountRow): Promise<{ newMail: number }> {
  try {
    const token = await accessToken(db, acct.id);
    await wakeSnoozed(db, token, acct);
    // Calendar first, so invite cards in new mail can link to their event.
    if (!acct.calendar_synced_at || Date.now() - new Date(acct.calendar_synced_at).getTime() > CAL_EVERY_MS) {
      await syncCalendar(db, token, acct);
    }
    const newMail = await syncMail(db, token, acct);
    await db.from('accounts').update({ status: 'ok', sync_error: null, last_sync_at: new Date().toISOString() }).eq('id', acct.id);
    return { newMail };
  } catch (e) {
    console.error('sync failed', acct.email, e);
    await db.from('accounts').update({ status: 'error', sync_error: String((e as Error).message).slice(0, 500) }).eq('id', acct.id);
    return { newMail: 0 };
  }
}

async function syncMail(db: SupabaseClient, token: string, acct: AccountRow): Promise<number> {
  const profile = await gfetch<{ historyId: string }>(token, `${GMAIL}/profile`);
  let changed = new Set<string>();
  const arrived = new Set<string>();
  let backfilling = false;
  /** Set when a long history backlog is cut short: the next run resumes here. */
  let resumeFrom: string | null = null;

  if (!acct.history_id) {
    const list = await gfetch<{ threads?: { id: string }[] }>(
      token,
      `${GMAIL}/threads?maxResults=${INITIAL_THREADS}&q=${encodeURIComponent('in:inbox OR is:starred OR in:sent newer_than:60d')}`,
    );
    // First sync runs in small batches across runs, so a new account stays
    // inside Gmail's per-minute quota. Threads already stored are skipped.
    const { data: have } = await db.from('threads').select('gmail_thread_id').eq('account_id', acct.id);
    const done = new Set((have ?? []).map((t) => t.gmail_thread_id as string));
    const missing = (list.threads ?? []).map((t) => t.id).filter((id) => !done.has(id));
    changed = new Set(missing.slice(0, INITIAL_BATCH));
    backfilling = missing.length > INITIAL_BATCH;
  } else {
    try {
      let pageToken: string | undefined;
      let lastDone: string | null = null;
      pages: do {
        const h = await gfetch<{
          history?: {
            id: string;
            messagesAdded?: { message: { id: string; threadId: string; labelIds?: string[] } }[];
            messagesDeleted?: { message: { threadId: string } }[];
            labelsAdded?: { message: { threadId: string } }[];
            labelsRemoved?: { message: { threadId: string } }[];
          }[];
          nextPageToken?: string;
        }>(
          token,
          `${GMAIL}/history?startHistoryId=${acct.history_id}${pageToken ? `&pageToken=${pageToken}` : ''}`,
        );
        for (const rec of h.history ?? []) {
          // A long backlog (the account was offline or failing for hours) is
          // read in batches across runs; otherwise every run would restart
          // from the same point and hit the quota again.
          if (changed.size >= HISTORY_BATCH && lastDone) {
            resumeFrom = lastDone;
            break pages;
          }
          for (const a of rec.messagesAdded ?? []) {
            changed.add(a.message.threadId);
            const l = a.message.labelIds ?? [];
            if (l.includes('INBOX') && l.includes('UNREAD') && !l.includes('SENT')) arrived.add(a.message.id);
          }
          for (const x of [...(rec.messagesDeleted ?? []), ...(rec.labelsAdded ?? []), ...(rec.labelsRemoved ?? [])]) {
            changed.add(x.message.threadId);
          }
          lastDone = rec.id;
        }
        pageToken = h.nextPageToken;
      } while (pageToken);
    } catch (e) {
      if (e instanceof GoogleError && e.status === 404) {
        // History expired: start over.
        await db.from('accounts').update({ history_id: null }).eq('id', acct.id);
        return syncMail(db, token, { ...acct, history_id: null });
      }
      throw e;
    }
  }

  const contacts = await knownContacts(db, acct.user_id);
  const pushes: { thread: ThreadUpsert; msg: ParsedMessage }[] = [];
  const ids = [...changed];
  for (let i = 0; i < ids.length; i += PARALLEL) {
    await Promise.all(
      ids.slice(i, i + PARALLEL).map(async (gid) => {
        const res = await syncThread(db, token, acct, gid, contacts);
        if (!res) return;
        for (const m of res.messages) if (arrived.has(m.id)) pushes.push({ thread: res.thread, msg: m });
      }),
    );
  }
  if (resumeFrom) await db.from('accounts').update({ history_id: resumeFrom }).eq('id', acct.id);
  else if (!backfilling) await db.from('accounts').update({ history_id: profile.historyId }).eq('id', acct.id);
  // No pushes for a catch-up batch: that mail is hours old.
  if (pushes.length && !resumeFrom) await notify(db, acct, pushes);
  return pushes.length;
}

async function knownContacts(db: SupabaseClient, userId: string): Promise<Set<string>> {
  const { data } = await db.from('contacts').select('email').eq('user_id', userId);
  return new Set((data ?? []).map((r: { email: string }) => r.email));
}

interface ThreadUpsert {
  id: string;
  user_id: string;
  account_id: string;
  gmail_thread_id: string;
  subject: string;
  snippet: string;
  participants: Addr[];
  last_from: Addr | null;
  last_message_at: number;
  message_count: number;
  unread_count: number;
  has_attachments: boolean;
  pinned: boolean;
  priority: boolean;
  category: string;
  in_inbox: boolean;
  label_ids: string[];
}

/** Re-reads one Gmail thread and mirrors it. Returns null if it vanished. */
export async function syncThread(
  db: SupabaseClient,
  token: string,
  acct: AccountRow,
  gmailThreadId: string,
  contacts?: Set<string>,
): Promise<{ thread: ThreadUpsert; messages: ParsedMessage[] } | null> {
  const key = threadKey(acct.id, gmailThreadId);
  let raw: { messages?: GmailMessage[] };
  try {
    raw = await gfetch(token, `${GMAIL}/threads/${gmailThreadId}?format=full`);
  } catch (e) {
    if (e instanceof GoogleError && e.status === 404) {
      await db.from('threads').delete().eq('id', key);
      return null;
    }
    throw e;
  }
  // Drafts never show as mail. Trashed or spam messages (a deleted draft lands
  // in Trash and reads as sent) are left out while the thread has live mail.
  const all = (raw.messages ?? []).map(parseMessage).filter((m) => !m.labelIds.includes('DRAFT'));
  const binned = (m: ParsedMessage) => m.labelIds.includes('TRASH') || m.labelIds.includes('SPAM');
  const msgs = all.some((m) => !binned(m)) ? all.filter((m) => !binned(m)) : all;
  // Most invites carry the .ics as an attachment, not inline; fetch it so the card shows.
  for (const m of msgs) {
    if (m.calendar) continue;
    const ics = m.attachments.find((a) => a.contentType === 'text/calendar' && a.size < 200_000);
    if (!ics) continue;
    try {
      const att = await gfetch<{ data?: string }>(token, `${GMAIL}/messages/${m.id}/attachments/${ics.id}`);
      if (att.data) m.calendar = decodeB64Url(att.data);
    } catch (e) {
      console.error('invite attachment', e);
    }
  }
  if (!msgs.length) {
    await db.from('threads').delete().eq('id', key);
    return null;
  }
  contacts ??= await knownContacts(db, acct.user_id);
  const me = acct.email.toLowerCase();
  const isMe = (a: Addr | null) => !!a && a.email === me;
  const labels = new Set(msgs.flatMap((m) => m.labelIds));
  const lastInbound = [...msgs].reverse().find((m) => !isMe(m.from)) ?? null;
  const last = msgs[msgs.length - 1]!;
  const threadHasOurReply = msgs.some((m) => isMe(m.from));

  // Learn contacts from what we sent.
  const newContacts = new Set<string>();
  for (const m of msgs) if (isMe(m.from)) for (const a of [...m.to, ...m.cc]) if (!contacts.has(a.email)) newContacts.add(a.email);
  if (newContacts.size) {
    await db.from('contacts').upsert([...newContacts].map((email) => ({ user_id: acct.user_id, email })), { onConflict: 'user_id,email', ignoreDuplicates: true });
    newContacts.forEach((c) => contacts!.add(c));
  }

  const ref = lastInbound ?? last;
  const category = categorize({
    headers: ref.headers,
    fromAddress: ref.from?.email ?? '',
    subject: ref.subject,
    // Only a real request needs an answer: accept/decline notices (REPLY), counter-proposals
    // and booking confirmations (PUBLISH) are not invites.
    hasCalendar: msgs.some((m) => {
      if (!m.calendar) return false;
      const method = parseIcs(m.calendar)?.method;
      return method === 'REQUEST';
    }),
    threadHasOurReply,
    knownCorrespondent: !!ref.from && contacts.has(ref.from.email),
    sameOrgSender: !!ref.from && sameOrgDomain(ref.from.email, me),
    recipientCount: new Set([...ref.to, ...ref.cc].map((a) => a.email)).size,
  });
  const fromHuman = !!lastInbound?.from && (contacts.has(lastInbound.from.email) || sameOrgDomain(lastInbound.from.email, me));
  const unreadCount = msgs.filter((m) => m.labelIds.includes('UNREAD')).length;

  const participants: Addr[] = [];
  for (const m of [...msgs].reverse()) {
    if (m.from && !participants.some((p) => p.email === m.from!.email)) participants.push(m.from);
  }

  const thread: ThreadUpsert = {
    id: key,
    user_id: acct.user_id,
    account_id: acct.id,
    gmail_thread_id: gmailThreadId,
    subject: msgs[0]!.subject,
    snippet: last.snippet,
    participants,
    last_from: (lastInbound ?? last).from,
    last_message_at: last.date,
    message_count: msgs.length,
    unread_count: unreadCount,
    has_attachments: msgs.some((m) => m.attachments.length > 0),
    pinned: labels.has('STARRED'),
    priority: category === 'personal' && fromHuman,
    category,
    in_inbox: labels.has('INBOX'),
    label_ids: [...labels],
  };
  const { error: tErr } = await db.from('threads').upsert(thread);
  if (tErr) throw new Error(`thread upsert: ${tErr.message}`);

  const rows = await Promise.all(
    msgs.map(async (m) => ({
      id: `${acct.id}:${m.id}`,
      user_id: acct.user_id,
      account_id: acct.id,
      thread_id: key,
      gmail_id: m.id,
      rfc_message_id: m.rfcMessageId,
      rfc_references: m.references,
      from_addr: m.from,
      to_addrs: m.to,
      cc_addrs: m.cc,
      date: m.date,
      snippet: m.snippet,
      html: m.html,
      body_text: m.text,
      from_me: isMe(m.from),
      unread: m.labelIds.includes('UNREAD'),
      attachments: m.attachments,
      invite: m.calendar ? await inviteFor(db, acct, m.calendar) : null,
    })),
  );
  const { error: mErr } = await db.from('messages').upsert(rows);
  if (mErr) throw new Error(`message upsert: ${mErr.message}`);
  // Drop messages deleted upstream.
  await db
    .from('messages')
    .delete()
    .eq('thread_id', key)
    .not('id', 'in', `(${rows.map((r) => `"${r.id}"`).join(',')})`);
  return { thread, messages: msgs };
}

async function inviteFor(db: SupabaseClient, acct: AccountRow, ics: string) {
  const inv = parseIcs(ics);
  if (!inv || inv.method !== 'REQUEST') return null;
  let eventId: string | null = null;
  let myAnswer: string | null = null;
  let meetingUrl: string | undefined;
  if (inv.uid) {
    const { data } = await db
      .from('events')
      .select('id, my_answer, meeting_url')
      .eq('user_id', acct.user_id)
      .eq('ical_uid', inv.uid)
      .limit(1)
      .maybeSingle();
    if (data) {
      eventId = data.id;
      myAnswer = data.my_answer;
      meetingUrl = data.meeting_url ?? undefined;
    }
  }
  return {
    eventId,
    icalUid: inv.uid,
    title: inv.title,
    startMs: inv.startMs,
    endMs: inv.endMs || inv.startMs + 3_600_000,
    meetingUrl,
    organizer: inv.organizer,
    guests: inv.attendees.filter((a) => a.email !== acct.email.toLowerCase()),
    myAnswer: myAnswer === 'needsAction' ? null : myAnswer,
  };
}

async function notify(db: SupabaseClient, acct: AccountRow, items: { thread: ThreadUpsert; msg: ParsedMessage }[]) {
  const { data } = await db.from('settings').select('data').eq('user_id', acct.user_id).maybeSingle();
  const s = (data?.data ?? {}) as { pushEnabled?: boolean; notifyMode?: 'all' | 'priority' };
  if (s.pushEnabled === false) return;
  const mode = s.notifyMode ?? 'priority';
  for (const { thread, msg } of items) {
    if (mode === 'priority' && !thread.priority) continue;
    if (mode === 'all' && (thread.category === 'promotions' || thread.category === 'newsletters')) continue;
    await pushToUser(db, acct.user_id, {
      title: msg.from?.name || msg.from?.email || 'New mail',
      body: `${msg.subject}\n${msg.snippet}`.slice(0, 180),
      url: `/#/thread/${encodeURIComponent(thread.id)}`,
      tag: thread.id,
      threadId: thread.id,
    });
  }
}

async function wakeSnoozed(db: SupabaseClient, token: string, acct: AccountRow) {
  const { data } = await db
    .from('threads')
    .select('id, gmail_thread_id')
    .eq('account_id', acct.id)
    .lte('snooze_until', Date.now());
  for (const t of data ?? []) {
    await gfetch(token, `${GMAIL}/threads/${t.gmail_thread_id}/modify`, {
      method: 'POST',
      body: JSON.stringify({ addLabelIds: ['INBOX', 'UNREAD'] }),
    });
    await db.from('threads').update({ snooze_until: null, in_inbox: true }).eq('id', t.id);
  }
}

/* ---------- Calendar ---------- */

interface GEvent {
  id: string;
  iCalUID?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  colorId?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] };
  attendees?: { email: string; displayName?: string; self?: boolean; resource?: boolean; responseStatus?: string; organizer?: boolean }[];
  organizer?: { email: string; displayName?: string; self?: boolean };
  transparency?: string;
  eventType?: string;
}

export async function syncCalendar(db: SupabaseClient, token: string, acct: AccountRow) {
  const cals = await gfetch<{ items: { id: string; summary: string; backgroundColor?: string; selected?: boolean; primary?: boolean; accessRole: string }[] }>(
    token,
    `${CAL}/users/me/calendarList?minAccessRole=reader`,
  );
  const timeMin = new Date(Date.now() - CAL_PAST_DAYS * 86_400_000).toISOString();
  const timeMax = new Date(Date.now() + CAL_FUTURE_DAYS * 86_400_000).toISOString();
  const rows: Record<string, unknown>[] = [];
  for (const cal of cals.items.filter((c) => c.selected || c.primary)) {
    let pageToken: string | undefined;
    do {
      const res = await gfetch<{ items: GEvent[]; nextPageToken?: string }>(
        token,
        `${CAL}/calendars/${encodeURIComponent(cal.id)}/events?singleEvents=true&orderBy=startTime&maxResults=250&timeMin=${timeMin}&timeMax=${timeMax}${pageToken ? `&pageToken=${pageToken}` : ''}`,
      );
      for (const e of res.items) {
        if (e.status === 'cancelled') continue;
        const self = e.attendees?.find((a) => a.self);
        if (self?.responseStatus === 'declined') continue;
        const allDay = !!e.start.date;
        const startMs = allDay ? Date.parse(`${e.start.date}T00:00:00`) : Date.parse(e.start.dateTime!);
        const endMs = allDay ? Date.parse(`${e.end.date}T00:00:00`) : Date.parse(e.end.dateTime!);
        rows.push({
          id: `${acct.id}:${cal.id}:${e.id}`,
          user_id: acct.user_id,
          account_id: acct.id,
          google_event_id: e.id,
          calendar_id: cal.id,
          calendar_name: cal.summary,
          ical_uid: e.iCalUID ?? null,
          title: e.summary ?? '(No title)',
          start_ms: startMs,
          end_ms: endMs,
          all_day: allDay,
          color: cal.backgroundColor ?? '#2f63e7',
          location: e.location ?? null,
          description: e.description ?? null,
          meeting_url: e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri ?? null,
          attendees: (e.attendees ?? []).filter((a) => !a.self && !a.resource).map((a) => ({ email: a.email, ...(a.displayName ? { name: a.displayName } : {}) })),
          organizer: e.organizer ? { email: e.organizer.email, ...(e.organizer.displayName ? { name: e.organizer.displayName } : {}) } : null,
          my_answer: self?.responseStatus ?? (e.organizer?.self ? 'accepted' : null),
          free: e.transparency === 'transparent' || e.eventType === 'focusTime',
        });
      }
      pageToken = res.nextPageToken;
    } while (pageToken);
  }
  // Replace this account's window.
  await db
    .from('events')
    .delete()
    .eq('account_id', acct.id)
    .gte('end_ms', Date.parse(timeMin))
    .lte('start_ms', Date.parse(timeMax));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('events').upsert(rows.slice(i, i + 500));
    if (error) throw new Error(`events upsert: ${error.message}`);
  }
  await db.from('accounts').update({ calendar_synced_at: new Date().toISOString() }).eq('id', acct.id);

  // Link invite cards that arrived before their event was on the calendar,
  // and refresh their answer from the calendar.
  const { data: invites } = await db
    .from('messages')
    .select('id, invite')
    .eq('account_id', acct.id)
    .not('invite', 'is', null)
    .gte('date', Date.now() - 30 * 86_400_000);
  for (const m of invites ?? []) {
    const uid = m.invite?.icalUid;
    const row = uid ? rows.find((r) => r.ical_uid === uid) : undefined;
    if (!row) continue;
    const answer = row.my_answer === 'needsAction' ? null : row.my_answer;
    if (m.invite.eventId === row.id && m.invite.myAnswer === answer) continue;
    await db.from('messages').update({ invite: { ...m.invite, eventId: row.id, myAnswer: answer, meetingUrl: row.meeting_url ?? m.invite.meetingUrl } }).eq('id', m.id);
  }
}
