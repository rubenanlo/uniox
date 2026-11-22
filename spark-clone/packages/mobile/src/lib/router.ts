import { useSyncExternalStore } from 'react';

/** Tiny hash router: #/inbox, #/thread/<id>, #/calendar?view=week … */
export interface Route {
  path: string[];
  query: URLSearchParams;
}

function parse(): Route {
  const raw = location.hash.replace(/^#\/?/, '');
  const [p = '', q = ''] = raw.split('?');
  return {
    path: p.split('/').filter(Boolean).map(decodeURIComponent),
    query: new URLSearchParams(q),
  };
}

let current = parse();
const subs = new Set<() => void>();
window.addEventListener('hashchange', () => {
  current = parse();
  subs.forEach((s) => s());
});

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => current,
  );
}

export function go(to: string, replace = false): void {
  const hash = `#/${to.replace(/^#?\/?/, '')}`;
  if (replace) {
    history.replaceState(null, '', hash);
    current = parse();
    subs.forEach((s) => s());
  } else location.hash = hash;
}

export function back(fallback = 'home'): void {
  if (history.length > 1) history.back();
  else go(fallback, true);
}
