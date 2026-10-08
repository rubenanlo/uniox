// The user sits in Madrid for these tests; set before any Date is built.
process.env.TZ = 'Europe/Madrid';

import { describe, expect, it } from 'vitest';
import {
  addPick,
  cellStatus,
  findGroupSlots,
  formatSlotForPeople,
  mergeIntervals,
  minutesOutsideDay,
  offHoursNote,
  parseZoneGuesses,
  removePickAt,
  timesBlock,
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
  const laterDays = days.map((d) => d + 7 * 86_400_000);
  const nyBusyAfternoons = (ds: number[]) =>
    ds.map((d) => ({ startMs: d + 15 * 3_600_000, endMs: d + 17.5 * 3_600_000 }));

  it("keeps to the user's window when it fits everyone", () => {
    const slots = findGroupSlots({ ...window, participants: [person('Alex', 'America/New_York')] });
    expect(slots).toHaveLength(3);
    for (const s of slots) {
      // New York's 9:00 is 15:00 in Madrid; the user's day ends at 17:30.
      expect(madridMinutes(s.startMs)).toBeGreaterThanOrEqual(15 * 60);
      expect(madridMinutes(s.endMs)).toBeLessThanOrEqual(17 * 60 + 30);
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

  it('never offers a time before 9:00 or after 18:00 for the others', () => {
    // The overlap (15:00–17:30 Madrid) is booked on the coming days.
    const people = [
      person('Alyson', 'America/New_York', nyBusyAfternoons(days)),
      person('Tara', 'America/New_York'),
    ];
    const slots = findGroupSlots({ ...window, participants: people, laterDays });
    expect(slots).toHaveLength(3);
    for (const s of slots) {
      for (const p of people) expect(minutesOutsideDay(s, p.timeZone)).toBe(0);
    }
  });

  it("tries the user's window a week later before stretching the user's hours", () => {
    const people = [person('Alyson', 'America/New_York', nyBusyAfternoons(days))];
    const slots = findGroupSlots({ ...window, participants: people, laterDays });
    expect(slots).toHaveLength(3);
    for (const s of slots) {
      expect(s.startMs).toBeGreaterThanOrEqual(laterDays[0]!);
      expect(s.outsideMine).toBe(false);
    }
  });

  it("stretches the user's hours only when the window never fits", () => {
    // Los Angeles 9:00 is 18:00 in Madrid, past the user's 17:30.
    const slots = findGroupSlots({
      ...window,
      participants: [person('Kim', 'America/Los_Angeles')],
      laterDays,
    });
    expect(slots).toHaveLength(3);
    for (const s of slots) {
      expect(s.outsideMine).toBe(true);
      expect(madridMinutes(s.startMs)).toBeGreaterThanOrEqual(18 * 60);
      expect(madridMinutes(s.endMs)).toBeLessThanOrEqual(19 * 60 + 30);
    }
    expect(offHoursNote(slots[0]!)).toBe('late for you');
  });

  it('offers nothing when no hour suits everyone', () => {
    const people = [person('Ana', 'Pacific/Auckland'), person('Kim', 'America/Los_Angeles')];
    expect(findGroupSlots({ ...window, participants: people, laterDays })).toEqual([]);
  });

  it('treats unknown zones and hidden calendars as no constraint', () => {
    const slots = findGroupSlots({ ...window, participants: [person('Sam', null)] });
    expect(slots).toHaveLength(3);
    expect(slots.every((s) => !s.outsideMine)).toBe(true);
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

describe('calendar picker', () => {
  const day = at(2026, 10, 13);
  const slot = (h: number, m = 0, len = 30) => ({
    startMs: day + (h * 60 + m) * 60_000,
    endMs: day + (h * 60 + m + len) * 60_000,
  });

  it('says why a cell does not work', () => {
    const ctx = {
      myBusy: [slot(16)],
      participants: [
        person('Tara', 'America/New_York', [slot(15)]),
        person('Guilherme', 'America/Sao_Paulo'),
      ],
      startHour: 9.5,
      endHour: 17.5,
    };
    expect(cellStatus(slot(15, 30), ctx)).toEqual({ ok: true, inWindow: true, issues: [] });
    expect(cellStatus(slot(15), ctx).issues).toEqual(['Tara is busy']);
    expect(cellStatus(slot(16), ctx).issues[0]).toBe('You’re busy');
    // 10:00 Madrid is 5:00 in São Paulo (and 4:00 in New York).
    expect(cellStatus(slot(10), ctx).issues).toEqual(['04:00 for Tara', '05:00 for Guilherme']);
    expect(cellStatus(slot(18), ctx).inWindow).toBe(false);
  });

  it('adds, reshapes and removes picks', () => {
    let picks = addPick([], slot(15));
    picks = addPick(picks, slot(10));
    expect(picks.map((p) => p.startMs)).toEqual([slot(10).startMs, slot(15).startMs]);
    // Dragging 15:00–16:30 over the 15:00 pick replaces it.
    picks = addPick(picks, slot(15, 0, 90));
    expect(picks).toHaveLength(2);
    expect(picks[1]!.endMs - picks[1]!.startMs).toBe(90 * 60_000);
    expect(removePickAt(picks, slot(16).startMs)).toEqual([slot(10)]);
  });

  it('writes the block with a findable first line', () => {
    const text = timesBlock('These times work for me:', [slot(15)], []);
    expect(text).toBe('These times work for me:\n• Tuesday, October 13, 15:00–15:30 (CEST)');
  });
});
