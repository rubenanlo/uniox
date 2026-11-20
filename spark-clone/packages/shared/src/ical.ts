/**
 * Just enough iCalendar (RFC 5545) and iTIP (RFC 5546) for meeting invites
 * that arrive by email: read the VEVENT out of an invite's text/calendar part,
 * and write the REPLY (accept / maybe / decline) or COUNTER (propose a new
 * time) that calendar apps send back to the organizer.
 */

export type PartStat = 'NEEDS-ACTION' | 'ACCEPTED' | 'DECLINED' | 'TENTATIVE' | 'DELEGATED';

export interface IcsPerson {
  email: string;
  name?: string;
}

export interface IcsAttendee extends IcsPerson {
  partstat: PartStat;
  /** Rooms and other resources (CUTYPE=RESOURCE/ROOM). */
  resource: boolean;
}

export interface IcsInvite {
  /** REQUEST, CANCEL, REPLY, COUNTER, PUBLISH … (upper case; '' when missing). */
  method: string;
  uid: string;
  sequence: number;
  /** The occurrence this invite is about (one instance of a series), raw. */
  recurrenceId?: string;
  /** The same occurrence as epoch ms. */
  recurrenceMs?: number;
  summary: string;
  location?: string;
  description?: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  /** The event repeats (RRULE present). */
  recurring: boolean;
  organizer: IcsPerson | null;
  attendees: IcsAttendee[];
  /** STATUS:CANCELLED on the event itself. */
  cancelled: boolean;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Unfold continuation lines and split each into name, params and value. */
function parseLines(text: string): Prop[] {
  const unfolded = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  const out: Prop[] = [];
  for (const line of unfolded.split('\n')) {
    if (!line.trim()) continue;
    // The value starts at the first ':' outside a quoted parameter.
    let quoted = false;
    let colon = -1;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') quoted = !quoted;
      else if (c === ':' && !quoted) {
        colon = i;
        break;
      }
    }
    if (colon < 0) continue;
    const head = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const parts: string[] = [];
    quoted = false;
    let cur = '';
    for (const c of head) {
      if (c === '"') quoted = !quoted;
      if (c === ';' && !quoted) {
        parts.push(cur);
        cur = '';
      } else cur += c;
    }
    parts.push(cur);
    const params: Record<string, string> = {};
    for (const p of parts.slice(1)) {
      const eq = p.indexOf('=');
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
    }
    out.push({ name: parts[0]!.toUpperCase(), params, value });
  }
  return out;
}

const unescapeText = (v: string) =>
  v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

const escapeText = (v: string) =>
  v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

const mailto = (v: string) => v.replace(/^mailto:/i, '').trim();

/** Outlook/Exchange zone names seen in invites → IANA. */
const WINDOWS_ZONES: Record<string, string> = {
  'Romance Standard Time': 'Europe/Paris',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'GTB Standard Time': 'Europe/Bucharest',
  'Russian Standard Time': 'Europe/Moscow',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'SA Pacific Standard Time': 'America/Bogota',
  'Pacific SA Standard Time': 'America/Santiago',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'Argentina Standard Time': 'America/Buenos_Aires',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Singapore Standard Time': 'Asia/Singapore',
  'Arabian Standard Time': 'Asia/Dubai',
  'West Asia Standard Time': 'Asia/Tashkent',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'E. Africa Standard Time': 'Africa/Nairobi',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  UTC: 'UTC',
};

function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Offset (ms) of `zone` from UTC at the instant `utcMs`. */
function zoneOffset(utcMs: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - utcMs;
}

/** A wall-clock time in `zone` → epoch ms (two passes settle DST edges). */
export function wallTimeToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  zone: string,
): number {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  let ms = naive - zoneOffset(naive, zone);
  ms = naive - zoneOffset(ms, zone);
  return ms;
}

/** "+0100" / "-0530" → minutes. */
function parseOffset(v: string): number | null {
  const m = /^([+-])(\d{2})(\d{2})/.exec(v.trim());
  if (!m) return null;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * Parse a DATE or DATE-TIME value. `zoneOffsets` are the STANDARD offsets of
 * the file's VTIMEZONEs, used when a TZID is neither IANA nor a known Windows
 * name (a fixed offset beats guessing the local zone).
 */
function parseDate(
  p: Prop,
  zoneOffsets: Map<string, number>,
): { ms: number; allDay: boolean } | null {
  const v = p.value.trim();
  const dm = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dm || p.params.VALUE === 'DATE') {
    const m = dm ?? /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return null;
    // All-day: local midnight, like the rest of the app's all-day events.
    return { ms: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime(), allDay: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number) as [
    number, number, number, number, number, number,
  ];
  if (m[7]) return { ms: Date.UTC(y, mo - 1, d, h, mi, s), allDay: false };
  const tzid = p.params.TZID?.replace(/^\//, '');
  if (tzid) {
    const iana = validZone(tzid) ? tzid : WINDOWS_ZONES[tzid];
    if (iana) return { ms: wallTimeToUtc(y, mo, d, h, mi, s, iana), allDay: false };
    const off = zoneOffsets.get(tzid);
    if (off !== undefined) return { ms: Date.UTC(y, mo - 1, d, h, mi, s) - off * 60_000, allDay: false };
  }
  // Floating time: the reader's own zone.
  return { ms: new Date(y, mo - 1, d, h, mi, s).getTime(), allDay: false };
}

const PARTSTATS: PartStat[] = ['NEEDS-ACTION', 'ACCEPTED', 'DECLINED', 'TENTATIVE', 'DELEGATED'];

/** The first VEVENT of an invite, or null when the text holds none. */
export function parseIcs(text: string): IcsInvite | null {
  const props = parseLines(text);
  let method = '';
  const zoneOffsets = new Map<string, number>();
  const stack: string[] = [];
  let tzid: string | null = null;
  let event: Prop[] | null = null;
  let eventDone = false;
  for (const p of props) {
    if (p.name === 'BEGIN') {
      const comp = p.value.trim().toUpperCase();
      stack.push(comp);
      if (comp === 'VEVENT' && !event) event = [];
      continue;
    }
    if (p.name === 'END') {
      const comp = stack.pop();
      if (comp === 'VEVENT' && event && !eventDone) eventDone = true;
      if (comp === 'VTIMEZONE') tzid = null;
      continue;
    }
    const top = stack[stack.length - 1];
    if (top === 'VCALENDAR' && p.name === 'METHOD') method = p.value.trim().toUpperCase();
    if (top === 'VTIMEZONE' && p.name === 'TZID') tzid = p.value.trim();
    if (top === 'STANDARD' && p.name === 'TZOFFSETTO' && tzid) {
      const off = parseOffset(p.value);
      if (off !== null) zoneOffsets.set(tzid, off);
    }
    // Only the first VEVENT's own properties (not its VALARMs).
    if (top === 'VEVENT' && event && !eventDone) event.push(p);
  }
  if (!event) return null;

  const one = (name: string) => event!.find((p) => p.name === name);
  const uid = one('UID')?.value.trim();
  const dtStart = one('DTSTART');
  if (!uid || !dtStart) return null;
  const start = parseDate(dtStart, zoneOffsets);
  if (!start) return null;
  const dtEnd = one('DTEND');
  let end = dtEnd ? parseDate(dtEnd, zoneOffsets) : null;
  if (!end) {
    const dur = one('DURATION')?.value;
    const ms = dur ? parseDuration(dur) : start.allDay ? 86_400_000 : 3_600_000;
    end = { ms: start.ms + ms, allDay: start.allDay };
  }
  const orgProp = one('ORGANIZER');
  const organizer = orgProp
    ? { email: mailto(orgProp.value), ...(orgProp.params.CN ? { name: orgProp.params.CN } : {}) }
    : null;
  const attendees: IcsAttendee[] = event
    .filter((p) => p.name === 'ATTENDEE')
    .map((p) => {
      const ps = (p.params.PARTSTAT ?? 'NEEDS-ACTION').toUpperCase() as PartStat;
      const cutype = (p.params.CUTYPE ?? '').toUpperCase();
      return {
        email: mailto(p.value),
        ...(p.params.CN ? { name: p.params.CN } : {}),
        partstat: PARTSTATS.includes(ps) ? ps : 'NEEDS-ACTION',
        resource: cutype === 'RESOURCE' || cutype === 'ROOM',
      };
    })
    .filter((a) => a.email);
  const rid = one('RECURRENCE-ID');
  const location = one('LOCATION')?.value;
  const description = one('DESCRIPTION')?.value;
  return {
    method,
    uid,
    sequence: Number(one('SEQUENCE')?.value ?? 0) || 0,
    ...(rid ? { recurrenceId: rid.value.trim() } : {}),
    ...(rid && parseDate(rid, zoneOffsets) ? { recurrenceMs: parseDate(rid, zoneOffsets)!.ms } : {}),
    summary: unescapeText(one('SUMMARY')?.value ?? ''),
    ...(location ? { location: unescapeText(location) } : {}),
    ...(description ? { description: unescapeText(description) } : {}),
    startMs: start.ms,
    endMs: end.ms,
    allDay: start.allDay,
    recurring: !!one('RRULE'),
    organizer,
    attendees,
    cancelled: (one('STATUS')?.value ?? '').trim().toUpperCase() === 'CANCELLED',
  };
}

/** "PT1H30M" / "P1D" → ms. */
function parseDuration(v: string): number {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return 3_600_000;
  const [, , w, d, h, mi, s] = m;
  return (
    (Number(w ?? 0) * 7 * 86_400 + Number(d ?? 0) * 86_400 + Number(h ?? 0) * 3600 + Number(mi ?? 0) * 60 + Number(s ?? 0)) *
    1000
  );
}

// ---- writing ---------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');
const utcStamp = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
};
const localDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
};

/** Fold to 75 octets-ish (75 chars; invites are short) per RFC 5545 §3.1. */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const out: string[] = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) out.push(' ' + line.slice(i, i + 74));
  return out.join('\r\n');
}

const quoteParam = (v: string) => `"${v.replace(/"/g, "'")}"`;

export interface ItipResponse {
  invite: IcsInvite;
  /** You, as the invite lists you (or your account address). */
  attendee: IcsPerson;
  partstat: Exclude<PartStat, 'NEEDS-ACTION' | 'DELEGATED'>;
  /** A short note to the organizer. */
  comment?: string;
  /** Propose this time instead (METHOD:COUNTER). */
  counter?: { startMs: number; endMs: number };
  /** Defaults to now; tests pin it. */
  nowMs?: number;
}

/**
 * The calendar part of an iTIP REPLY (or COUNTER with `counter`): what Apple
 * Calendar, Outlook and Google Calendar send when you answer an invite. The
 * organizer's calendar applies it to the event; it is not a written reply.
 */
export function buildItip(r: ItipResponse): string {
  const { invite, attendee } = r;
  const method = r.counter ? 'COUNTER' : 'REPLY';
  const start = r.counter?.startMs ?? invite.startMs;
  const end = r.counter?.endMs ?? invite.endMs;
  const allDay = invite.allDay && !r.counter;
  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//Uniox//Mail//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${invite.uid}`,
    ...(invite.recurrenceId ? [`RECURRENCE-ID:${invite.recurrenceId}`] : []),
    `SEQUENCE:${invite.sequence}`,
    `DTSTAMP:${utcStamp(r.nowMs ?? Date.now())}`,
    allDay ? `DTSTART;VALUE=DATE:${localDate(start)}` : `DTSTART:${utcStamp(start)}`,
    allDay ? `DTEND;VALUE=DATE:${localDate(end)}` : `DTEND:${utcStamp(end)}`,
    `SUMMARY:${escapeText(invite.summary)}`,
    ...(invite.location ? [`LOCATION:${escapeText(invite.location)}`] : []),
    ...(invite.organizer
      ? [
          `ORGANIZER${invite.organizer.name ? `;CN=${quoteParam(invite.organizer.name)}` : ''}:mailto:${invite.organizer.email}`,
        ]
      : []),
    `ATTENDEE;PARTSTAT=${r.partstat}${attendee.name ? `;CN=${quoteParam(attendee.name)}` : ''}:mailto:${attendee.email}`,
    ...(r.comment?.trim() ? [`COMMENT:${escapeText(r.comment.trim())}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** "Accepted: Weekly sync" — the subject calendar apps put on a REPLY. */
export function itipSubject(r: Pick<ItipResponse, 'partstat' | 'counter'>, summary: string): string {
  const label = r.counter
    ? 'New time proposed'
    : r.partstat === 'ACCEPTED'
      ? 'Accepted'
      : r.partstat === 'DECLINED'
        ? 'Declined'
        : 'Tentatively accepted';
  return `${label}: ${summary || 'Invitation'}`;
}

// ---- what the app shows ----------------------------------------------------

export type InviteResponse = 'accepted' | 'tentative' | 'declined';

/** An emailed invite as the reader's RSVP card shows it. */
export interface InviteInfo {
  messageId: string;
  accountId: string;
  /** 'request' = asks for an answer; 'cancel' = the organizer called it off. */
  kind: 'request' | 'cancel';
  summary: string;
  location?: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  recurring: boolean;
  organizer: IcsPerson | null;
  /** Other people invited (not you, not rooms). */
  attendees: (IcsPerson & { status: InviteResponse | 'needs-action' })[];
  /** Your current answer. */
  myStatus: InviteResponse | 'needs-action';
  /**
   * 'google': the answer is set on the event in your Google Calendar, which
   * notifies the organizer (as Gmail's Yes / No / Maybe do). 'email': the
   * standard iTIP calendar reply goes to the organizer (as Apple Mail and
   * Outlook do for non-Google calendars).
   */
  via: 'google' | 'email';
  /** You organized it: nothing to answer. */
  isOrganizer: boolean;
  /** The event has already started or ended. */
  past: boolean;
}

export const partstatToResponse = (p: PartStat | string | undefined): InviteResponse | 'needs-action' => {
  switch ((p ?? '').toUpperCase()) {
    case 'ACCEPTED':
      return 'accepted';
    case 'DECLINED':
      return 'declined';
    case 'TENTATIVE':
      return 'tentative';
    default:
      return 'needs-action';
  }
};

export const responseToPartstat = (r: InviteResponse): 'ACCEPTED' | 'DECLINED' | 'TENTATIVE' =>
  r === 'accepted' ? 'ACCEPTED' : r === 'declined' ? 'DECLINED' : 'TENTATIVE';
