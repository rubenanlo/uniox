import { addDays, startOfDay } from './calendarMonth';

/**
 * Typed-date parsing for the calendar's Go to date dialog. Returns the local
 * start of the day, or null when the text isn't a date. Understands:
 *   today / tomorrow / yesterday
 *   fri, next friday, last friday
 *   +3, -2, +2w, in 3 days, 2 weeks ago, next week, next month
 *   2026-11-15, 15/11/2026, 15.11, 11/15 (day/month order follows the locale)
 *   15 nov, nov 15, 15th november 2026, november 2026, december
 */

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** "nov", "sept", "november" → 0-based month; needs at least three letters. */
function monthIndex(word: string): number {
  if (word.length < 3) return -1;
  return MONTHS.findIndex((m) => m.startsWith(word));
}

function weekdayIndex(word: string): number {
  if (word.length < 2) return -1;
  return WEEKDAYS.findIndex((d) => d.startsWith(word));
}

/** True when the locale writes the day before the month (15/11 rather than 11/15). */
export function localeDayFirst(locale?: string): boolean {
  const parts = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric' }).formatToParts(
    new Date(2000, 10, 22),
  );
  return parts.findIndex((p) => p.type === 'day') < parts.findIndex((p) => p.type === 'month');
}

function fullYear(y: string | undefined, fallback: number): number {
  if (!y) return fallback;
  const n = Number(y);
  return y.length <= 2 ? 2000 + n : n;
}

/** A real calendar date, or null (rejects 31 Feb rather than rolling it over). */
function ymd(y: number, m: number, d: number): number | null {
  const date = new Date(y, m, d);
  if (date.getFullYear() !== y || date.getMonth() !== m || date.getDate() !== d) return null;
  return date.getTime();
}

function addMonthsKeepDay(dayMs: number, n: number): number {
  const d = new Date(dayMs);
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), last));
  return target.getTime();
}

const UNIT_DAYS: Record<string, number> = { d: 1, day: 1, days: 1, w: 7, week: 7, weeks: 7 };

export function parseDateInput(
  input: string,
  now: number = Date.now(),
  dayFirst: boolean = localeDayFirst(),
): number | null {
  const text = input.trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  if (!text) return null;
  const today = startOfDay(now);
  const year = new Date(today).getFullYear();

  if (text === 'today' || text === 'now') return today;
  if (text === 'tomorrow' || text === 'tmrw') return addDays(today, 1);
  if (text === 'yesterday') return addDays(today, -1);

  // Relative: +3, -2w, in 3 days, 2 weeks ago, next/last week, next/last month
  let m = text.match(/^([+-])\s*(\d+)\s*(d|w|days?|weeks?|m|months?)?$/);
  if (m) {
    const n = Number(m[2]) * (m[1] === '-' ? -1 : 1);
    const unit = m[3] ?? 'd';
    if (unit.startsWith('m')) return addMonthsKeepDay(today, n);
    return addDays(today, n * UNIT_DAYS[unit]!);
  }
  m = text.match(/^(?:in )?(\d+) (days?|weeks?|months?)( ago)?$/);
  if (m && (text.startsWith('in ') || m[3])) {
    const n = Number(m[1]) * (m[3] ? -1 : 1);
    if (m[2]!.startsWith('month')) return addMonthsKeepDay(today, n);
    return addDays(today, n * UNIT_DAYS[m[2]!]!);
  }
  m = text.match(/^(next|last) (week|month|year)$/);
  if (m) {
    const dir = m[1] === 'next' ? 1 : -1;
    if (m[2] === 'week') return addDays(today, dir * 7);
    return addMonthsKeepDay(today, dir * (m[2] === 'month' ? 1 : 12));
  }

  // Weekdays: "fri" / "next fri" is the next one after today, "last fri" the one before.
  m = text.match(/^(?:(next|last|this) )?([a-z]+)$/);
  if (m) {
    const wd = weekdayIndex(m[2]!);
    if (wd >= 0) {
      const cur = new Date(today).getDay();
      if (m[1] === 'last') return addDays(today, -(((cur - wd + 6) % 7) + 1));
      return addDays(today, ((wd - cur + 6) % 7) + 1);
    }
  }

  // ISO: 2026-11-15
  m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return ymd(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  // Numeric: 15/11/2026, 15.11.26, 15-11, 11/15 — order from the locale.
  m = text.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    const [d, mo] = dayFirst ? [a, b] : [b, a];
    return ymd(fullYear(m[3], year), mo - 1, d);
  }

  // Month names: 15 nov, 15th of november 2026, nov 15, november 15th 2026
  const words = text
    .replace(/(\d+)(st|nd|rd|th)\b/g, '$1')
    .replace(/ of /g, ' ')
    .trim();
  m = words.match(/^(\d{1,2}) ([a-z]+)\.?(?: (\d{4}))?$/);
  if (m) {
    const mo = monthIndex(m[2]!);
    if (mo >= 0) return ymd(fullYear(m[3], year), mo, Number(m[1]));
  }
  m = words.match(/^([a-z]+)\.? (\d{1,2})(?: (\d{4}))?$/);
  if (m) {
    const mo = monthIndex(m[1]!);
    if (mo >= 0) return ymd(fullYear(m[3], year), mo, Number(m[2]));
  }
  // A month alone ("december", "dec 2026") lands on its 1st.
  m = words.match(/^([a-z]+)\.?(?: (\d{4}))?$/);
  if (m) {
    const mo = monthIndex(m[1]!);
    if (mo >= 0) return ymd(fullYear(m[2], year), mo, 1);
  }
  return null;
}
