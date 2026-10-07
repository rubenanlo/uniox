import type { CalendarEvent } from '@app/shared';
import { DAY_MS, startOfDay } from './calendarMonth';

/** All-day proper, or a timed event that crosses a midnight — both ride the
 *  all-day lane like Notion Calendar. */
export function isAllDayLike(e: CalendarEvent): boolean {
  return e.allDay || startOfDay(e.startMs) !== startOfDay(Math.max(e.startMs, e.endMs - 1));
}

export interface LanePlacement {
  event: CalendarEvent;
  lane: number;
  /** 0-based day column within the row. */
  startCol: number;
  /** Number of day columns covered (≥ 1, clipped to the row). */
  span: number;
}

/** Greedy first-fit lane packing for spanning chips across one week row. */
export function packLanes(
  events: CalendarEvent[],
  rowStart: number,
  rowEnd: number,
): LanePlacement[] {
  const cols = Math.round((rowEnd - rowStart) / DAY_MS);
  const sorted = [...events].sort((a, b) => a.startMs - b.startMs || b.endMs - a.endMs);
  const laneEnds: number[] = []; // per lane: last occupied end column (exclusive)
  const out: LanePlacement[] = [];
  for (const event of sorted) {
    if (event.endMs <= rowStart || event.startMs >= rowEnd) continue;
    const startCol = Math.min(
      cols - 1,
      Math.max(0, Math.floor((startOfDay(event.startMs) - rowStart) / DAY_MS)),
    );
    const endCol = Math.min(cols, Math.ceil((event.endMs - rowStart) / DAY_MS));
    const span = Math.max(1, endCol - startCol);
    let lane = laneEnds.findIndex((end) => end <= startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = startCol + span;
    out.push({ event, lane, startCol, span });
  }
  return out;
}

export interface ColumnPlacement {
  event: CalendarEvent;
  col: number;
  cols: number;
}

/** Column split for concurrent timed events within one day (Notion style:
 *  every member of an overlap cluster shares the cluster's column count). */
export function layoutColumns(events: CalendarEvent[]): ColumnPlacement[] {
  const sorted = [...events].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const placements: ColumnPlacement[] = [];
  let cluster: { event: CalendarEvent; col: number }[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
    for (const c of cluster) placements.push({ event: c.event, col: c.col, cols });
    cluster = [];
  };
  for (const event of sorted) {
    if (event.startMs >= clusterEnd && cluster.length) flush();
    const taken = cluster.filter((c) => c.event.endMs > event.startMs).map((c) => c.col);
    let col = 0;
    while (taken.includes(col)) col++;
    cluster.push({ event, col });
    clusterEnd = Math.max(clusterEnd, event.endMs);
  }
  if (cluster.length) flush();
  return placements;
}
