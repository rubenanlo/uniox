import { useSyncExternalStore } from 'react';

/** One shared observer on <html class="dark">; N consumers, not N observers. */
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  observer ??= (() => {
    const o = new MutationObserver(() => listeners.forEach((l) => l()));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return o;
  })();
  return () => {
    listeners.delete(cb);
    if (!listeners.size) {
      observer?.disconnect();
      observer = null;
    }
  };
}

const isDark = () => document.documentElement.classList.contains('dark');

export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, isDark);
}
