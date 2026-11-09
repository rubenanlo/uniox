import { describe, expect, it } from 'vitest';
import type { Calendar, CalendarEvent } from '@app/shared';
import { hideWorkOnHolidays, holidaysIn, isHolidayEvent } from '../src/lib/holidays';

const day = (d: number, h = 0) => new Date(2026, 10, d, h).getTime();
let n = 0;
const ev = (
  calendarId: string,
  title: string,
  start: number,
  end: number,
  extra: Partial<CalendarEvent> = {},
): CalendarEvent => ({
  id: 'e' + n++,
  calendarId,
  source: 'google',
  title,
  startMs: start,
  endMs: end,
  allDay: false,
  eventType: 'default',
  ...extra,
});
const allDay = (
  calendarId: string,
  title: string,
  d1: number,
  d2 = d1,
  extra: Partial<CalendarEvent> = {},
) => ev(calendarId, title, day(d1), day(d2 + 1), { allDay: true, ...extra });
const calendars = [
  { id: 'office', accountId: 'work' },
  { id: 'work-main', accountId: 'work' },
  { id: 'family', accountId: 'personal' },
] as Calendar[];

describe('isHolidayEvent', () => {
  it('matches Paris office closed anywhere in the title, any case', () => {
    for (const t of [
      'Paris office closed',
      'Paris office closed: Armistice Day',
      'Team offsite · PARIS OFFICE CLOSED for move',
      'paris  office   closed',
    ])
      expect(isHolidayEvent(ev('office', t, 0, 1))).toBe(true);
    expect(isHolidayEvent(ev('office', 'New York office closed: Veterans Day', 0, 1))).toBe(false);
    expect(isHolidayEvent(ev('office', 'Paris office open', 0, 1))).toBe(false);
  });
  it('matches out-of-office events', () => {
    expect(isHolidayEvent(ev('work-main', 'Away', 0, 1, { eventType: 'outOfOffice' }))).toBe(true);
  });
});

describe('holidaysIn', () => {
  it('marks every day of a multi-day closure', () => {
    const map = holidaysIn([allDay('office', 'Paris office closed', 19, 20)], day(15), day(22));
    expect([...map.keys()]).toEqual([day(19), day(20)]);
  });
  it('needs a timed out-of-office to cover at least 4 hours', () => {
    const ooo = { eventType: 'outOfOffice' as const };
    const map = holidaysIn(
      [
        ev('work-main', 'OOO', day(10, 9), day(10, 11), ooo),
        ev('work-main', 'OOO', day(12, 0), day(13, 0), ooo),
      ],
      day(9),
      day(15),
    );
    expect([...map.keys()]).toEqual([day(12)]);
  });
});

describe('hideWorkOnHolidays', () => {
  it('hides only the holiday account’s timed events on that day', () => {
    const closed = allDay('office', 'Paris office closed: Armistice Day', 11);
    const lunch = ev('work-main', 'Lunch', day(11, 12), day(11, 13));
    const berberina = ev('family', 'Berberina', day(11, 19), day(11, 19.5));
    const veterans = allDay('office', 'Armistice Day', 11);
    const nextDay = ev('work-main', 'Lunch', day(12, 12), day(12, 13));
    const kept = hideWorkOnHolidays(
      [closed, lunch, berberina, veterans, nextDay],
      calendars,
      day(8),
      day(15),
    );
    expect(kept).toEqual([closed, berberina, veterans, nextDay]);
  });
  it('returns the same array when there is no holiday', () => {
    const list = [ev('work-main', 'Lunch', day(11, 12), day(11, 13))];
    expect(hideWorkOnHolidays(list, calendars, day(8), day(15))).toBe(list);
  });
});
