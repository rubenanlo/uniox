import type { Calendar, CalendarEvent } from '@app/shared';
import { addDays } from './calendarMonth';
import { isAllDayLike } from './eventLayout';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Working hours the Agenda looks for free time in. */
export const WORK_START = 8;
export const WORK_END = 19;
/** Shortest gap worth offering as a free slot. */
export const MIN_SLOT_MINS = 30;

export interface Slot {
  startMs: number;
  endMs: number;
}

/** Event color: explicit override → calendar color → accent. */
export function eventColor(event: CalendarEvent, calendars: Calendar[]): string {
  return (
    event.color ?? calendars.find((c) => c.id === event.calendarId)?.color ?? 'var(--color-accent)'
  );
}

/** Soft translucent fill of a color (hex → +alpha, else color-mix). */
export function softFill(color: string, pct = 14): string {
  if (color.startsWith('#') && color.length === 7)
    return (
      color +
      Math.round((pct / 100) * 255)
        .toString(16)
        .padStart(2, '0')
    );
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

/** "1h 45m" style length. */
export function durationLabel(ms: number): string {
  const mins = Math.round(ms / MIN);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Timed events that block time: all-day and Free (transparent) ones don't. */
export function isBusy(e: CalendarEvent): boolean {
  return !isAllDayLike(e) && e.transparency !== 'transparent';
}

/** Timed events starting on the local day `dayMs`, by start. */
export function timedOn(events: CalendarEvent[], dayMs: number): CalendarEvent[] {
  const end = addDays(dayMs, 1);
  return events
    .filter((e) => !isAllDayLike(e) && e.startMs >= dayMs && e.startMs < end)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

/** All-day events covering the local day `dayMs`. */
export function allDayOn(events: CalendarEvent[], dayMs: number): CalendarEvent[] {
  const end = addDays(dayMs, 1);
  return events.filter((e) => isAllDayLike(e) && e.startMs < end && e.endMs > dayMs);
}

/** Open windows of at least `minMins` inside working hours on `dayMs`,
 *  starting no earlier than `fromMs` (pass now for today). */
export function freeSlots(
  events: CalendarEvent[],
  dayMs: number,
  fromMs = 0,
  minMins = MIN_SLOT_MINS,
): Slot[] {
  const dayEnd = addDays(dayMs, 1);
  const stop = dayMs + WORK_END * HOUR;
  let cur = Math.max(dayMs + WORK_START * HOUR, fromMs);
  const out: Slot[] = [];
  const busy = events
    .filter((e) => isBusy(e) && e.startMs < dayEnd && e.endMs > dayMs)
    .sort((a, b) => a.startMs - b.startMs);
  for (const e of busy) {
    const end = Math.min(e.startMs, stop);
    if (end - cur >= minMins * MIN) out.push({ startMs: cur, endMs: end });
    cur = Math.max(cur, e.endMs);
    if (cur >= stop) break;
  }
  if (stop - cur >= minMins * MIN) out.push({ startMs: cur, endMs: stop });
  return out;
}

/** Position of a time on the working-hours track, 0–100 (clamped). */
export function trackPct(ms: number): number {
  const d = new Date(ms);
  const h = d.getHours() + d.getMinutes() / 60;
  return Math.max(0, Math.min(100, ((h - WORK_START) / (WORK_END - WORK_START)) * 100));
}
