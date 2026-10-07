import { describe, expect, it } from 'vitest';
import { dragTarget, type DragGeometry } from '../src/lib/dragMove';

const HOUR_MS = 3_600_000;
const day = (n: number) => new Date(2026, 7, 24 + n).getTime(); // Mon Aug 24 2026 + n

// A 3-day grid: 56px gutter, 100px columns, 48px/hour, 30-min (24px) snap.
const geo: DragGeometry = {
  days: [day(0), day(1), day(2)],
  gutter: 56,
  colWidth: 100,
  hourPx: 48,
  snapPx: 24,
};

describe('dragTarget', () => {
  it('maps the pointer to a day column and a snapped top', () => {
    // Pointer mid second column, chip top landing at 10:00 exactly.
    const r = dragTarget(geo, 56 + 150, 10 * 48 + 5, 5, HOUR_MS);
    expect(r.dayIndex).toBe(1);
    expect(r.top).toBe(10 * 48);
    expect(r.startMs).toBe(day(1) + 10 * HOUR_MS);
    expect(r.endMs).toBe(day(1) + 11 * HOUR_MS);
  });

  it('snaps to the nearest half hour, keeping the grab offset', () => {
    // Grabbed 10px into the chip; pointer puts the raw top at 9:05 → snaps to 9:00.
    const r = dragTarget(geo, 56 + 10, 9 * 48 + 4 + 10, 10, 30 * 60_000);
    expect(r.dayIndex).toBe(0);
    expect(r.top).toBe(9 * 48);
    expect(r.startMs).toBe(day(0) + 9 * HOUR_MS);
  });

  it('preserves the event duration', () => {
    const dur = 2.5 * HOUR_MS;
    const r = dragTarget(geo, 56 + 250, 14 * 48, 0, dur);
    expect(r.endMs - r.startMs).toBe(dur);
  });

  it('clamps the day index to the grid', () => {
    expect(dragTarget(geo, 0, 48, 0, HOUR_MS).dayIndex).toBe(0);
    expect(dragTarget(geo, 9999, 48, 0, HOUR_MS).dayIndex).toBe(2);
  });

  it('clamps the top so the event stays inside the day', () => {
    const top = dragTarget(geo, 56 + 10, 23.9 * 48, 0, 2 * HOUR_MS).top;
    expect(top).toBe(22 * 48); // 2h event can start no later than 22:00
    expect(dragTarget(geo, 56 + 10, -50, 0, HOUR_MS).top).toBe(0);
  });
});
