import { useSyncExternalStore } from 'react';

/** A shared clock that ticks every 30 s, so renders stay pure. */
let now = Date.now();
const subs = new Set<() => void>();
setInterval(() => {
  now = Date.now();
  subs.forEach((s) => s());
}, 30_000);

export function useNow(): number {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => now,
  );
}
