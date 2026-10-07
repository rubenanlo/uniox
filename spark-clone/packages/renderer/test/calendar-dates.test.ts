import { describe, expect, it } from 'vitest';
import {
  addDays,
  DAY_MS,
  moveCursor,
  pageAnchor,
  rangeForView,
  startOfDay,
  startOfWeek,
} from '../src/lib/calendarMonth';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day).getTime();

describe('week/day ranges', () => {
  it('startOfWeek lands on Sunday', () => {
    expect(new Date(startOfWeek(d(2026, 8, 20))).getDay()).toBe(0); // Thu → Sun 16
    expect(startOfWeek(d(2026, 8, 16))).toBe(d(2026, 8, 16)); // Sunday is itself
  });
  it('week view = 7 days from Sunday', () => {
    const r = rangeForView('week', d(2026, 8, 20));
    expect(r.days).toHaveLength(7);
    expect(r.days[0]).toBe(d(2026, 8, 16));
    expect(r.end - r.start).toBe(7 * DAY_MS);
  });
  it('day view = single day', () => {
    const r = rangeForView('day', d(2026, 8, 20));
    expect(r.days).toEqual([d(2026, 8, 20)]);
  });
  it('month view matches monthGrid (42 days)', () => {
    expect(rangeForView('month', d(2026, 8, 1)).days).toHaveLength(42);
  });
});

describe('paging', () => {
  it('pages week by 7 days, day by 1, month by calendar month', () => {
    expect(pageAnchor('week', d(2026, 8, 16), 1)).toBe(d(2026, 8, 23));
    expect(pageAnchor('day', d(2026, 8, 20), -1)).toBe(d(2026, 8, 19));
    expect(new Date(pageAnchor('month', d(2026, 8, 1), 1)).getMonth()).toBe(8); // September
  });
});

describe('moveCursor', () => {
  it('moves within the visible month without re-anchoring', () => {
    const r = moveCursor('month', d(2026, 8, 1), d(2026, 8, 20), 1);
    expect(r.cursor).toBe(d(2026, 8, 21));
    expect(r.anchor).toBe(d(2026, 8, 1));
  });
  it('pages the month when walking past the grid edge', () => {
    // Sept 5 is the last cell of August 2026's 42-day grid.
    const r = moveCursor('month', d(2026, 8, 1), d(2026, 9, 5), 1);
    expect(r.cursor).toBe(d(2026, 9, 6));
    expect(new Date(r.anchor).getMonth()).toBe(8); // anchored to September
  });
  it('pages the week backwards from its first day', () => {
    const r = moveCursor('week', d(2026, 8, 16), d(2026, 8, 16), -1);
    expect(r.cursor).toBe(d(2026, 8, 15));
    expect(r.anchor).toBe(d(2026, 8, 9));
  });
  it('pages the day view forward, re-anchoring to the new day', () => {
    const r = moveCursor('day', d(2026, 8, 20), d(2026, 8, 20), 1);
    expect(r.cursor).toBe(d(2026, 8, 21));
    expect(r.anchor).toBe(d(2026, 8, 21));
  });
  it('pages the week forwards past its last day', () => {
    const r = moveCursor('week', d(2026, 8, 16), d(2026, 8, 22), 1);
    expect(r.cursor).toBe(d(2026, 8, 23)); // Sun Aug 23
    expect(r.anchor).toBe(d(2026, 8, 23)); // re-anchored to the new week's Sunday
  });
  it('moves within the visible week without re-anchoring', () => {
    const r = moveCursor('week', d(2026, 8, 16), d(2026, 8, 18), 1);
    expect(r.cursor).toBe(d(2026, 8, 19));
    expect(r.anchor).toBe(d(2026, 8, 16));
  });
  it('handles DST-length days via addDays', () => {
    expect(startOfDay(addDays(d(2026, 3, 28), 2))).toBe(d(2026, 3, 30)); // EU DST window
  });
});
