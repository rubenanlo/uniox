import type { Calendar, CalendarEvent } from '@app/shared';
import { seriesId } from './rrule';

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

/**
 * The stored id to delete for an event, or null when it can't be deleted here.
 * Local occurrences delete their series; Google rows (one occurrence each) go
 * by their own id, since `seriesId` would cut `gev:cal:id` down to `gev`.
 */
export function deleteTargetId(event: CalendarEvent, calendars: Calendar[]): string | null {
  if (event.source === 'local') return seriesId(event.id);
  if (event.source === 'google' && canEditEvent(event, calendars)) return event.id;
  return null;
}
