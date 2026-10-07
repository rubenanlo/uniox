import { describe, expect, it } from 'vitest';
import type { Calendar, CalendarEvent } from '@app/shared';
import { canEditEvent } from '../src/lib/eventEdit';

const cal = (over: Partial<Calendar>): Calendar => ({
  id: 'c1',
  name: 'Cal',
  color: '#fff',
  source: 'local',
  visible: true,
  ...over,
});
const ev = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: 'e1',
  calendarId: 'c1',
  source: 'local',
  title: 'T',
  startMs: 0,
  endMs: 1,
  allDay: false,
  eventType: 'default',
  ...over,
});

describe('canEditEvent', () => {
  it('local events are editable', () => {
    expect(canEditEvent(ev({}), [cal({})])).toBe(true);
  });
  it('google events are editable when their calendar belongs to a user account', () => {
    const cals = [cal({ id: 'gcal:a1:fam', source: 'google', accountId: 'a1' })];
    expect(canEditEvent(ev({ source: 'google', calendarId: 'gcal:a1:fam' }), cals)).toBe(true);
  });
  it('google events without an owning account are not editable', () => {
    const cals = [cal({ id: 'gcal:x', source: 'google' })];
    expect(canEditEvent(ev({ source: 'google', calendarId: 'gcal:x' }), cals)).toBe(false);
    expect(canEditEvent(ev({ source: 'google', calendarId: 'missing' }), cals)).toBe(false);
  });
  it('notion events are never editable', () => {
    expect(canEditEvent(ev({ source: 'notion' }), [])).toBe(false);
  });
});
