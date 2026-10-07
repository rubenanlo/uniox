import { create } from 'zustand';
import type { Calendar, CalendarEvent, Commands } from '@app/shared';
import { api } from '../lib/api';
import {
  type CalView,
  moveCursor,
  pageAnchor,
  rangeForView,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from '../lib/calendarMonth';

export type RightPaneState =
  | { kind: 'shortcuts' }
  | { kind: 'details'; event: CalendarEvent }
  | { kind: 'form'; draft: EventDraft; returnTo?: RightPaneState };

export interface EventDraft {
  /** Stored event id when editing; undefined when creating. */
  id?: string;
  calendarId: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  eventType: 'default' | 'outOfOffice';
  rrule?: string;
  location: string;
  description: string;
  meetingUrl: string;
  color?: string;
  /** Free/busy shown to other calendars; absent = busy. */
  transparency?: 'opaque' | 'transparent';
  /** 'google' switches the form into sync-back edit mode; absent = local. */
  source?: 'local' | 'google';
}

const HOUR = 3_600_000;

/** Anchor appropriate for a view, centred on a day. */
function anchorFor(view: CalView, dayMs: number): number {
  return view === 'month' ? startOfMonth(dayMs) : view === 'week' ? startOfWeek(dayMs) : startOfDay(dayMs);
}

interface CalendarState {
  view: CalView;
  anchor: number;
  cursor: number;
  events: CalendarEvent[];
  calendars: Calendar[];
  sidebarOpen: boolean;
  rightPaneOpen: boolean;
  rightPane: RightPaneState;
  /** Drop position of an in-review drag; the grid renders the chip there until saved or cancelled. */
  pendingMove: { id: string; startMs: number; endMs: number } | null;
  setView(view: CalView): void;
  setCursor(dayMs: number): void;
  moveCursorBy(deltaDays: number): void;
  page(dir: 1 | -1): void;
  goToday(): void;
  toggleSidebar(): void;
  toggleRightPane(): void;
  openDetails(event: CalendarEvent): void;
  openForm(draft: Partial<EventDraft> & { startMs: number; endMs: number }, returnTo?: RightPaneState): void;
  /** Drag drop: show the chip at its new slot and open the form to review/confirm. */
  beginReschedule(event: CalendarEvent, startMs: number, endMs: number): void;
  closePane(): void;
  refresh(): void;
  loadCalendars(): Promise<void>;
  setCalendarVisible(id: string, visible: boolean): void;
  subscribeCalendar(accountId: string, email: string): Promise<string | null>;
  unsubscribeCalendar(id: string): Promise<string | null>;
  save(draft: EventDraft): Promise<void>;
  /** In-place update keeping the event's source (Google events sync upstream). Returns an error to show, or null. */
  patch(args: Commands['calendar:event:patch']['args']): Promise<string | null>;
  remove(id: string): Promise<void>;
}

export const useCalendar = create<CalendarState>((set, get) => ({
  view: 'week',
  anchor: startOfWeek(Date.now()),
  cursor: startOfDay(Date.now()),
  events: [],
  calendars: [],
  sidebarOpen: true,
  rightPaneOpen: true,
  rightPane: { kind: 'shortcuts' },
  pendingMove: null,

  setView: (view) => {
    set((s) => ({ view, anchor: anchorFor(view, s.cursor) }));
    get().refresh();
  },
  setCursor: (dayMs) => {
    const day = startOfDay(dayMs);
    set((s) => ({ cursor: day, anchor: anchorFor(s.view, day) }));
    get().refresh();
  },
  moveCursorBy: (deltaDays) => {
    const s = get();
    const next = moveCursor(s.view, s.anchor, s.cursor, deltaDays);
    set({ cursor: next.cursor, anchor: next.anchor });
    if (next.anchor !== s.anchor) s.refresh();
  },
  page: (dir) => {
    const s = get();
    const anchor = pageAnchor(s.view, s.anchor, dir);
    const { start, end } = rangeForView(s.view, anchor);
    // Snapping to `start` in month view lands on a dimmed previous-month cell
    // (gridStart); anchor the cursor to the first of the new month instead.
    const fallback = s.view === 'month' ? startOfDay(anchor) : start;
    const cursor = s.cursor >= start && s.cursor < end ? s.cursor : fallback;
    set({ anchor, cursor });
    s.refresh();
  },
  goToday: () => get().setCursor(Date.now()),

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleRightPane: () => set((s) => ({ rightPaneOpen: !s.rightPaneOpen })),
  openDetails: (event) =>
    set({ rightPane: { kind: 'details', event }, rightPaneOpen: true, pendingMove: null }),
  openForm: (partial, returnTo) =>
    set((s) => ({
      pendingMove: null, // beginReschedule re-sets it after opening the form
      rightPaneOpen: true,
      rightPane: {
        kind: 'form',
        draft: {
          calendarId: s.calendars.find((c) => c.accountId)?.id ?? 'local-default',
          title: '',
          allDay: false,
          eventType: 'default',
          location: '',
          description: '',
          meetingUrl: '',
          ...partial,
        },
        returnTo,
      },
    })),
  beginReschedule: (event, startMs, endMs) => {
    get().openForm({ ...draftFromEvent(event), startMs, endMs });
    set({ pendingMove: { id: event.id, startMs, endMs } });
  },
  // A form opened from details (e.g. Edit) returns there on Esc/X; otherwise
  // fall back to the shortcuts panel. Cancelling also reverts any in-review drag.
  closePane: () =>
    set((s) => ({
      pendingMove: null,
      rightPane:
        s.rightPane.kind === 'form' && s.rightPane.returnTo
          ? s.rightPane.returnTo
          : { kind: 'shortcuts' },
    })),

  refresh: () => {
    const { view, anchor } = get();
    const { start, end } = rangeForView(view, anchor);
    void api
      .query('calendar:events', { startMs: start, endMs: end })
      .then((events) => set({ events }))
      .catch(() => {});
  },
  loadCalendars: async () => {
    const calendars = await api.query('calendar:list', undefined);
    set({ calendars });
  },
  setCalendarVisible: (id, visible) => {
    set((s) => ({
      calendars: s.calendars.map((c) => (c.id === id ? { ...c, visible } : c)),
    }));
    void api.command('calendar:setVisible', { id, visible }).then(() => get().refresh());
  },
  // Returns an error message to show, or null on success. The delta from the
  // worker's reconcile refreshes calendars + events, but reload here too so the
  // sidebar updates immediately even if the delta is missed.
  subscribeCalendar: async (accountId, email) => {
    const res = await api.command('calendar:subscribe', { accountId, email });
    if (!res.ok) return res.error ?? 'Could not add that calendar.';
    await get().loadCalendars();
    get().refresh();
    return null;
  },
  unsubscribeCalendar: async (id) => {
    const res = await api.command('calendar:unsubscribe', { id });
    if (!res.ok) return res.error ?? 'Could not unsubscribe.';
    await get().loadCalendars();
    get().refresh();
    return null;
  },

  save: async (draft) => {
    await api.command('calendar:event:save', {
      event: {
        id: draft.id,
        calendarId: draft.calendarId,
        title: draft.title,
        startMs: draft.startMs,
        endMs: draft.endMs,
        allDay: draft.allDay,
        eventType: draft.eventType,
        rrule: draft.rrule,
        location: draft.location.trim() || undefined,
        description: draft.description.trim() || undefined,
        meetingUrl: draft.meetingUrl.trim() || undefined,
        color: draft.color,
        transparency: draft.transparency,
      },
    });
    set({ rightPane: { kind: 'shortcuts' }, pendingMove: null });
    get().refresh();
  },
  patch: async (args) => {
    const res = await api.command('calendar:event:patch', args);
    set({ pendingMove: null });
    if (!res.ok) {
      get().refresh(); // snap the chip back to the stored time
      return res.error ?? 'Could not update the event.';
    }
    set({ rightPane: { kind: 'shortcuts' } });
    get().refresh();
    return null;
  },
  remove: async (id) => {
    await api.command('calendar:event:delete', { id });
    set({ rightPane: { kind: 'shortcuts' }, pendingMove: null });
    get().refresh();
  },
}));

/** Wire the change delta + initial load, app-level (call from App effect). */
export function wireCalendar(): () => void {
  useCalendar.getState().refresh();
  void useCalendar.getState().loadCalendars();
  return api.onDelta((e) => {
    if (e.kind === 'calendar-changed') {
      useCalendar.getState().refresh();
      void useCalendar.getState().loadCalendars();
    }
    if (e.kind === 'accounts-changed') void useCalendar.getState().loadCalendars();
  });
}

export function draftFromEvent(e: CalendarEvent): EventDraft {
  return {
    id: e.id,
    calendarId: e.calendarId,
    title: e.title,
    startMs: e.startMs,
    endMs: e.endMs,
    allDay: e.allDay,
    eventType: e.eventType,
    rrule: e.rrule,
    location: e.location ?? '',
    description: e.description ?? '',
    meetingUrl: e.meetingUrl ?? '',
    color: e.color,
    transparency: e.transparency,
    source: e.source === 'google' ? 'google' : 'local',
  };
}

export function newDraft(dayMs: number, calendars: Calendar[]): EventDraft {
  const day = startOfDay(dayMs);
  return {
    calendarId: calendars.find((c) => c.accountId)?.id ?? 'local-default',
    title: '',
    startMs: day + 9 * HOUR,
    endMs: day + 10 * HOUR,
    allDay: false,
    eventType: 'default',
    location: '',
    description: '',
    meetingUrl: '',
  };
}
