const HOUR_MS = 3_600_000;
const DAY_HOURS = 24;

/** Pixel geometry of the TimeGrid body, captured when a chip drag starts. */
export interface DragGeometry {
  /** Day-start ms for each rendered column. */
  days: number[];
  /** Width of the hour-label gutter, px. */
  gutter: number;
  /** Width of one day column, px. */
  colWidth: number;
  hourPx: number;
  snapPx: number;
}

export interface DragTarget {
  dayIndex: number;
  /** Snapped chip top within the day column, px. */
  top: number;
  startMs: number;
  endMs: number;
}

/**
 * Where a dragged chip lands for a pointer at (x, y) relative to the grid
 * body. `grabOffsetY` keeps the point grabbed inside the chip under the
 * pointer; the top snaps to `snapPx` and stays inside the day.
 */
export function dragTarget(
  geo: DragGeometry,
  x: number,
  y: number,
  grabOffsetY: number,
  durationMs: number,
): DragTarget {
  const dayIndex = Math.max(
    0,
    Math.min(geo.days.length - 1, Math.floor((x - geo.gutter) / geo.colWidth)),
  );
  const heightPx = (durationMs / HOUR_MS) * geo.hourPx;
  const maxTop = Math.max(0, DAY_HOURS * geo.hourPx - heightPx);
  const snapped = Math.round((y - grabOffsetY) / geo.snapPx) * geo.snapPx;
  const top = Math.max(0, Math.min(maxTop, snapped));
  const startMs = geo.days[dayIndex]! + (top / geo.hourPx) * HOUR_MS;
  return { dayIndex, top, startMs, endMs: startMs + durationMs };
}
