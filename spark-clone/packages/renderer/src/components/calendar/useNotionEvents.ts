import { useMemo } from 'react';
import { create } from 'zustand';
import type { CalendarEvent } from '@app/shared';
import { expandEvent } from '../../lib/rrule';
import { DAY_MS, startOfDay } from '../../lib/calendarMonth';
import { useCalendar } from '../../state/calendar';
import { useKanban } from '../../state/kanban';

const NOTION_COLOR = '#8b5cf6';

/** Derive read-only all-day events from Notion board cards that carry a due date. */
export function useNotionEvents(): CalendarEvent[] {
  const board = useKanban((s) => s.board);
  return useMemo(() => {
    if (!board) return [];
    const out: CalendarEvent[] = [];
    for (const col of board.columns) {
      for (const card of col.cards) {
        if (!card.dueDate) continue;
        const t = Date.parse(card.dueDate);
        if (Number.isNaN(t)) continue;
        const day = startOfDay(t);
        out.push({
          id: `notion:${card.id}`,
          calendarId: 'notion',
          source: 'notion',
          title: card.title,
          startMs: day,
          endMs: day + DAY_MS,
          allDay: true,
          eventType: 'default',
          color: NOTION_COLOR,
          url: card.url,
          readOnly: true,
        });
      }
    }
    return out;
  }, [board]);
}

/** Session-only visibility for the derived Notion calendar (sidebar eye). */
export const useNotionVisible = create<{ visible: boolean; toggle(): void }>((set) => ({
  visible: true,
  toggle: () => set((s) => ({ visible: !s.visible })),
}));

/** Everything the grids render: stored events expanded for the range, plus
 *  Notion due-dates, sorted all-day-first then by start. */
export function useVisibleEvents(rangeStart: number, rangeEnd: number): CalendarEvent[] {
  const stored = useCalendar((s) => s.events);
  const pendingMove = useCalendar((s) => s.pendingMove);
  const notion = useNotionEvents();
  const notionVisible = useNotionVisible((s) => s.visible);
  return useMemo(() => {
    const expanded = stored.flatMap((e) => expandEvent(e, rangeStart, rangeEnd));
    const merged = notionVisible
      ? [...expanded, ...notion.filter((e) => e.startMs < rangeEnd && e.endMs > rangeStart)]
      : expanded;
    // A dropped-but-unconfirmed drag renders at its new slot; save persists it,
    // cancel clears pendingMove and the chip snaps back.
    const moved = pendingMove
      ? merged.map((e) =>
          e.id === pendingMove.id
            ? { ...e, startMs: pendingMove.startMs, endMs: pendingMove.endMs }
            : e,
        )
      : merged;
    return moved.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startMs - b.startMs);
  }, [stored, pendingMove, notion, notionVisible, rangeStart, rangeEnd]);
}
