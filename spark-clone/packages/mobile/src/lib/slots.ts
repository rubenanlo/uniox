import type { MobileEvent } from '../data/types';
import { addDays, startOfDay } from './format';

/** Up to `count` free 30-minute slots on the next working days, 9:00–18:00 local time. */
export function freeSlots(
  events: MobileEvent[],
  count = 3,
  now = Date.now(),
): { startMs: number; endMs: number }[] {
  const busy = events.filter((e) => !e.free && !e.allDay);
  const out: { startMs: number; endMs: number }[] = [];
  for (let d = 1; d <= 10 && out.length < count; d++) {
    const day = addDays(startOfDay(now), d);
    const dow = new Date(day).getDay();
    if (dow === 0 || dow === 6) continue;
    let perDay = 0;
    for (let m = 9 * 60; m < 18 * 60 && perDay < 2 && out.length < count; m += 30) {
      const s = new Date(day);
      s.setHours(0, m, 0, 0);
      const start = s.getTime();
      const end = start + 30 * 60_000;
      if (busy.some((e) => e.startMs < end && e.endMs > start)) continue;
      out.push({ startMs: start, endMs: end });
      perDay++;
      m += 60;
    }
  }
  return out;
}

export function describeSlots(slots: { startMs: number; endMs: number }[]): string {
  const fmt = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return slots
    .map(
      (s) =>
        `${new Date(s.startMs).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}, ${fmt(s.startMs)}–${fmt(s.endMs)}`,
    )
    .join('\n');
}
