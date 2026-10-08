// The user sits in Madrid for these tests; set before any Date is built.
process.env.TZ = 'Europe/Madrid';

import { describe, expect, it } from 'vitest';
import {
  findGroupSlots,
  formatSlotForPeople,
  mergeIntervals,
  minutesOutsideDay,
  offHoursNote,
  parseZoneGuesses,
  type Participant,
  type Slot,
} from '../src/lib/availability';

const at = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime();
const days = [at(2026, 10, 13), at(2026, 10, 14), at(2026, 10, 15)];
const window = { days, busy: [], startHour: 9.5, endHour: 17.5, durationMin: 30 };
const person = (
  name: string,
  timeZone: string | null,
  busy: Slot[] | null = null,
): Participant => ({
  email: `${name.toLowerCase()}@x.com`,
  name,
  timeZone,
  busy,
});
const madridMinutes = (ms: number) => new Date(ms).getHours() * 60 + new Date(ms).getMinutes();

describe('minutesOutsideDay', () => {
  it('measures how far a time falls outside 9:00–18:00 in their zone', () => {
    // 10:00 Madrid = 4:00 New York: five hours early.
    const slot = { startMs: at(2026, 10, 13, 10), endMs: at(2026, 10, 13, 10, 30) };
    expect(minutesOutsideDay(slot, 'America/New_York')).toBe(300);
    expect(minutesOutsideDay(slot, 'Europe/London')).toBe(0);
    expect(minutesOutsideDay(slot, null)).toBe(0);
  });
});

describe('findGroupSlots', () => {
  it("keeps to the user's window when it fits everyone", () => {
    const slots = findGroupSlots({ ...window, participants: [person('Alex', 'America/New_York')] });
    expect(slots).toHaveLength(3);
    for (const s of slots) {
      // New York's 9:00 is 15:00 in Madrid; the user's day ends at 17:30.
      expect(madridMinutes(s.startMs)).toBeGreaterThanOrEqual(15 * 60);
      expect(madridMinutes(s.endMs)).toBeLessThanOrEqual(17 * 60 + 30);
      expect(s.offHours).toEqual([]);
      expect(s.outsideMine).toBe(false);
    }
  });

  it("respects other people's visible busy time", () => {
    const busy = days.map((d) => ({ startMs: d + 15 * 3_600_000, endMs: d + 16 * 3_600_000 }));
    const slots = findGroupSlots({
      ...window,
      participants: [person('Alex', 'America/New_York', busy)],
    });
    for (const s of slots) expect(madridMinutes(s.startMs)).toBeGreaterThanOrEqual(16 * 60);
  });

  it("stretches the user's hours a little before stretching anyone else's", () => {
    // Los Angeles 9:00 is 18:00 in Madrid, past the user's 17:30.
    const slots = findGroupSlots({
      ...window,
      participants: [person('Kim', 'America/Los_Angeles')],
    });
    expect(slots).toHaveLength(3);
    for (const s of slots) {
      expect(s.offHours).toEqual([]);
      expect(s.outsideMine).toBe(true);
      expect(madridMinutes(s.startMs)).toBeGreaterThanOrEqual(18 * 60);
      expect(madridMinutes(s.endMs)).toBeLessThanOrEqual(19 * 60 + 30);
    }
    expect(offHoursNote(slots[0]!, [person('Kim', 'America/Los_Angeles')])).toBe('late for you');
  });

  it('offers the least-bad times, flagged, when no hour suits everyone', () => {
    const people = [person('Ana', 'Pacific/Auckland'), person('Kim', 'America/Los_Angeles')];
    const slots = findGroupSlots({ ...window, participants: people });
    expect(slots).toHaveLength(3);
    for (const s of slots) {
      expect(s.offHours.length).toBeGreaterThan(0);
      expect(s.outsideMine).toBe(false);
      expect(offHoursNote(s, people)).toMatch(/^(early|late) for /);
    }
  });

  it('treats unknown zones and hidden calendars as no constraint', () => {
    const slots = findGroupSlots({ ...window, participants: [person('Sam', null)] });
    expect(slots).toHaveLength(3);
    expect(slots.every((s) => !s.outsideMine && s.offHours.length === 0)).toBe(true);
  });
});

describe('formatSlotForPeople', () => {
  it('names each other zone once with the people in it', () => {
    const slot = { startMs: at(2026, 10, 13, 15), endMs: at(2026, 10, 13, 15, 30) };
    const text = formatSlotForPeople(slot, [
      person('Alex Smith', 'America/New_York'),
      person('Sam', 'America/Toronto'),
      person('Lu', 'Europe/Paris'),
      person('Jo', null),
    ]);
    expect(text).toBe('Tuesday, October 13, 15:00–15:30 (CEST) / 09:00–09:30 (EDT) Alex, Sam');
  });
});

describe('helpers', () => {
  it('merges intervals', () => {
    expect(
      mergeIntervals([
        { startMs: 5, endMs: 9 },
        { startMs: 1, endMs: 6 },
        { startMs: 20, endMs: 20 },
      ]),
    ).toEqual([{ startMs: 1, endMs: 9 }]);
  });

  it('keeps only valid zone guesses', () => {
    expect(
      parseZoneGuesses(
        '```json\n{"A@x.com": "Asia/Tokyo", "b@x.com": null, "c@x.com": "Mars"}\n```',
      ),
    ).toEqual({ 'a@x.com': 'Asia/Tokyo' });
  });
});
