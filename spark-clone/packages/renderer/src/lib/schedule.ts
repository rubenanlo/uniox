import { DEFAULT_SCHEDULING, type SchedulingPresets } from '@app/shared';

export interface PresetOption {
  id: string;
  label: string;
  detail: string;
  when: number | null; // ms epoch; null = Someday
}

function at(base: Date, hour: number): Date {
  const d = new Date(base);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** Compute the live preset list (report §2.2: one Settings surface, three consumers). */
export function presetOptions(p: SchedulingPresets, opts: { someday: boolean }): PresetOption[] {
  const now = new Date();
  const out: PresetOption[] = [];

  const later = new Date(now.getTime() + p.laterTodayHours * 3_600_000);
  out.push({ id: 'later', label: 'Later today', detail: fmtTime(later), when: later.getTime() });

  const evening = at(now, p.eveningHour);
  if (evening.getTime() > now.getTime() + 30 * 60_000) {
    out.push({ id: 'evening', label: 'This evening', detail: fmtTime(evening), when: evening.getTime() });
  }

  const tomorrow = at(new Date(now.getTime() + 86_400_000), p.morningHour);
  out.push({ id: 'tomorrow', label: 'Tomorrow', detail: fmtDay(tomorrow), when: tomorrow.getTime() });

  const weekend = new Date(now);
  const delta = (p.weekendDay - now.getDay() + 7) % 7 || 7;
  weekend.setDate(now.getDate() + delta);
  out.push({
    id: 'weekend',
    label: 'This weekend',
    detail: fmtDay(at(weekend, p.morningHour)),
    when: at(weekend, p.morningHour).getTime(),
  });

  const nextWeek = new Date(now);
  nextWeek.setDate(now.getDate() + (((1 - now.getDay() + 7) % 7) || 7));
  out.push({
    id: 'next-week',
    label: 'Next week',
    detail: fmtDay(at(nextWeek, p.morningHour)),
    when: at(nextWeek, p.morningHour).getTime(),
  });

  if (opts.someday) {
    out.push({ id: 'someday', label: 'Someday', detail: 'no timer', when: null });
  }
  return out;
}

export function fmtTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function fmtDay(d: Date): string {
  return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

export function fmtWake(ms: number | null | undefined): string {
  if (ms == null) return 'Someday';
  const d = new Date(ms);
  const days = (ms - Date.now()) / 86_400_000;
  if (days < 1 && d.getDate() === new Date().getDate()) return fmtTime(d);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export async function loadPresets(
  get: (key: string) => Promise<unknown>,
): Promise<SchedulingPresets> {
  const stored = (await get('scheduling')) as Partial<SchedulingPresets> | null;
  return { ...DEFAULT_SCHEDULING, ...(stored ?? {}) };
}
