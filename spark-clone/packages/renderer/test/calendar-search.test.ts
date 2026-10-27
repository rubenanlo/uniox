import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@app/shared';
import { eventMatches, mergeSearchResults, searchWords } from '../src/lib/calendarSearch';
import { presetRrule } from '../src/lib/rrule';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 27, 12);
const ev = (id: string, startMs: number, over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  calendarId: 'c1',
  source: 'local',
  title: id,
  startMs,
  endMs: startMs + 3_600_000,
  allDay: false,
  eventType: 'default',
  ...over,
});

describe('calendar search', () => {
  it('needs every word somewhere in title, location or notes', () => {
    const e = ev('Board meeting', NOW, { location: 'Room 4', description: 'Q3 numbers' });
    expect(eventMatches(e, searchWords('board q3'))).toBe(true);
    expect(eventMatches(e, searchWords('ROOM'))).toBe(true);
    expect(eventMatches(e, searchWords('board lunch'))).toBe(false);
    expect(eventMatches(e, [])).toBe(false);
  });

  it('splits upcoming (soonest first) from past (latest first) and dedupes', () => {
    const a = ev('a', NOW + 3 * DAY);
    const b = ev('b', NOW + DAY);
    const c = ev('c', NOW - 400 * DAY);
    const d = ev('d', NOW - DAY);
    const r = mergeSearchResults([[a, c], [b, d, a]], NOW);
    expect(r.upcoming.map((e) => e.id)).toEqual(['b', 'a']);
    expect(r.past.map((e) => e.id)).toEqual(['d', 'c']);
  });

  it('counts an event still running as upcoming', () => {
    const r = mergeSearchResults([[ev('now', NOW - 1000)]], NOW);
    expect(r.upcoming).toHaveLength(1);
  });

  it('shows a recurring series at its next occurrence', () => {
    const start = NOW - 30 * DAY;
    const series = ev('standup', start, { rrule: presetRrule('weekly', start) });
    const [hit] = mergeSearchResults([[series]], NOW).upcoming;
    expect(hit!.startMs).toBeGreaterThanOrEqual(NOW - 3_600_000);
    expect(hit!.startMs).toBeLessThan(NOW + 7 * DAY);
  });
});
