import type { Calendar, CalendarEvent } from '@app/shared';

/**
 * Whether the user can edit (and drag-reschedule) an event. Local events
 * always; Google events when their calendar belongs to one of the user's
 * accounts (write-back PATCHes upstream — a reader-only calendar surfaces
 * Google's 403 as a save error). Notion events never.
 */
export function canEditEvent(event: CalendarEvent, calendars: Calendar[]): boolean {
  if (event.source === 'local') return true;
  if (event.source !== 'google') return false;
  return Boolean(calendars.find((c) => c.id === event.calendarId)?.accountId);
}
