/**
 * Meeting alerts: each timed event notifies twice — a heads-up inside the
 * 10-minute lead window and once at start. Pure deadline math; the service
 * owns the timer, the fired-set, and the notification itself.
 */

export const LEAD_MS = 10 * 60_000;
/** A 'start' alert this long past due is stale — don't ping about a meeting already underway. */
export const START_GRACE_MS = 2 * 60_000;

export interface AlertableEvent {
  id: string;
  title: string;
  startMs: number;
  allDay: boolean;
  eventType: 'default' | 'outOfOffice';
  location?: string;
}

export type AlertStage = 'lead' | 'start';

export interface DueAlert {
  key: string;
  stage: AlertStage;
  event: AlertableEvent;
}

/** startMs is part of the key so a rescheduled event alerts again. */
export function alertKey(e: Pick<AlertableEvent, 'id' | 'startMs'>, stage: AlertStage): string {
  return `${stage}@${e.startMs}@${e.id}`;
}

function alertable(e: AlertableEvent): boolean {
  // All-day events have no meaningful "10 minutes before" and out-of-office
  // blocks aren't meetings.
  return !e.allDay && e.eventType !== 'outOfOffice';
}

/**
 * Alerts due right now. The lead alert fires anywhere inside its window —
 * opening the app 7 minutes before a meeting still gets a heads-up — but a
 * stage never fires late enough to be noise (lead stops at start; start
 * stops after the grace window).
 */
export function dueAlerts(
  events: AlertableEvent[],
  now: number,
  fired: { has(key: string): boolean },
): DueAlert[] {
  const due: DueAlert[] = [];
  for (const e of events) {
    if (!alertable(e)) continue;
    if (now >= e.startMs - LEAD_MS && now < e.startMs) {
      const key = alertKey(e, 'lead');
      if (!fired.has(key)) due.push({ key, stage: 'lead', event: e });
    }
    if (now >= e.startMs && now < e.startMs + START_GRACE_MS) {
      const key = alertKey(e, 'start');
      if (!fired.has(key)) due.push({ key, stage: 'start', event: e });
    }
  }
  return due.sort((a, b) => a.event.startMs - b.event.startMs);
}

/** Earliest strictly-future alert boundary, or null when nothing is pending. */
export function nextAlertDeadline(
  events: AlertableEvent[],
  now: number,
  fired: { has(key: string): boolean },
): number | null {
  let next: number | null = null;
  for (const e of events) {
    if (!alertable(e)) continue;
    for (const [stage, at] of [
      ['lead', e.startMs - LEAD_MS],
      ['start', e.startMs],
    ] as const) {
      if (at <= now || fired.has(alertKey(e, stage))) continue;
      if (next === null || at < next) next = at;
    }
  }
  return next;
}
