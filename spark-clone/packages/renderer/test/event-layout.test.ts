import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@app/shared';
import { isAllDayLike, layoutColumns, packLanes } from '../src/lib/eventLayout';

const d = (day: number, h = 0) => new Date(2026, 7, day, h).getTime(); // August 2026
const ev = (id: string, startMs: number, endMs: number, allDay = false): CalendarEvent => ({
  id, calendarId: 'c', source: 'local', title: id, startMs, endMs, allDay, eventType: 'default',
});

describe('isAllDayLike', () => {
  it('true for allDay and for multi-day timed events', () => {
    expect(isAllDayLike(ev('a', d(3), d(4), true))).toBe(true);
    expect(isAllDayLike(ev('b', d(3, 22), d(4, 2)))).toBe(true); // crosses midnight
    expect(isAllDayLike(ev('c', d(3, 9), d(3, 10)))).toBe(false);
  });
  it('false for a timed event ending exactly at the next midnight', () => {
    expect(isAllDayLike(ev('x', d(3, 22), d(4)))).toBe(false);
  });
});

describe('packLanes (week row Sun 16 – Sat 22)', () => {
  const rowStart = d(16);
  const rowEnd = d(23);
  it('non-overlapping chips share lane 0', () => {
    const out = packLanes([ev('a', d(16), d(17), true), ev('b', d(18), d(19), true)], rowStart, rowEnd);
    expect(out.map((p) => p.lane)).toEqual([0, 0]);
  });
  it('overlapping chips stack lanes; spans clip to the row', () => {
    const out = packLanes(
      [ev('a', d(14), d(25), true), ev('b', d(17), d(19), true)],
      rowStart, rowEnd,
    );
    const a = out.find((p) => p.event.id === 'a')!;
    const b = out.find((p) => p.event.id === 'b')!;
    expect(a.lane).toBe(0);
    expect(a.startCol).toBe(0);
    expect(a.span).toBe(7); // clipped to the full row
    expect(b.lane).toBe(1);
    expect(b.startCol).toBe(1); // Mon 17
    expect(b.span).toBe(2);
  });
  it('skips events entirely outside the row', () => {
    const out = packLanes(
      [
        ev('before', d(10), d(12), true),
        ev('inside', d(17), d(18), true),
        ev('after', d(24), d(26), true),
      ],
      rowStart, rowEnd,
    );
    expect(out.map((p) => p.event.id)).toEqual(['inside']);
  });
  it('reuses lane 0 once the first chip has ended', () => {
    const out = packLanes(
      [ev('a', d(16), d(18), true), ev('b', d(17), d(19), true), ev('c', d(18), d(19), true)],
      rowStart, rowEnd,
    );
    expect(out.find((p) => p.event.id === 'a')!.lane).toBe(0);
    expect(out.find((p) => p.event.id === 'b')!.lane).toBe(1);
    expect(out.find((p) => p.event.id === 'c')!.lane).toBe(0);
  });
});

describe('layoutColumns', () => {
  it('sequential events keep a single column', () => {
    const out = layoutColumns([ev('a', d(3, 9), d(3, 10)), ev('b', d(3, 10), d(3, 11))]);
    expect(out.every((p) => p.cols === 1)).toBe(true);
  });
  it('overlapping events split the width', () => {
    const out = layoutColumns([ev('a', d(3, 9), d(3, 11)), ev('b', d(3, 10), d(3, 12))]);
    expect(out.find((p) => p.event.id === 'a')!.col).toBe(0);
    expect(out.find((p) => p.event.id === 'b')!.col).toBe(1);
    expect(out.every((p) => p.cols === 2)).toBe(true);
  });
  it('transitive cluster shares the column count; freed columns are reused', () => {
    const halfHour = 30 * 60 * 1000;
    // A 9-11, B 10-12, C 11:30-13: C overlaps only B, yet all share cols=2.
    const out = layoutColumns([
      ev('a', d(3, 9), d(3, 11)),
      ev('b', d(3, 10), d(3, 12)),
      ev('c', d(3, 11) + halfHour, d(3, 13)),
    ]);
    expect(out.find((p) => p.event.id === 'a')!.col).toBe(0);
    expect(out.find((p) => p.event.id === 'b')!.col).toBe(1);
    expect(out.find((p) => p.event.id === 'c')!.col).toBe(0);
    expect(out.every((p) => p.cols === 2)).toBe(true);
  });
});
