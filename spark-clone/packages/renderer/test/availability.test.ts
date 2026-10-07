import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@app/shared';
import {
  busyIntervals,
  findFreeSlots,
  formatSlotLong,
  looksLikeAvailabilityAsk,
  nextMeetingDays,
  parseAvailabilityAsk,
  templateReply,
} from '../src/lib/availability';

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

function ev(start: number, end: number, over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: `${start}`,
    calendarId: 'acct:a',
    source: 'google',
    title: 'x',
    startMs: start,
    endMs: end,
    allDay: false,
    eventType: 'default',
    ...over,
  };
}

describe('looksLikeAvailabilityAsk', () => {
  it('matches common asks in English and Spanish', () => {
    expect(looksLikeAvailabilityAsk('What is your availability next week?')).toBe(true);
    expect(looksLikeAvailabilityAsk('Are you free for a quick call?')).toBe(true);
    expect(looksLikeAvailabilityAsk('Could we find a time to talk?')).toBe(true);
    expect(looksLikeAvailabilityAsk('Let me know when you are free, what works for you')).toBe(true);
    expect(looksLikeAvailabilityAsk('¿Cuándo puedes reunirte?')).toBe(true);
    expect(looksLikeAvailabilityAsk('Here is the invoice for September.')).toBe(false);
  });
});

describe('nextMeetingDays', () => {
  it('returns the next Tue, Wed and Thu strictly after today', () => {
    // Wed 7 Oct 2026 → Thu 8, Tue 13, Wed 14
    expect(nextMeetingDays(at(2026, 10, 7, 9))).toEqual([at(2026, 10, 8), at(2026, 10, 13), at(2026, 10, 14)]);
    // Mon 5 Oct → Tue 6, Wed 7, Thu 8
    expect(nextMeetingDays(at(2026, 10, 5, 23))).toEqual([at(2026, 10, 6), at(2026, 10, 7), at(2026, 10, 8)]);
  });
});

describe('busyIntervals', () => {
  it('merges overlaps and ignores Free events', () => {
    const busy = busyIntervals([
      ev(10, 20),
      ev(15, 30),
      ev(40, 50, { transparency: 'transparent' }),
      ev(60, 70),
    ]);
    expect(busy).toEqual([
      { startMs: 10, endMs: 30 },
      { startMs: 60, endMs: 70 },
    ]);
  });
});

describe('findFreeSlots', () => {
  const days = [at(2026, 10, 13), at(2026, 10, 14), at(2026, 10, 15)];

  it('offers one slot per day inside working hours, avoiding busy time', () => {
    const busy = busyIntervals([ev(at(2026, 10, 13, 9), at(2026, 10, 13, 12))]);
    const slots = findFreeSlots({ days, busy, startHour: 9, endHour: 18, durationMin: 30 });
    expect(slots).toHaveLength(3);
    expect(new Date(slots[0]!.startMs).getDate()).toBe(13);
    expect(new Date(slots[0]!.startMs).getHours()).toBeGreaterThanOrEqual(12);
    expect(new Date(slots[1]!.startMs).getDate()).toBe(14);
    expect(new Date(slots[2]!.startMs).getDate()).toBe(15);
    for (const s of slots) {
      expect(s.endMs - s.startMs).toBe(30 * 60_000);
      expect(new Date(s.startMs).getHours()).toBeGreaterThanOrEqual(9);
      expect(busy.some((b) => b.startMs < s.endMs && b.endMs > s.startMs)).toBe(false);
    }
  });

  it('takes extra slots from open days when one day is fully booked', () => {
    const busy = busyIntervals([ev(at(2026, 10, 14, 0), at(2026, 10, 15, 0), { allDay: true })]);
    const slots = findFreeSlots({ days, busy, startHour: 9, endHour: 18, durationMin: 60 });
    expect(slots).toHaveLength(3);
    expect(slots.some((s) => new Date(s.startMs).getDate() === 14)).toBe(false);
  });

  it('returns fewer slots when the calendar is full', () => {
    const busy = busyIntervals([ev(at(2026, 10, 13), at(2026, 10, 16))]);
    expect(findFreeSlots({ days, busy, startHour: 9, endHour: 18, durationMin: 30 })).toEqual([]);
  });
});

describe('formatting', () => {
  const slot = { startMs: Date.UTC(2026, 9, 13, 8, 0), endMs: Date.UTC(2026, 9, 13, 8, 30) };

  it('always names the time zone in brackets', () => {
    expect(formatSlotLong(slot)).toMatch(/\d{2}:\d{2}–\d{2}:\d{2} \([^)]+\)$/);
  });

  it("adds the sender's zone, with their weekday when the date differs", () => {
    const text = formatSlotLong(slot, 'Pacific/Auckland');
    expect(text).toContain(' / ');
    expect(text).toMatch(/\(NZDT\)|\(GMT\+13\)/);
  });

  it('builds a single or multi-slot template', () => {
    expect(templateReply([slot], null, 'Ana')).toMatch(/^Hi Ana,\n\nI'm available on /);
    expect(templateReply([slot, slot])).toContain('• ');
  });
});

describe('parseAvailabilityAsk', () => {
  it('reads fenced JSON and clamps the duration', () => {
    expect(
      parseAvailabilityAsk('```json\n{"asks": true, "durationMinutes": 50, "senderTimeZone": "America/New_York"}\n```'),
    ).toEqual({ asks: true, durationMinutes: 45, senderTimeZone: 'America/New_York' });
    expect(parseAvailabilityAsk('{"asks": true, "durationMinutes": 999, "senderTimeZone": "Mars/Base"}')).toEqual({
      asks: true,
      durationMinutes: 30,
      senderTimeZone: null,
    });
    expect(parseAvailabilityAsk('no idea').asks).toBe(false);
  });
});
