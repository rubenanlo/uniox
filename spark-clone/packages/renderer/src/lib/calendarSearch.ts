import type { CalendarEvent } from '@app/shared';
import { DAY_MS } from './calendarMonth';
import { expandEvent } from './rrule';

const YEAR_MS = 366 * DAY_MS;

export function searchWords(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every word appears in the title, location or notes (what the DB search checks). */
export function eventMatches(e: CalendarEvent, words: string[]): boolean {
  const hay = `${e.title}\n${e.location ?? ''}\n${e.description ?? ''}`.toLowerCase();
  return words.length > 0 && words.every((w) => hay.includes(w));
}

/** A local recurring series stands for its next occurrence (within a year), so
 *  "standup" lands on this week's, not the day the series began. */
export function representative(e: CalendarEvent, now: number): CalendarEvent {
  if (!e.rrule || e.startMs >= now) return e;
  return expandEvent(e, now, now + YEAR_MS)[0] ?? e;
}

export interface SearchResults {
  upcoming: CalendarEvent[];
  past: CalendarEvent[];
}

/**
 * Merge stored hits, Google's out-of-window hits and Notion due-dates into
 * Upcoming (soonest first) and Past (most recent first), one row per event.
 */
export function mergeSearchResults(
  sources: CalendarEvent[][],
  now: number,
  limit = 40,
): SearchResults {
  const byId = new Map<string, CalendarEvent>();
  for (const list of sources) {
    for (const e of list) if (!byId.has(e.id)) byId.set(e.id, representative(e, now));
  }
  const upcoming: CalendarEvent[] = [];
  const past: CalendarEvent[] = [];
  for (const e of byId.values()) (e.endMs > now ? upcoming : past).push(e);
  upcoming.sort((a, b) => a.startMs - b.startMs);
  past.sort((a, b) => b.startMs - a.startMs);
  return { upcoming: upcoming.slice(0, limit), past: past.slice(0, limit) };
}

/** "Tue, Mar 4, 2025 · 10:30 AM" — the year only when it isn't this year. */
export function resultWhen(e: CalendarEvent, now: number): string {
  const d = new Date(e.startMs);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const date = d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  if (e.allDay) return `${date} · All day`;
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}
