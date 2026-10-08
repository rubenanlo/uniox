import type { CalendarEvent } from '@app/shared';

/**
 * Availability suggestions: when an email asks when the user is free, offer a
 * few open times from their calendars. Everything here is pure (no IPC, no
 * DOM) so slot picking and formatting are unit-testable.
 */

export interface Slot {
  startMs: number;
  endMs: number;
}

const DAY_MS = 86_400_000;

export const SLOT_COUNT = 3;
export const DEFAULT_DURATION_MIN = 30;

/**
 * Cheap pre-filter run before asking the model: does the text plausibly ask
 * for a meeting time? English and Spanish phrasings; false negatives only
 * cost a missed suggestion (⌘⇧A still forces one).
 */
const ASK_PATTERNS: RegExp[] = [
  /\bavailab(le|ility)\b/i,
  /\bwhen (are|would|could|will) you\b/i,
  /\bwhat time(s)? (work|suit|would)/i,
  /\b(free|time) (to|for) (a )?(quick |short |brief )?(chat|call|meet|talk|catch up|connect)/i,
  /\b(find|set up|schedule|book|arrange) (a )?(time|call|meeting|slot)/i,
  /\b(hop|jump) on a (quick )?call\b/i,
  /\b(works?|suits?) (best )?for you\b/i,
  /\bdisponib(le|ilidad)\b/i,
  /\bcu[aá]ndo (puedes|podr[ií]as|te viene)/i,
  /\bqu[eé] (d[ií]a|hora) te (viene|va)/i,
];

export function looksLikeAvailabilityAsk(text: string): boolean {
  return ASK_PATTERNS.some((re) => re.test(text));
}

function localMidnight(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function addLocalDays(midnight: number, n: number): number {
  const d = new Date(midnight);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
}

/**
 * Local midnights of the next occurrence of each weekday, strictly after
 * today (so the sender has time to answer), in date order.
 */
/** "9:30" from minutes after midnight. */
export function minutesLabel(m: number): string {
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Tuesday, Wednesday and Thursday, 9:30–17:30" for explanations and empty states. */
export function describeWindow(p: {
  startMinutes: number;
  endMinutes: number;
  weekdays: number[];
}): string {
  const order = [1, 2, 3, 4, 5, 6, 0]
    .filter((d) => p.weekdays.includes(d))
    .map((d) => DAY_NAMES[d]!);
  const days =
    order.length > 1
      ? `${order.slice(0, -1).join(', ')} and ${order[order.length - 1]}`
      : (order[0] ?? '');
  return `${days}, ${minutesLabel(p.startMinutes)}–${minutesLabel(p.endMinutes)}`;
}

export function nextMeetingDays(now: number, weekdays: readonly number[]): number[] {
  const today = localMidnight(now);
  const days: number[] = [];
  for (let i = 1; i <= 7 && days.length < weekdays.length; i++) {
    const day = addLocalDays(today, i);
    if (weekdays.includes(new Date(day).getDay())) days.push(day);
  }
  return days;
}

/** Busy intervals, merged and sorted. Free ('transparent') events never block. */
export function busyIntervals(events: CalendarEvent[]): Slot[] {
  return mergeIntervals(
    events
      .filter((e) => e.transparency !== 'transparent')
      .map((e) => ({ startMs: e.startMs, endMs: e.endMs })),
  );
}

/** Sort and merge overlapping intervals; empty ones drop out. */
export function mergeIntervals(intervals: Slot[]): Slot[] {
  const raw = intervals.filter((i) => i.endMs > i.startMs).sort((a, b) => a.startMs - b.startMs);
  const merged: Slot[] = [];
  for (const iv of raw) {
    const last = merged[merged.length - 1];
    if (last && iv.startMs <= last.endMs) last.endMs = Math.max(last.endMs, iv.endMs);
    else merged.push({ ...iv });
  }
  return merged;
}

function overlaps(slot: Slot, busy: Slot[]): boolean {
  return busy.some((b) => b.startMs < slot.endMs && b.endMs > slot.startMs);
}

export interface SlotOptions {
  /** Local midnights of the candidate days. */
  days: number[];
  busy: Slot[];
  /** Working hours, local. */
  startHour: number;
  endHour: number;
  durationMin: number;
  count?: number;
  /** Candidate start granularity. */
  stepMin?: number;
  /** Nothing before this instant (defaults to no limit). */
  notBefore?: number;
  /** Extra test a candidate must pass (e.g. inside everyone's working day). */
  accept?: (slot: Slot) => boolean;
}

/** Times of day (hours) each successive pick aims for, so offers vary. */
const TARGET_HOURS = [10, 15, 11.5, 16.5, 9.5, 14];

/**
 * Pick `count` free slots spread across `days`: one per day first (aiming at
 * a different time of day each), then extra picks from days with room left.
 */
export function findFreeSlots(opts: SlotOptions): Slot[] {
  const count = opts.count ?? SLOT_COUNT;
  const step = (opts.stepMin ?? 30) * 60_000;
  const dur = opts.durationMin * 60_000;
  const candidatesByDay = opts.days.map((day) => {
    const d = new Date(day);
    const at = (h: number) =>
      new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
        Math.floor(h),
        Math.round((h % 1) * 60),
      ).getTime();
    const open = at(opts.startHour);
    const close = at(opts.endHour);
    const out: Slot[] = [];
    for (let s = open; s + dur <= close; s += step) {
      const slot = { startMs: s, endMs: s + dur };
      if (opts.notBefore !== undefined && s < opts.notBefore) continue;
      if (!overlaps(slot, opts.busy) && (opts.accept?.(slot) ?? true)) out.push(slot);
    }
    return { day, at, out };
  });

  const picked: Slot[] = [];
  const conflicts = (s: Slot) =>
    picked.some((p) => p.startMs < s.endMs + dur && p.endMs + dur > s.startMs);
  let target = 0;
  for (let round = 0; picked.length < count && round < count; round++) {
    for (const c of candidatesByDay) {
      if (picked.length >= count) break;
      const aim = c.at(TARGET_HOURS[target % TARGET_HOURS.length]!);
      const best = c.out
        .filter((s) => !conflicts(s))
        .sort((a, b) => Math.abs(a.startMs - aim) - Math.abs(b.startMs - aim))[0];
      if (!best) continue;
      picked.push(best);
      target++;
    }
  }
  return picked.sort((a, b) => a.startMs - b.startMs);
}

/** Expand the window the busy query needs to cover the given days. */
export function daysRange(days: number[]): { startMs: number; endMs: number } {
  const first = days[0] ?? localMidnight(Date.now());
  const last = days[days.length - 1] ?? first;
  return { startMs: first, endMs: last + DAY_MS };
}

/**
 * A zone label that can't be misread: the short name when the locale has a
 * real abbreviation (CEST, EDT), else the offset (GMT+8).
 */
export function zoneLabel(ms: number, timeZone?: string): string {
  const pick = (locale: string) =>
    new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' })
      .formatToParts(ms)
      .find((p) => p.type === 'timeZoneName')?.value ?? '';
  const us = pick('en-US');
  if (us && !/^(GMT|UTC)/.test(us)) return us;
  const gb = pick('en-GB');
  if (gb && !/^(GMT|UTC)[+-]/.test(gb)) return gb;
  return us || gb || 'local time';
}

function fmt(ms: number, opts: Intl.DateTimeFormatOptions, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone }).format(ms);
}

const TIME: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };

/** "10:00–10:30 (CEST)" in a zone. */
function timeRange(slot: Slot, timeZone?: string): string {
  return `${fmt(slot.startMs, TIME, timeZone)}–${fmt(slot.endMs, TIME, timeZone)} (${zoneLabel(slot.startMs, timeZone)})`;
}

/**
 * The full wording used in replies: "Tuesday, October 13, 10:00–10:30 (CEST)",
 * plus the sender's equivalent when their zone is known and differs — with
 * its own weekday if the date shifts.
 */
export function formatSlotLong(slot: Slot, senderTimeZone?: string | null): string {
  const day = fmt(slot.startMs, { weekday: 'long', month: 'long', day: 'numeric' });
  const mine = `${day}, ${timeRange(slot)}`;
  if (!senderTimeZone || !isValidZone(senderTimeZone)) return mine;
  const theirs = timeRange(slot, senderTimeZone);
  if (theirs === timeRange(slot)) return mine; // same zone as the user
  const theirDay = fmt(slot.startMs, { weekday: 'long' }, senderTimeZone);
  const myDay = fmt(slot.startMs, { weekday: 'long' });
  return `${mine} / ${theirDay !== myDay ? `${theirDay} ` : ''}${theirs}`;
}

/** Compact chip text: "Tue 13 · 10:00". */
export function formatSlotChip(slot: Slot): string {
  return `${fmt(slot.startMs, { weekday: 'short', day: 'numeric' })} · ${fmt(slot.startMs, TIME)}`;
}

export function isValidZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Plain-text reply used when the assistant isn't configured or fails. */
export function templateReply(
  slots: Slot[],
  senderTimeZone?: string | null,
  firstName?: string,
): string {
  const hi = firstName ? `Hi ${firstName},` : 'Hi,';
  const lines = slots.map((s) => formatSlotLong(s, senderTimeZone));
  if (lines.length === 1)
    return `${hi}\n\nI'm available on ${lines[0]}. Let me know if that works for you.`;
  return `${hi}\n\nI'm available at any of these times:\n${lines.map((l) => `• ${l}`).join('\n')}\n\nLet me know which works best for you.`;
}

/** What the model extracted from an email. */
export interface AvailabilityAsk {
  asks: boolean;
  durationMinutes: number;
  senderTimeZone: string | null;
}

/**
 * Parse the model's JSON answer leniently (it may wrap it in prose or a code
 * fence). Anything unparseable reads as "doesn't ask".
 */
export function parseAvailabilityAsk(raw: string): AvailabilityAsk {
  const none: AvailabilityAsk = {
    asks: false,
    durationMinutes: DEFAULT_DURATION_MIN,
    senderTimeZone: null,
  };
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return none;
  try {
    const v = JSON.parse(json) as Record<string, unknown>;
    const dur = Number(v.durationMinutes);
    const tz =
      typeof v.senderTimeZone === 'string' && isValidZone(v.senderTimeZone)
        ? v.senderTimeZone
        : null;
    return {
      asks: v.asks === true,
      durationMinutes:
        Number.isFinite(dur) && dur >= 15 && dur <= 240
          ? Math.round(dur / 15) * 15
          : DEFAULT_DURATION_MIN,
      senderTimeZone: tz,
    };
  } catch {
    return none;
  }
}

/* ── Group availability: everyone in To ─────────────────────────────── */

/** Someone else the meeting is with, as far as the user can see. */
export interface Participant {
  email: string;
  name?: string;
  /** IANA zone: their calendar's, else read from the thread, else null. */
  timeZone: string | null;
  /** Busy blocks when their calendar is visible, else null (unknown). */
  busy: Slot[] | null;
}

/** A time that suits everyone, and whether it stretches the user's own hours. */
export interface GroupSlot extends Slot {
  /** Outside the user's own Settings hours (only offered when nothing inside fits everyone). */
  outsideMine: boolean;
}

/** How far past their Settings hours the user may be stretched for a group. */
export const MY_STRETCH_MIN = 120;

/** Everyone else's working day, in their own zone. */
export const THEIR_DAY_START_MIN = 9 * 60;
export const THEIR_DAY_END_MIN = 18 * 60;

/** Minutes after midnight of an instant in a zone. */
function minutesIn(ms: number, timeZone?: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(ms);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}

/**
 * How many minutes `slot` falls outside 9:00–18:00 in `timeZone` (0 when it
 * fits). Unknown or invalid zones never count as outside.
 */
export function minutesOutsideDay(slot: Slot, timeZone: string | null): number {
  if (!timeZone || !isValidZone(timeZone)) return 0;
  const start = minutesIn(slot.startMs, timeZone);
  const end = start + Math.round((slot.endMs - slot.startMs) / 60_000);
  return Math.max(0, THEIR_DAY_START_MIN - start) + Math.max(0, end - THEIR_DAY_END_MIN);
}

export interface GroupSlotOptions extends Omit<SlotOptions, 'accept'> {
  participants: Participant[];
  /** Fallback days (e.g. the same weekdays a week later) when `days` has too few fits. */
  laterDays?: number[];
}

/**
 * Times free on the user's calendars and on every visible calendar of the
 * others, and always inside each other person's 9:00–18:00 in their own zone
 * (when known). The user's side gives way in this order:
 * 1. the user's Settings window on the next chosen days;
 * 2. the same window on the chosen days a week later;
 * 3. up to two hours either side of the window, closest first.
 * Fewer (or no) times come back when nothing fits everyone.
 */
export function findGroupSlots(opts: GroupSlotOptions): GroupSlot[] {
  const count = opts.count ?? SLOT_COUNT;
  const dur = opts.durationMin * 60_000;
  const busy = mergeIntervals([...opts.busy, ...opts.participants.flatMap((p) => p.busy ?? [])]);
  const fitsThem = (s: Slot) =>
    opts.participants.every((p) => minutesOutsideDay(s, p.timeZone) === 0);
  const mine = (s: Slot) => {
    const start = minutesIn(s.startMs);
    const end = start + opts.durationMin;
    return Math.max(0, opts.startHour * 60 - start) + Math.max(0, end - opts.endHour * 60);
  };
  const later = opts.laterDays ?? [];

  const picked: Slot[] = findFreeSlots({ ...opts, busy, accept: fitsThem });
  if (picked.length < count && later.length) {
    picked.push(
      ...findFreeSlots({
        ...opts,
        days: later,
        busy,
        accept: fitsThem,
        count: count - picked.length,
      }),
    );
  }
  if (picked.length < count) {
    const near = (a: Slot, b: Slot) => a.startMs < b.endMs + dur && a.endMs + dur > b.startMs;
    const stretched = findFreeSlots({
      ...opts,
      days: [...opts.days, ...later],
      busy,
      startHour: Math.max(6, opts.startHour - MY_STRETCH_MIN / 60),
      endHour: Math.min(22, opts.endHour + MY_STRETCH_MIN / 60),
      count: 1000,
      accept: (s) => fitsThem(s) && mine(s) > 0,
    }).sort((a, b) => mine(a) - mine(b) || a.startMs - b.startMs);
    for (const s of stretched) {
      if (picked.length >= count) break;
      if (!picked.some((p) => near(p, s))) picked.push(s);
    }
  }
  return picked
    .sort((a, b) => a.startMs - b.startMs)
    .map((s) => ({ ...s, outsideMine: mine(s) > 0 }));
}

function firstName(p: { name?: string; email: string }): string {
  return (p.name || '').trim().split(/\s+/)[0] || p.email.split('@')[0]!;
}

/**
 * "Tuesday, October 13, 15:00–15:30 (CEST) / 9:00–9:30 (EDT) Alex, Sam":
 * the user's time, then each other zone once with the people in it.
 */
export function formatSlotForPeople(slot: Slot, people: Participant[]): string {
  const mine = formatSlotLong(slot);
  const myRange = timeRange(slot);
  const myDay = fmt(slot.startMs, { weekday: 'long' });
  const byZone = new Map<string, string[]>();
  for (const p of people) {
    if (!p.timeZone || !isValidZone(p.timeZone)) continue;
    const range = timeRange(slot, p.timeZone);
    if (range === myRange) continue;
    const day = fmt(slot.startMs, { weekday: 'long' }, p.timeZone);
    const key = `${day !== myDay ? `${day} ` : ''}${range}`;
    byZone.set(key, [...(byZone.get(key) ?? []), firstName(p)]);
  }
  return [mine, ...[...byZone].map(([when, names]) => `${when} ${names.join(', ')}`)].join(' / ');
}

/** "early for you" / "late for you" when a time stretches the user's own hours. */
export function offHoursNote(slot: GroupSlot): string {
  if (!slot.outsideMine) return '';
  return `${minutesIn(slot.startMs) < 12 * 60 ? 'early' : 'late'} for you`;
}

/** Plain-text group offer, used when the assistant isn't configured or fails. */
export function templateGroupReply(
  slots: Slot[],
  people: Participant[],
  greeting?: string,
): string {
  const hi = greeting ? `Hi ${greeting},` : 'Hi all,';
  const lines = slots.map((s) => `• ${formatSlotForPeople(s, people)}`).join('\n');
  return `${hi}\n\nThese times work on my side:\n${lines}\n\nLet me know which works best for everyone.`;
}

/**
 * Parse the model's guess of each person's zone ({"email": "Zone/Name"}),
 * keeping only valid IANA names.
 */
export function parseZoneGuesses(raw: string): Record<string, string> {
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return {};
  try {
    const v = JSON.parse(json) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [email, tz] of Object.entries(v)) {
      if (typeof tz === 'string' && isValidZone(tz)) out[email.toLowerCase()] = tz;
    }
    return out;
  } catch {
    return {};
  }
}
