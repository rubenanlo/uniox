import type { Calendar, CalendarEvent } from '@app/shared';
import { addDays, startOfDay } from './calendarMonth';
import { isAllDayLike } from './eventLayout';

/** "Paris office closed" anywhere in the title, any case, any spacing. */
const PARIS_CLOSED = /paris\s+office\s+closed/i;
/** A timed out-of-office block must cover this much of a day to count. */
const MIN_TIMED_MS = 4 * 3_600_000;

export function isHolidayEvent(e: CalendarEvent): boolean {
  return e.eventType === 'outOfOffice' || PARIS_CLOSED.test(e.title);
}

/** Local midnights in [start, end) that holiday event `e` turns into a holiday. */
function holidayDays(e: CalendarEvent, start: number, end: number): number[] {
  const days: number[] = [];
  const stop = Math.min(e.endMs, end);
  for (let d = startOfDay(Math.max(e.startMs, start)); d < stop; d = addDays(d, 1)) {
    const covered = Math.min(e.endMs, addDays(d, 1)) - Math.max(e.startMs, d);
    if (e.allDay || covered >= MIN_TIMED_MS) days.push(d);
  }
  return days;
}

/**
 * Holidays in [start, end), keyed by local midnight, with the event that makes
 * each one (first wins). One pass over the events the view already loaded.
 */
export function holidaysIn(
  events: CalendarEvent[],
  start: number,
  end: number,
): Map<number, CalendarEvent> {
  const out = new Map<number, CalendarEvent>();
  for (const e of events) {
    if (!isHolidayEvent(e)) continue;
    for (const d of holidayDays(e, start, end)) if (!out.has(d)) out.set(d, e);
  }
  return out;
}

/**
 * On a holiday, the timed events of the account the holiday belongs to (the
 * work account that is closed or out of office) are hidden; other accounts,
 * all-day and multi-day events stay. Display only: nothing is declined or
 * deleted.
 */
export function hideWorkOnHolidays(
  events: CalendarEvent[],
  calendars: Calendar[],
  start: number,
  end: number,
): CalendarEvent[] {
  const accountOf = new Map(calendars.map((c) => [c.id, c.accountId]));
  const account = (e: CalendarEvent) => accountOf.get(e.calendarId) ?? e.accountId;
  const off = new Map<number, Set<string>>();
  for (const e of events) {
    if (!isHolidayEvent(e)) continue;
    const a = account(e);
    if (!a) continue;
    for (const d of holidayDays(e, start, end)) {
      let set = off.get(d);
      if (!set) off.set(d, (set = new Set()));
      set.add(a);
    }
  }
  if (!off.size) return events;
  return events.filter((e) => {
    if (isAllDayLike(e) || isHolidayEvent(e)) return true;
    const a = account(e);
    return !a || !off.get(startOfDay(e.startMs))?.has(a);
  });
}
