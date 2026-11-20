import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import MailComposer from 'nodemailer/lib/mail-composer';
import type { MailDb } from '@app/db';
import {
  buildItip,
  itipSubject,
  parseIcs,
  partstatToResponse,
  responseToPartstat,
  type Account,
  type AttachmentMeta,
  type IcsInvite,
  type InviteInfo,
  type InviteResponse,
} from '@app/shared';
import type { GEventItem } from './google-calendar';

/**
 * RSVP to an emailed invite on the invite itself, the way Gmail, Apple Mail
 * and Outlook do, never by writing a reply:
 * - Google accounts: find the event in the account's Google Calendar (by the
 *   invite's iCalendar UID) and set your attendee status with
 *   `sendUpdates=all`; Google notifies the organizer.
 * - Other accounts, or an invite Google hasn't put on the calendar: send the
 *   standard iTIP REPLY (a text/calendar METHOD:REPLY message) to the
 *   organizer, which their calendar applies to the event.
 * - Propose a new time: iTIP COUNTER to the organizer. Google's API has no
 *   proposal call; Google Calendar and Outlook both read COUNTER.
 */

const API = 'https://www.googleapis.com/calendar/v3';

const isCalendarPart = (a: AttachmentMeta) =>
  /^(text\/calendar|application\/ics)/i.test(a.contentType) || /\.ics$/i.test(a.filename);

/** The invite carried by a message, from its downloaded text/calendar part. */
export function readInvite(db: MailDb, attachmentsDir: string, messageId: string): IcsInvite | null {
  const body = db.getBody(messageId);
  if (!body) return null;
  // Prefer the inline text/calendar part (it carries METHOD) over invite.ics.
  const parts = body.attachments
    .filter(isCalendarPart)
    .sort((a, b) => Number(/^text\/calendar/i.test(b.contentType)) - Number(/^text\/calendar/i.test(a.contentType)));
  for (const part of parts) {
    if (!part.localPath) continue;
    try {
      const parsed = parseIcs(readFileSync(join(attachmentsDir, part.localPath), 'utf8'));
      if (parsed) return parsed;
    } catch {
      /* unreadable part: try the next */
    }
  }
  return null;
}

const lower = (s: string | undefined) => (s ?? '').trim().toLowerCase();

/** The Google event (or the one instance) an invite is about, if it's on the calendar. */
export async function findGoogleEvent(token: string, invite: IcsInvite): Promise<GEventItem | null> {
  const url = new URL(`${API}/calendars/primary/events`);
  url.searchParams.set('iCalUID', invite.uid);
  url.searchParams.set('maxResults', '50');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Google Calendar lookup failed (HTTP ${res.status})`);
  const items = ((await res.json()) as { items?: (GEventItem & { originalStartTime?: { dateTime?: string; date?: string }; recurringEventId?: string })[] }).items ?? [];
  const live = items.filter((i) => i.status !== 'cancelled');
  if (invite.recurrenceMs !== undefined) {
    const inst = live.find((i) => {
      const o = i.originalStartTime?.dateTime ?? i.originalStartTime?.date;
      return o && Math.abs(Date.parse(o) - invite.recurrenceMs!) < 60_000;
    });
    if (inst) return inst;
    // An instance Google hasn't split out yet: fetch it from the series.
    const master = live.find((i) => !i.recurringEventId);
    if (master) {
      const iu = new URL(`${API}/calendars/primary/events/${encodeURIComponent(master.id)}/instances`);
      iu.searchParams.set('originalStart', new Date(invite.recurrenceMs).toISOString());
      const r = await fetch(iu, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) {
        const found = ((await r.json()) as { items?: GEventItem[] }).items?.[0];
        if (found) return found;
      }
    }
    return null;
  }
  return live.find((i) => !(i as { recurringEventId?: string }).recurringEventId) ?? live[0] ?? null;
}

const selfOf = (item: GEventItem, email: string) =>
  item.attendees?.find((a) => a.self) ?? item.attendees?.find((a) => lower(a.email) === lower(email));

/** What the RSVP card shows for an invite. */
export function describeInvite(
  messageId: string,
  account: Account,
  invite: IcsInvite,
  google: GEventItem | null,
  nowMs = Date.now(),
): InviteInfo | null {
  if (invite.method !== 'REQUEST' && invite.method !== 'CANCEL' && invite.method !== '') return null;
  const me = lower(account.email);
  const isOrganizer = lower(invite.organizer?.email) === me;
  const mine = invite.attendees.find((a) => lower(a.email) === me);
  let myStatus = partstatToResponse(mine?.partstat);
  let startMs = invite.startMs;
  let endMs = invite.endMs;
  let allDay = invite.allDay;
  if (google) {
    const self = selfOf(google, account.email);
    myStatus = partstatToResponse(self?.responseStatus);
    const s = google.start?.dateTime ?? google.start?.date;
    const e = google.end?.dateTime ?? google.end?.date;
    if (s && e && google.start?.dateTime) {
      startMs = Date.parse(s);
      endMs = Date.parse(e);
      allDay = false;
    }
  }
  return {
    messageId,
    accountId: account.id,
    kind: invite.method === 'CANCEL' || invite.cancelled ? 'cancel' : 'request',
    summary: google?.summary ?? invite.summary,
    ...(google?.location ?? invite.location ? { location: google?.location ?? invite.location } : {}),
    startMs,
    endMs,
    allDay,
    recurring: invite.recurring,
    organizer: invite.organizer,
    attendees: invite.attendees
      .filter((a) => !a.resource && lower(a.email) !== me && lower(a.email) !== lower(invite.organizer?.email))
      .map((a) => ({ email: a.email, ...(a.name ? { name: a.name } : {}), status: partstatToResponse(a.partstat) })),
    myStatus,
    via: google ? 'google' : 'email',
    isOrganizer,
    past: endMs < nowMs,
  };
}

/** Set your answer on the Google event; Google emails the organizer. */
export async function respondOnGoogle(
  token: string,
  item: GEventItem,
  account: Account,
  response: InviteResponse,
  note?: string,
): Promise<void> {
  const attendees = (item.attendees ?? []).map((a) => ({ ...a }));
  let self = attendees.find((a) => a.self) ?? attendees.find((a) => lower(a.email) === lower(account.email));
  if (!self) {
    // Invited through a group: add yourself so the answer has somewhere to live.
    self = { email: account.email, self: true };
    attendees.push(self);
  }
  self.responseStatus = response;
  if (note?.trim()) (self as { comment?: string }).comment = note.trim();
  const url = `${API}/calendars/primary/events/${encodeURIComponent(item.id)}?sendUpdates=all`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ attendees }),
  });
  if (!res.ok) throw new Error(`Google Calendar didn’t take the answer (HTTP ${res.status})`);
}

/** The iTIP REPLY / COUNTER message for the organizer, ready for SMTP. */
export async function composeItip(
  account: Account,
  invite: IcsInvite,
  response: InviteResponse,
  opts: { note?: string; counter?: { startMs: number; endMs: number } } = {},
): Promise<{ raw: Buffer; to: string }> {
  const organizer = invite.organizer?.email;
  if (!organizer) throw new Error('This invite has no organizer to answer.');
  const listed = invite.attendees.find((a) => lower(a.email) === lower(account.email));
  const partstat = responseToPartstat(response);
  const ics = buildItip({
    invite,
    attendee: { email: listed?.email ?? account.email, name: account.displayName || listed?.name },
    partstat,
    comment: opts.note,
    counter: opts.counter,
  });
  const who = account.displayName || account.email;
  const verb = opts.counter
    ? 'has proposed a new time for'
    : response === 'accepted'
      ? 'has accepted'
      : response === 'declined'
        ? 'has declined'
        : 'has tentatively accepted';
  const text = `${who} ${verb} this invitation: ${invite.summary || 'Invitation'}${opts.note?.trim() ? `\n\n${opts.note.trim()}` : ''}`;
  const composer = new MailComposer({
    from: account.displayName ? `"${account.displayName.replace(/"/g, '')}" <${account.email}>` : account.email,
    to: invite.organizer?.name ? `"${invite.organizer.name.replace(/"/g, '')}" <${organizer}>` : organizer,
    subject: itipSubject({ partstat, counter: opts.counter }, invite.summary),
    text,
    icalEvent: { method: opts.counter ? 'COUNTER' : 'REPLY', content: ics },
  });
  const raw = await new Promise<Buffer>((resolve, reject) =>
    composer.compile().build((err, msg) => (err ? reject(err) : resolve(msg))),
  );
  return { raw, to: organizer };
}
