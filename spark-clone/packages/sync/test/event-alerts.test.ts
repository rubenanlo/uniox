import { describe, expect, it } from 'vitest';
import {
  alertKey,
  dueAlerts,
  LEAD_MS,
  nextAlertDeadline,
  START_GRACE_MS,
  type AlertableEvent,
} from '../src/event-alerts';

const NOW = Date.parse('2026-08-24T12:00:00Z');
const min = (n: number) => n * 60_000;

const ev = (over: Partial<AlertableEvent> = {}): AlertableEvent => ({
  id: 'e1',
  title: 'Standup',
  startMs: NOW + min(30),
  allDay: false,
  eventType: 'default',
  ...over,
});

const none = new Set<string>();

describe('dueAlerts', () => {
  it('fires the lead alert only inside the 10-minute window', () => {
    const early = ev({ startMs: NOW + LEAD_MS + 1 });
    expect(dueAlerts([early], NOW, none)).toEqual([]);
    const inWindow = ev({ startMs: NOW + min(7) });
    const due = dueAlerts([inWindow], NOW, none);
    expect(due).toHaveLength(1);
    expect(due[0]!.stage).toBe('lead');
  });

  it('fires the start alert at the event time, but not after the grace window', () => {
    const starting = ev({ startMs: NOW - min(1) });
    const due = dueAlerts([starting], NOW, none);
    // 'start' is due; 'lead' (also technically past) is stale, not due
    expect(due.map((d) => d.stage)).toEqual(['start']);
    const stale = ev({ startMs: NOW - START_GRACE_MS - 1 });
    expect(dueAlerts([stale], NOW, none)).toEqual([]);
  });

  it('skips all-day and out-of-office events', () => {
    expect(dueAlerts([ev({ startMs: NOW + min(5), allDay: true })], NOW, none)).toEqual([]);
    expect(
      dueAlerts([ev({ startMs: NOW + min(5), eventType: 'outOfOffice' })], NOW, none),
    ).toEqual([]);
  });

  it('never re-fires an alert already in the fired set', () => {
    const e = ev({ startMs: NOW + min(5) });
    const fired = new Set([alertKey(e, 'lead')]);
    expect(dueAlerts([e], NOW, fired)).toEqual([]);
  });

  it('a rescheduled event (new startMs) alerts again', () => {
    const original = ev({ startMs: NOW + min(5) });
    const fired = new Set([alertKey(original, 'lead')]);
    const moved = ev({ startMs: NOW + min(8) });
    expect(dueAlerts([moved], NOW, fired)).toHaveLength(1);
  });
});

describe('nextAlertDeadline', () => {
  it('returns the earliest future boundary across events', () => {
    const a = ev({ id: 'a', startMs: NOW + min(30) }); // lead at +20
    const b = ev({ id: 'b', startMs: NOW + min(60) }); // lead at +50
    expect(nextAlertDeadline([a, b], NOW, none)).toBe(NOW + min(20));
  });

  it('inside the lead window, the next boundary is the start time', () => {
    const e = ev({ startMs: NOW + min(5) });
    const fired = new Set([alertKey(e, 'lead')]);
    expect(nextAlertDeadline([e], NOW, fired)).toBe(NOW + min(5));
  });

  it('returns null when nothing is left to alert on', () => {
    expect(nextAlertDeadline([], NOW, none)).toBeNull();
    const past = ev({ startMs: NOW - min(10) });
    expect(nextAlertDeadline([past], NOW, none)).toBeNull();
  });
});
