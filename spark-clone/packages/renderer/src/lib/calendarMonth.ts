/**
 * Month-grid math in the local time zone (Phase 1 — real time zones arrive with
 * a date library in Phase 3). All values are epoch-ms at local day boundaries.
 */

export const DAY_MS = 86_400_000;

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function startOfMonth(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export function addMonths(ms: number, n: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime();
}

export function monthLabel(anchorMs: number): string {
  return new Date(anchorMs).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** The 42-day (6×7) grid whose first cell is the Sunday on/before the 1st. */
export function monthGrid(anchorMs: number): { days: number[]; gridStart: number; gridEnd: number } {
  const first = startOfMonth(anchorMs);
  const gridStart = first - new Date(first).getDay() * DAY_MS;
  const days = Array.from({ length: 42 }, (_, i) => startOfDay(gridStart + i * DAY_MS));
  return { days, gridStart: days[0]!, gridEnd: days[41]! + DAY_MS };
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function isSameMonth(dayMs: number, anchorMs: number): boolean {
  const a = new Date(dayMs);
  const b = new Date(anchorMs);
  return a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
}

export function isToday(dayMs: number): boolean {
  return startOfDay(dayMs) === startOfDay(Date.now());
}

/** Does an event overlap the local day starting at `dayMs`? */
export function overlapsDay(startMs: number, endMs: number, dayMs: number): boolean {
  return startMs < dayMs + DAY_MS && endMs > dayMs;
}

/** "9:00" style local time label. */
export function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export type CalView = 'month' | 'week' | 'day';

/** Day stepping that survives DST (noon-anchored, then floored). */
export function addDays(ms: number, n: number): number {
  return startOfDay(startOfDay(ms) + n * DAY_MS + DAY_MS / 2);
}

export function startOfWeek(ms: number): number {
  return addDays(startOfDay(ms), -new Date(startOfDay(ms)).getDay());
}

export function rangeForView(
  view: CalView,
  anchorMs: number,
): { start: number; end: number; days: number[] } {
  if (view === 'month') {
    const { days, gridStart, gridEnd } = monthGrid(anchorMs);
    return { start: gridStart, end: gridEnd, days };
  }
  const first = view === 'week' ? startOfWeek(anchorMs) : startOfDay(anchorMs);
  const count = view === 'week' ? 7 : 1;
  const days = Array.from({ length: count }, (_, i) => addDays(first, i));
  return { start: days[0]!, end: addDays(days[count - 1]!, 1), days };
}

export function pageAnchor(view: CalView, anchorMs: number, dir: 1 | -1): number {
  if (view === 'month') return addMonths(anchorMs, dir);
  return addDays(anchorMs, dir * (view === 'week' ? 7 : 1));
}

/** Step the day cursor; walking out of the visible range pages the anchor. */
export function moveCursor(
  view: CalView,
  anchorMs: number,
  cursorMs: number,
  deltaDays: number,
): { anchor: number; cursor: number } {
  const cursor = addDays(cursorMs, deltaDays);
  const { start, end } = rangeForView(view, anchorMs);
  if (cursor >= start && cursor < end) return { anchor: anchorMs, cursor };
  const anchor = view === 'month' ? startOfMonth(cursor) : view === 'week' ? startOfWeek(cursor) : cursor;
  return { anchor, cursor };
}

export const viewTitle = monthLabel;
