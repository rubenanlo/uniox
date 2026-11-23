import type { CalendarEvent } from './calendar';

/**
 * Titles that calendar-blocking tools (Reclaim, OneCal, Clockwise, Zapier
 * mirrors, or a hand-made cross-account block) give the copy they drop into a
 * second calendar. Leading emoji/punctuation and a trailing "(via …)" are fine.
 */
const BLOCKER_TITLE = /^[^\p{L}\p{N}]*(busy|blocked|unavailable|not available|ocupado)\b/iu;

export function isBlockerTitle(title: string): boolean {
  const t = title.trim();
  return t === '' || BLOCKER_TITLE.test(t);
}

/** The fields the dedupe reads; desktop and phone events both have them. */
export type DedupableEvent = Pick<CalendarEvent, 'title' | 'startMs' | 'endMs' | 'allDay' | 'calendarId'> & {
  readOnly?: boolean;
};

const slotKey = (e: DedupableEvent) => `${e.allDay ? 'd' : 't'}:${e.startMs}:${e.endMs}`;
const norm = (s: string) => s.trim().toLowerCase();

/**
 * Hide copies of an event that another calendar already shows at the exact
 * same time:
 * - a "Busy"-style block mirrored from a real event in a different calendar;
 * - the same invite (same title) landing in two connected calendars.
 * Events within one calendar are never merged, and a lone "Busy" block with no
 * real event behind it stays visible. Editable copies win over read-only ones.
 */
export function dedupeMirroredEvents<T extends DedupableEvent>(events: T[]): T[] {
  const slots = new Map<string, T[]>();
  for (const e of events) {
    const k = slotKey(e);
    const list = slots.get(k);
    if (list) list.push(e);
    else slots.set(k, [e]);
  }
  const hidden = new Set<T>();
  for (const group of slots.values()) {
    if (group.length < 2) continue;
    const real = group.filter((e) => !isBlockerTitle(e.title));
    for (const e of group) {
      if (isBlockerTitle(e.title) && real.some((r) => r.calendarId !== e.calendarId)) {
        hidden.add(e);
      }
    }
    // Same invite in several calendars: keep one, preferring an editable copy.
    const kept = new Map<string, T>();
    const ordered = [...real].sort((a, b) => Number(!!a.readOnly) - Number(!!b.readOnly));
    for (const e of ordered) {
      const k = norm(e.title);
      const first = kept.get(k);
      if (!first) kept.set(k, e);
      else if (first.calendarId !== e.calendarId) hidden.add(e);
    }
  }
  return hidden.size ? events.filter((e) => !hidden.has(e)) : events;
}
