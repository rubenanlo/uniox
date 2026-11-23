import type { CalendarEvent } from '@app/shared';
import { api } from './api';
import { dedupeMirroredEvents, isBlockerTitle } from './eventDedupe';

/** Today's calendar, as the Assistant's timeline card shows it. */
export interface TodayEvents {
  dayStartMs: number;
  /** Timed events, deduped and sorted by start. */
  events: CalendarEvent[];
  allDay: CalendarEvent[];
  /** "Busy" copies of real events from another calendar, hidden by default. */
  mirrors: CalendarEvent[];
  calendars: Record<string, { name: string; color: string }>;
}

export async function loadTodayEvents(now = new Date()): Promise<TodayEvents> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const dayStartMs = start.getTime();
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const [raw, cals] = await Promise.all([
    api.query('calendar:events', { startMs: dayStartMs, endMs: end.getTime() }),
    api.query('calendar:list', undefined).catch(() => []),
  ]);
  const hiddenCals = new Set(cals.filter((c) => !c.visible).map((c) => c.id));
  const all = raw.filter((e) => !hiddenCals.has(e.calendarId));
  const kept = new Set(dedupeMirroredEvents(all));
  const mirrors = all.filter((e) => !kept.has(e) && isBlockerTitle(e.title) && !e.allDay);
  const shown = [...kept].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  return {
    dayStartMs,
    events: shown.filter((e) => !e.allDay),
    allDay: shown.filter((e) => e.allDay),
    mirrors,
    calendars: Object.fromEntries(cals.map((c) => [c.id, { name: c.name, color: c.color }])),
  };
}

/** The same day as plain text, for the model's system prompt. */
export function todayEventsContext(day: TodayEvents, now = new Date()): string {
  const t = (ms: number) =>
    new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const rows = [
    ...day.allDay.map((e) => `- All day: ${e.title}`),
    ...day.events.map(
      (e) =>
        `- ${t(e.startMs)}–${t(e.endMs)}: ${e.title}${e.location ? ` (${e.location})` : ''}` +
        (e.meetingUrl ? ' [video call]' : '') +
        (e.attendees?.length
          ? ` · with ${e.attendees.map((p) => p.name || p.email).join(', ')}`
          : ''),
    ),
  ];
  return (
    `Now: ${now.toLocaleString()}.\nThe user's calendar for today, from Uniox's synced ` +
    `calendars:\n${rows.join('\n') || '(no events today)'}\n\n` +
    'Uniox shows these events to the user as a visual timeline card right under your reply ' +
    '(times, call links, attendees). So do not list the events or repeat their times one by ' +
    'one. Answer in one or two short sentences: how many events, what is next and when, and ' +
    'anything worth noticing (a long free stretch, back-to-back meetings). Use **bold** ' +
    'sparingly for the key fact. Ignore "Busy" placeholder blocks.'
  );
}
