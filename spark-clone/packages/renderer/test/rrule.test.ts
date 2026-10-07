import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@app/shared';
import { expandEvent, presetRrule, ruleLabel } from '../src/lib/rrule';

const d = (y: number, m: number, day: number, h = 0) => new Date(y, m - 1, day, h).getTime();
const HOUR = 3_600_000;

function ev(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'e1',
    calendarId: 'local-default',
    source: 'local',
    title: 'Standup',
    startMs: d(2026, 8, 3, 9),
    endMs: d(2026, 8, 3, 9) + HOUR,
    allDay: false,
    eventType: 'default',
    ...over,
  };
}

describe('presetRrule / ruleLabel', () => {
  it('builds preset rules from the start date', () => {
    expect(presetRrule('none', d(2026, 8, 20))).toBeUndefined();
    expect(presetRrule('daily', d(2026, 8, 20))).toBe('FREQ=DAILY');
    expect(presetRrule('weekly', d(2026, 8, 20))).toBe('FREQ=WEEKLY;BYDAY=TH');
    expect(presetRrule('monthly', d(2026, 8, 20))).toBe('FREQ=MONTHLY;BYMONTHDAY=20');
    expect(presetRrule('yearly', d(2026, 8, 20))).toBe('FREQ=YEARLY');
  });
  it('labels rules for the details pane', () => {
    expect(ruleLabel(undefined)).toBe("Doesn't repeat");
    expect(ruleLabel('FREQ=WEEKLY;BYDAY=TH')).toBe('Weekly on Thursday');
    expect(ruleLabel('FREQ=DAILY;INTERVAL=2')).toBe('Custom');
  });
});

describe('expandEvent', () => {
  const range = { start: d(2026, 8, 16), end: d(2026, 8, 23) }; // week of Aug 16

  it('returns the plain event unchanged when it has no rrule', () => {
    const e = ev({ startMs: d(2026, 8, 18, 9), endMs: d(2026, 8, 18, 10) });
    expect(expandEvent(e, range.start, range.end)).toEqual([e]);
  });
  it('daily: one occurrence per day, duration preserved, ids suffixed', () => {
    const out = expandEvent(ev({ rrule: 'FREQ=DAILY' }), range.start, range.end);
    expect(out).toHaveLength(7);
    expect(out[0]!.id).toBe(`e1:${d(2026, 8, 16, 9)}`);
    expect(out[0]!.endMs - out[0]!.startMs).toBe(HOUR);
  });
  it('weekly: only the BYDAY weekday inside the range', () => {
    const out = expandEvent(ev({ rrule: 'FREQ=WEEKLY;BYDAY=TH' }), range.start, range.end);
    expect(out).toHaveLength(1);
    expect(new Date(out[0]!.startMs).getDay()).toBe(4);
  });
  it('never emits occurrences before the series start', () => {
    const out = expandEvent(
      ev({ startMs: d(2026, 8, 19, 9), endMs: d(2026, 8, 19, 10), rrule: 'FREQ=DAILY' }),
      range.start,
      range.end,
    );
    expect(out[0]!.startMs).toBe(d(2026, 8, 19, 9));
    expect(out).toHaveLength(4); // 19, 20, 21, 22
  });
  it('monthly lands on BYMONTHDAY; yearly on the anniversary', () => {
    const m = expandEvent(
      ev({ startMs: d(2026, 6, 20, 9), endMs: d(2026, 6, 20, 10), rrule: 'FREQ=MONTHLY;BYMONTHDAY=20' }),
      range.start, range.end,
    );
    expect(m).toHaveLength(1);
    expect(new Date(m[0]!.startMs).getDate()).toBe(20);
    const y = expandEvent(
      ev({ startMs: d(2025, 8, 18, 9), endMs: d(2025, 8, 18, 10), rrule: 'FREQ=YEARLY' }),
      range.start, range.end,
    );
    expect(y).toHaveLength(1);
    expect(new Date(y[0]!.startMs).getFullYear()).toBe(2026);
  });
  it('custom rules fall back to the base occurrence only', () => {
    const out = expandEvent(ev({ rrule: 'FREQ=DAILY;INTERVAL=2' }), d(2026, 8, 1), d(2026, 9, 1));
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('e1');
  });
});
