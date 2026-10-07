import type { CalendarEvent } from '@app/shared';
import { addDays, startOfDay } from './calendarMonth';

/**
 * Phase-1 recurrence: the four Notion-style presets expand client-side; any
 * other RRULE renders its base occurrence only until the phase-3 engine.
 */
export type RepeatPreset = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function presetRrule(preset: RepeatPreset, startMs: number): string | undefined {
  const d = new Date(startMs);
  switch (preset) {
    case 'daily': return 'FREQ=DAILY';
    case 'weekly': return `FREQ=WEEKLY;BYDAY=${BYDAY[d.getDay()]}`;
    case 'monthly': return `FREQ=MONTHLY;BYMONTHDAY=${d.getDate()}`;
    case 'yearly': return 'FREQ=YEARLY';
    default: return undefined;
  }
}

/** Parse `A=B;C=D` into a map; returns null for anything we can't expand. */
function parsePreset(rrule: string): { freq: string; byday?: number; bymonthday?: number } | null {
  const parts = Object.fromEntries(rrule.split(';').map((p) => p.split('=') as [string, string]));
  const keys = Object.keys(parts);
  const freq = parts.FREQ;
  if (!freq) return null;
  if (freq === 'DAILY' && keys.length === 1) return { freq };
  if (freq === 'WEEKLY' && keys.length === 2 && parts.BYDAY) {
    const day = BYDAY.indexOf(parts.BYDAY as (typeof BYDAY)[number]);
    return day >= 0 ? { freq, byday: day } : null;
  }
  if (freq === 'MONTHLY' && keys.length === 2 && parts.BYMONTHDAY)
    return { freq, bymonthday: Number(parts.BYMONTHDAY) };
  if (freq === 'YEARLY' && keys.length === 1) return { freq };
  return null;
}

export function ruleLabel(rrule: string | undefined): string {
  if (!rrule) return "Doesn't repeat";
  const p = parsePreset(rrule);
  if (!p) return 'Custom';
  if (p.freq === 'DAILY') return 'Daily';
  if (p.freq === 'WEEKLY') return `Weekly on ${DAY_NAMES[p.byday!]}`;
  if (p.freq === 'MONTHLY') return `Monthly on day ${p.bymonthday}`;
  return 'Yearly';
}

/** All occurrences of `event` overlapping [rangeStart, rangeEnd). */
export function expandEvent(
  event: CalendarEvent,
  rangeStart: number,
  rangeEnd: number,
): CalendarEvent[] {
  const overlaps = (s: number, e: number) => s < rangeEnd && e > rangeStart;
  if (!event.rrule) return overlaps(event.startMs, event.endMs) ? [event] : [];
  const rule = parsePreset(event.rrule);
  if (!rule) return overlaps(event.startMs, event.endMs) ? [event] : [];

  const duration = event.endMs - event.startMs;
  const base = new Date(event.startMs);
  const out: CalendarEvent[] = [];
  const push = (startMs: number) => {
    if (startMs < event.startMs || !overlaps(startMs, startMs + duration)) return;
    out.push(
      startMs === event.startMs
        ? event
        : { ...event, id: `${event.id}:${startMs}`, startMs, endMs: startMs + duration },
    );
  };

  // Walk the range day by day (bounded: ranges are ≤ 42 days).
  for (let day = startOfDay(rangeStart); day < rangeEnd; day = addDays(day, 1)) {
    const d = new Date(day);
    const at = new Date(
      d.getFullYear(), d.getMonth(), d.getDate(), base.getHours(), base.getMinutes(),
    ).getTime();
    if (rule.freq === 'DAILY') push(at);
    else if (rule.freq === 'WEEKLY' && d.getDay() === rule.byday) push(at);
    else if (rule.freq === 'MONTHLY' && d.getDate() === rule.bymonthday) push(at);
    else if (
      rule.freq === 'YEARLY' &&
      d.getDate() === base.getDate() &&
      d.getMonth() === base.getMonth()
    )
      push(at);
  }
  return out;
}

/**
 * The stored series id behind any (possibly expanded-occurrence) event id.
 * Guard in the caller: only call `seriesId` for `source === 'local'` events
 * (details-pane edit/delete path). Do NOT call on `notion:` ids.
 */
export function seriesId(eventId: string): string {
  return eventId.split(':')[0]!;
}
