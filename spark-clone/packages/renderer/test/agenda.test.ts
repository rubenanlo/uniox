import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@app/shared';
import { durationLabel, freeSlots, trackPct } from '../src/lib/agenda';
import { fetchRange, pageAnchor, rangeForView } from '../src/lib/calendarMonth';

const day = new Date(2026, 9, 28).getTime();
const at = (h: number, m = 0) => new Date(2026, 9, 28, h, m).getTime();
const ev = (id: string, s: number, e: number, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  calendarId: 'c',
  source: 'local',
  title: id,
  startMs: s,
  endMs: e,
  allDay: false,
  eventType: 'default',
  ...extra,
});

describe('freeSlots', () => {
  const events = [
    ev('rdv', at(8), at(8, 30)),
    ev('lunch', at(12), at(13)),
    ev('hold', at(13, 30), at(17, 15)),
    ev('pill', at(19), at(19, 30)),
  ];

  it('lists 30+ minute gaps inside working hours', () => {
    expect(freeSlots(events, day).map((s) => [s.startMs, s.endMs])).toEqual([
      [at(8, 30), at(12)],
      [at(13), at(13, 30)],
      [at(17, 15), at(19)],
    ]);
  });

  it('starts from now and drops gaps shorter than 30 minutes', () => {
    expect(freeSlots(events, day, at(13, 5)).map((s) => s.startMs)).toEqual([at(17, 15)]);
  });

  it('ignores all-day and Free events', () => {
    const extra = [
      ev('holiday', day, day + 86_400_000, { allDay: true }),
      ev('optional', at(9), at(10), { transparency: 'transparent' }),
    ];
    expect(freeSlots(extra, day)).toEqual([{ startMs: at(8), endMs: at(19) }]);
  });

  it('handles overlapping events', () => {
    const o = [ev('a', at(9), at(12)), ev('b', at(10), at(11))];
    expect(freeSlots(o, day).map((s) => s.startMs)).toEqual([at(8), at(12)]);
  });
});

describe('agenda helpers', () => {
  it('formats durations', () => {
    expect(durationLabel(57 * 60_000)).toBe('57m');
    expect(durationLabel(105 * 60_000)).toBe('1h 45m');
    expect(durationLabel(120 * 60_000)).toBe('2h');
  });

  it('maps times onto the 08–19 track', () => {
    expect(trackPct(at(8))).toBe(0);
    expect(trackPct(at(19))).toBe(100);
    expect(trackPct(at(6))).toBe(0);
  });

  it('agenda shows a week from its anchor day and pages by a week', () => {
    const r = rangeForView('agenda', at(15));
    expect(r.days).toHaveLength(7);
    expect(r.start).toBe(day);
    expect(pageAnchor('agenda', day, 1)).toBe(new Date(2026, 10, 4).getTime());
    expect(fetchRange('agenda', day).start).toBe(new Date(2026, 9, 21).getTime());
  });
});
