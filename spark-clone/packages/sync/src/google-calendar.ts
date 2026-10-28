/**
 * Google Calendar v3 → local rows (phase 2). Initial sync fetches
 * `singleEvents=true` instances for a fixed window around now (recurring
 * events arrive pre-expanded; deletions fall out via the prune step) and
 * yields a syncToken; subsequent polls fetch only changes since that token —
 * cancelled instances propagate deletions. A 410 means the token expired and
 * the caller re-runs the windowed fetch.
 */

const API = 'https://www.googleapis.com/calendar/v3';

/** Six months back, eighteen months forward — matches what a calendar UI can reach. */
export const SYNC_PAST_MS = 183 * 86_400_000;
export const SYNC_FUTURE_MS = 550 * 86_400_000;

export interface GCalListItem {
  id: string;
  summary?: string;
  backgroundColor?: string;
  primary?: boolean;
  selected?: boolean;
  accessRole?: string;
}

interface GEventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GEventItem {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GEventTime;
  end?: GEventTime;
  eventType?: string;
  hangoutLink?: string;
  /** Meet, or a third-party add-on (Zoom, Teams) — its video entry point is the join link. */
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  colorId?: string;
  /** 'transparent' = shows as Free; absent/'opaque' = Busy. */
  transparency?: string;
}

/** The row shape handed to MailDb.upsertGoogleEvent. */
export interface MappedGoogleEvent {
  id: string;
  calendarId: string;
  remoteId: string;
  title: string;
  description: string;
  location: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  eventType: 'default' | 'outOfOffice';
  meetingUrl?: string;
  color?: string;
  transparency?: 'opaque' | 'transparent';
}

/** Google's 11-color event palette (colorId → hex). */
const EVENT_COLORS: Record<string, string> = {
  '1': '#7986cb', '2': '#33b679', '3': '#8e24aa', '4': '#e67c73',
  '5': '#f6bf26', '6': '#f4511e', '7': '#039be5', '8': '#616161',
  '9': '#3f51b5', '10': '#0b8043', '11': '#d50000',
};

/**
 * Google times: `date` (YYYY-MM-DD, all-day, end exclusive — matching our
 * exclusive-midnight convention) or `dateTime` (RFC 3339 with offset).
 * All-day dates land on LOCAL midnight, like the rest of the calendar.
 */
export function parseGTime(t: GEventTime | undefined): { ms: number; allDay: boolean } | null {
  if (t?.dateTime) {
    const ms = Date.parse(t.dateTime);
    return Number.isNaN(ms) ? null : { ms, allDay: false };
  }
  if (t?.date) {
    const [y, m, d] = t.date.split('-').map(Number);
    if (!y) return null;
    return { ms: new Date(y, (m ?? 1) - 1, d ?? 1).getTime(), allDay: true };
  }
  return null;
}

/**
 * The primary calendar maps onto the account's existing `acct:` row (so the
 * form's account picker and phase-3 write-back line up); the rest get their
 * own rows keyed by remote id.
 */
export function calendarRowId(accountId: string, remote: Pick<GCalListItem, 'id' | 'primary'>): string {
  return remote.primary ? `acct:${accountId}` : `gcal:${accountId}:${remote.id}`;
}

/**
 * The event's join link: Meet's hangoutLink, else a conference add-on's video
 * entry point, else a location that is nothing but a URL (a pasted Zoom link).
 */
export function meetingUrlOf(item: GEventItem): string | undefined {
  if (item.hangoutLink) return item.hangoutLink;
  const video = item.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri;
  if (video) return video;
  const loc = item.location?.trim() ?? '';
  return /^https?:\/\/\S+$/.test(loc) ? loc : undefined;
}

/** null = skip (cancelled, unparseable, or working-location noise). */
export function mapGoogleEvent(item: GEventItem, calendarId: string): MappedGoogleEvent | null {
  if (item.status === 'cancelled') return null;
  if (item.eventType === 'workingLocation') return null; // home/office markers, not events
  const start = parseGTime(item.start);
  const end = parseGTime(item.end);
  if (!start || !end) return null;
  return {
    id: `gev:${calendarId}:${item.id}`,
    calendarId,
    remoteId: item.id,
    title: item.summary ?? '',
    description: (item.description ?? '').slice(0, 4000),
    location: item.location ?? '',
    startMs: start.ms,
    endMs: Math.max(end.ms, start.ms),
    allDay: start.allDay,
    eventType: item.eventType === 'outOfOffice' ? 'outOfOffice' : 'default',
    meetingUrl: meetingUrlOf(item),
    color: item.colorId ? EVENT_COLORS[item.colorId] : undefined,
    transparency: item.transparency === 'transparent' ? 'transparent' : undefined,
  };
}

/**
 * Local ms → Google event times. Timed events send UTC dateTimes; all-day
 * events send local dates, keeping the exclusive-end-date convention (our
 * exclusive-midnight endMs already lands on the day after the last day).
 */
export function gEventTimes(
  startMs: number,
  endMs: number,
  allDay: boolean,
): { start: GEventTime; end: GEventTime } {
  if (!allDay) {
    return {
      start: { dateTime: new Date(startMs).toISOString() },
      end: { dateTime: new Date(endMs).toISOString() },
    };
  }
  const local = (ms: number) => {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  return { start: { date: local(startMs) }, end: { date: local(endMs) } };
}

/** Fields a reschedule/edit can push upstream; text fields only when provided. */
export interface GEventPatch {
  startMs: number;
  endMs: number;
  allDay: boolean;
  title?: string;
  location?: string;
  description?: string;
  transparency?: 'opaque' | 'transparent';
}

export async function patchGoogleEvent(
  token: string,
  remoteCalendarId: string,
  remoteEventId: string,
  patch: GEventPatch,
): Promise<void> {
  const body: Record<string, unknown> = gEventTimes(patch.startMs, patch.endMs, patch.allDay);
  if (patch.title !== undefined) body.summary = patch.title;
  if (patch.location !== undefined) body.location = patch.location;
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.transparency !== undefined) body.transparency = patch.transparency;
  const res = await fetch(
    `${API}/calendars/${encodeURIComponent(remoteCalendarId)}/events/${encodeURIComponent(remoteEventId)}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(`Could not update the Google event (HTTP ${res.status})`);
}

/** A new event created upstream; `addMeet` asks Google to attach a Meet link. */
export interface GEventInsert {
  title: string;
  description?: string;
  location?: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  rrule?: string;
  transparency?: 'opaque' | 'transparent';
  addMeet?: boolean;
}

export function gEventInsertBody(ev: GEventInsert, timeZone: string, requestId: string) {
  const times = gEventTimes(ev.startMs, ev.endMs, ev.allDay);
  // Recurring timed events need a zone to expand in; harmless on the rest.
  if (!ev.allDay) {
    times.start.timeZone = timeZone;
    times.end.timeZone = timeZone;
  }
  return {
    summary: ev.title,
    ...(ev.description ? { description: ev.description } : {}),
    ...(ev.location ? { location: ev.location } : {}),
    ...times,
    ...(ev.rrule ? { recurrence: [`RRULE:${ev.rrule}`] } : {}),
    ...(ev.transparency === 'transparent' ? { transparency: 'transparent' } : {}),
    ...(ev.addMeet
      ? { conferenceData: { createRequest: { requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } } }
      : {}),
  };
}

/**
 * Create the event on Google. With `addMeet` the Meet link is usually in the
 * response already; when Google is still provisioning it, the next sync picks
 * it up.
 */
export async function insertGoogleEvent(
  token: string,
  remoteCalendarId: string,
  ev: GEventInsert,
  timeZone: string,
  requestId: string,
): Promise<GEventItem> {
  const res = await fetch(
    `${API}/calendars/${encodeURIComponent(remoteCalendarId)}/events?conferenceDataVersion=1`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(gEventInsertBody(ev, timeZone, requestId)),
    },
  );
  if (!res.ok) throw new Error(`Could not create the Google event (HTTP ${res.status})`);
  return (await res.json()) as GEventItem;
}

export class SyncTokenExpiredError extends Error {}

async function gget<T>(token: string, path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 410) {
    throw new SyncTokenExpiredError(`Google Calendar ${path}: sync token expired`);
  }
  if (!res.ok) throw new Error(`Google Calendar ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Subscribe the account to another calendar (e.g. a colleague's, by their email
 * as the calendar id). Returns the created calendarList entry. A 404/403 means
 * the calendar isn't shared with this account or doesn't exist.
 */
export async function subscribeGoogleCalendar(
  token: string,
  calendarId: string,
): Promise<GCalListItem> {
  const res = await fetch(`${API}/users/me/calendarList`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: calendarId }),
  });
  if (!res.ok) {
    const detail = res.status === 404 || res.status === 403 ? ' — is it shared with you?' : '';
    throw new Error(`Could not add that calendar (HTTP ${res.status})${detail}`);
  }
  return (await res.json()) as GCalListItem;
}

/** Unsubscribe the account from a calendar (removes it from Google entirely). */
export async function unsubscribeGoogleCalendar(token: string, calendarId: string): Promise<void> {
  const res = await fetch(
    `${API}/users/me/calendarList/${encodeURIComponent(calendarId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  );
  // 410 Gone = already unsubscribed; treat as success.
  if (!res.ok && res.status !== 410) {
    throw new Error(`Could not unsubscribe (HTTP ${res.status})`);
  }
}

export async function listGoogleCalendars(token: string): Promise<GCalListItem[]> {
  const out: GCalListItem[] = [];
  let pageToken = '';
  do {
    const page = await gget<{ items?: GCalListItem[]; nextPageToken?: string }>(
      token,
      '/users/me/calendarList',
      { maxResults: '250', ...(pageToken ? { pageToken } : {}) },
    );
    out.push(...(page.items ?? []));
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

async function pageEvents(
  token: string,
  remoteCalendarId: string,
  baseParams: Record<string, string>,
): Promise<{ items: GEventItem[]; nextSyncToken: string | null }> {
  const out: GEventItem[] = [];
  let nextSyncToken: string | null = null;
  let pageToken = '';
  do {
    const page = await gget<{
      items?: GEventItem[];
      nextPageToken?: string;
      nextSyncToken?: string;
    }>(token, `/calendars/${encodeURIComponent(remoteCalendarId)}/events`, {
      ...baseParams,
      maxResults: '2500',
      ...(pageToken ? { pageToken } : {}),
    });
    out.push(...(page.items ?? []));
    pageToken = page.nextPageToken ?? '';
    nextSyncToken = page.nextSyncToken ?? nextSyncToken;
  } while (pageToken);
  return { items: out, nextSyncToken };
}

/**
 * Free-text search (`q` matches summary, description, location and attendees)
 * over the years the windowed sync never stores: before `beforeMs` the most
 * recent `max` matches, after `afterMs` the earliest. One page each — Google
 * can only sort ascending, so the past page is trimmed from its end.
 */
export async function searchGoogleEvents(
  token: string,
  remoteCalendarId: string,
  q: string,
  beforeMs: number,
  afterMs: number,
  max = 15,
): Promise<GEventItem[]> {
  const path = `/calendars/${encodeURIComponent(remoteCalendarId)}/events`;
  const base = { q, singleEvents: 'true', orderBy: 'startTime' };
  const [past, future] = await Promise.all([
    gget<{ items?: GEventItem[] }>(token, path, {
      ...base,
      timeMax: new Date(beforeMs).toISOString(),
      maxResults: '250',
    }),
    gget<{ items?: GEventItem[] }>(token, path, {
      ...base,
      timeMin: new Date(afterMs).toISOString(),
      maxResults: String(max),
    }),
  ]);
  return [...(past.items ?? []).slice(-max), ...(future.items ?? [])];
}

export function listGoogleEvents(
  token: string,
  remoteCalendarId: string,
  timeMinIso: string,
  timeMaxIso: string,
): Promise<{ items: GEventItem[]; nextSyncToken: string | null }> {
  return pageEvents(token, remoteCalendarId, {
    singleEvents: 'true', // recurring events arrive pre-expanded as instances
    timeMin: timeMinIso,
    timeMax: timeMaxIso,
  });
}

/** Changes since `syncToken` — includes cancelled instances so deletions propagate. */
export function listGoogleEventsChanged(
  token: string,
  remoteCalendarId: string,
  syncToken: string,
): Promise<{ items: GEventItem[]; nextSyncToken: string | null }> {
  return pageEvents(token, remoteCalendarId, { singleEvents: 'true', syncToken });
}

/**
 * Busy blocks for other people's calendars (by email). Google answers with
 * busy times only when the caller may see them (same Workspace, or shared);
 * otherwise the entry carries errors and comes back as null.
 */
export async function queryFreeBusy(
  token: string,
  emails: string[],
  startMs: number,
  endMs: number,
): Promise<Record<string, { startMs: number; endMs: number }[] | null>> {
  const res = await fetch(`${API}/freeBusy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeMin: new Date(startMs).toISOString(),
      timeMax: new Date(endMs).toISOString(),
      items: emails.map((id) => ({ id })),
    }),
  });
  if (!res.ok) throw new Error(`Google Calendar /freeBusy: HTTP ${res.status}`);
  const data = (await res.json()) as {
    calendars?: Record<
      string,
      { busy?: { start: string; end: string }[]; errors?: { reason?: string }[] }
    >;
  };
  const out: Record<string, { startMs: number; endMs: number }[] | null> = {};
  for (const email of emails) {
    const cal = data.calendars?.[email];
    out[email] =
      !cal || cal.errors?.length
        ? null
        : (cal.busy ?? []).map((b) => ({ startMs: Date.parse(b.start), endMs: Date.parse(b.end) }));
  }
  return out;
}

/** A calendar's IANA zone, or null when the caller can't read its details. */
export async function getCalendarTimeZone(
  token: string,
  calendarId: string,
): Promise<string | null> {
  const res = await fetch(`${API}/calendars/${encodeURIComponent(calendarId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const cal = (await res.json()) as { timeZone?: string };
  return cal.timeZone || null;
}
