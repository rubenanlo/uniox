import type { CalendarEvent } from '@app/shared';
import { addDays, startOfDay } from './calendarMonth';

/** "Paris office closed" anywhere in the title, any case, any spacing. */
const PARIS_CLOSED = /paris\s+office\s+closed/i;
/** A timed out-of-office block must cover this much of a day to free it. */
const MIN_TIMED_MS = 4 * 3_600_000;

export function isFreeDayEvent(e: CalendarEvent): boolean {
  return e.eventType === 'outOfOffice' || PARIS_CLOSED.test(e.title);
}

/**
 * Days in [start, end) that a free-day event covers, keyed by local
 * midnight, with the event that frees each (first one wins). One pass over
 * the events the view already loaded.
 */
export function freeDaysIn(
  events: CalendarEvent[],
  start: number,
  end: number,
): Map<number, CalendarEvent> {
  const out = new Map<number, CalendarEvent>();
  for (const e of events) {
    if (!isFreeDayEvent(e)) continue;
    const whole = e.allDay;
    for (
      let d = startOfDay(Math.max(e.startMs, start));
      d < Math.min(e.endMs, end);
      d = addDays(d, 1)
    ) {
      const next = addDays(d, 1);
      const covered = Math.min(e.endMs, next) - Math.max(e.startMs, d);
      if ((whole || covered >= MIN_TIMED_MS) && !out.has(d)) out.set(d, e);
    }
  }
  return out;
}
