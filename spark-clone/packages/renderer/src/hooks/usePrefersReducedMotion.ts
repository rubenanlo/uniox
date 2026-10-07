import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(cb: () => void): () => void {
  const mq = window.matchMedia?.(QUERY);
  mq?.addEventListener('change', cb);
  return () => mq?.removeEventListener('change', cb);
}

const read = () => window.matchMedia?.(QUERY).matches ?? false;

/** The OS "reduce motion" setting, live. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
