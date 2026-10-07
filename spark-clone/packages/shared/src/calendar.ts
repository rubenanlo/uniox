/** A calendar the user can see events from (local, or a synced Google calendar). */
export interface Calendar {
  id: string;
  name: string;
  color: string;
  source: 'local' | 'google';
  visible: boolean;
  /** Owning mail account; undefined for the free-floating local calendar. */
  accountId?: string;
}

/**
 * A single event instance for a queried range. `source` distinguishes stored
 * rows (`local`/`google`) from renderer-derived Notion due-dates (`notion`,
 * read-only). Times are UTC ms; all-day events span date boundaries.
 */
export interface CalendarEvent {
  id: string;
  calendarId: string;
  source: 'local' | 'google' | 'notion';
  title: string;
  description?: string;
  location?: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  /** 'outOfOffice' renders the Notion ⊗ style; default is a normal event. */
  eventType: 'default' | 'outOfOffice';
  /** RFC-5545 recurrence rule; presets expand client-side in phase 1. */
  rrule?: string;
  /** Owning mail account, derived from the calendar (undefined = local). */
  accountId?: string;
  /** Per-event color override; falls back to the calendar color in the UI. */
  color?: string;
  meetingUrl?: string;
  /** External link (e.g. the Notion page) for read-only sources. */
  url?: string;
  /** True for sources the user can't edit in Uniox (Notion, and Google in MVP). */
  readOnly?: boolean;
  /** 'transparent' shows as Free in other calendars; absent/'opaque' = Busy. */
  transparency?: 'opaque' | 'transparent';
}

/** The writable shape sent to `calendar:event:save` (id omitted = create). */
export interface CalendarEventInput {
  id?: string;
  calendarId?: string;
  title: string;
  description?: string;
  location?: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  eventType?: 'default' | 'outOfOffice';
  rrule?: string;
  color?: string;
  meetingUrl?: string;
  transparency?: 'opaque' | 'transparent';
}

/**
 * Whether a calendar's events make the user busy. Subscribed colleague
 * calendars (Google ids that are someone else's address) and read-only
 * public feeds (holidays, sports: `@group.v.calendar.google.com`) don't;
 * the local calendar, each account's primary calendar, calendars the user
 * created (`@group.calendar.google.com`) and another of the user's own
 * accounts' calendars do.
 */
export function isOwnCalendar(
  cal: { id: string; source: string; remoteId?: string | null },
  ownEmails: readonly string[],
): boolean {
  if (cal.source === 'local' || cal.id.startsWith('acct:')) return true;
  const remote = (cal.remoteId ?? '').toLowerCase();
  if (!remote) return false;
  if (remote.endsWith('@group.calendar.google.com')) return true;
  return ownEmails.some((e) => e.toLowerCase() === remote);
}
