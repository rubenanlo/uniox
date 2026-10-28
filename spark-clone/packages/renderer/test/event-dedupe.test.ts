import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@app/shared';
import { dedupeMirroredEvents, isBlockerTitle } from '../src/lib/eventDedupe';

const h = (hour: number) => new Date(2026, 9, 28, hour).getTime();
const ev = (
  id: string,
  calendarId: string,
  title: string,
  start = 19,
  end = 20,
  extra: Partial<CalendarEvent> = {},
): CalendarEvent => ({
  id,
  calendarId,
  source: 'google',
  title,
  startMs: h(start),
  endMs: h(end),
  allDay: false,
  eventType: 'default',
  ...extra,
});
const ids = (es: CalendarEvent[]) => es.map((e) => e.id);

describe('isBlockerTitle', () => {
  it('matches common mirror titles', () => {
    for (const t of [
      'Busy',
      'busy',
      '🔒 Busy',
      'Busy (via Reclaim)',
      'Blocked',
      '',
      'Unavailable',
    ]) {
      expect(isBlockerTitle(t)).toBe(true);
    }
  });
  it('leaves real titles alone', () => {
    for (const t of ['Berberina', 'Business review', 'Blockchain sync', 'Standup']) {
      expect(isBlockerTitle(t)).toBe(false);
    }
  });
});

describe('dedupeMirroredEvents', () => {
  it('hides a Busy block mirrored from another calendar', () => {
    const out = dedupeMirroredEvents([
      ev('busy', 'work', 'Busy'),
      ev('real', 'personal', 'Berberina'),
    ]);
    expect(ids(out)).toEqual(['real']);
  });
  it('keeps a lone Busy block', () => {
    expect(ids(dedupeMirroredEvents([ev('busy', 'work', 'Busy')]))).toEqual(['busy']);
  });
  it('keeps a Busy block at a different time', () => {
    const out = dedupeMirroredEvents([
      ev('busy', 'work', 'Busy', 18, 19),
      ev('real', 'personal', 'X'),
    ]);
    expect(ids(out)).toEqual(['busy', 'real']);
  });
  it('never merges within one calendar', () => {
    const out = dedupeMirroredEvents([
      ev('busy', 'work', 'Busy'),
      ev('real', 'work', 'Berberina'),
      ev('a', 'work', 'Sync'),
      ev('b', 'work', 'Sync'),
    ]);
    expect(ids(out)).toEqual(['busy', 'real', 'a', 'b']);
  });
  it('shows the same invite in two calendars once, preferring the editable copy', () => {
    const out = dedupeMirroredEvents([
      ev('ro', 'shared', 'Team sync', 19, 20, { readOnly: true }),
      ev('rw', 'primary', 'team sync'),
    ]);
    expect(ids(out)).toEqual(['rw']);
  });
  it('keeps two different meetings at the same time', () => {
    const out = dedupeMirroredEvents([ev('a', 'work', 'Standup'), ev('b', 'personal', 'Gym')]);
    expect(ids(out)).toEqual(['a', 'b']);
  });
  it('treats all-day and timed events at the same span separately', () => {
    const out = dedupeMirroredEvents([
      ev('busy', 'work', 'Busy', 0, 24, { allDay: true }),
      ev('real', 'personal', 'Trip', 0, 24),
    ]);
    expect(ids(out)).toEqual(['busy', 'real']);
  });
});
