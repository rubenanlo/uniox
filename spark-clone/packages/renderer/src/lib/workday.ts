import { DEFAULT_SCHEDULING, type SchedulingPresets } from '@app/shared';
import { useEffect, useState } from 'react';
import { api } from './api';

/** Re-render every 30s — the greeting, marker, and countdown are all
 *  minute-granular, and each tick re-renders the whole Home subtree. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function useScheduling(): SchedulingPresets {
  const [p, setP] = useState<SchedulingPresets>(DEFAULT_SCHEDULING);
  useEffect(() => {
    void api.query('settings:get', { key: 'scheduling' }).then((stored) => {
      if (stored) setP({ ...DEFAULT_SCHEDULING, ...(stored as Partial<SchedulingPresets>) });
    });
  }, []);
  return p;
}

/** Hours (fractional) since midnight. */
export const hourOf = (d: Date) => d.getHours() + d.getMinutes() / 60;
