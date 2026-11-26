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

/**
 * How many Uniox screens sit behind this one in the browser history. Each
 * entry carries its depth in history.state, so "back" can tell an in-app page
 * from whatever opened the app (a Google sign-in page, a cold start on Home)
 * and never leaves Uniox. history.length can't tell: it also counts entries
 * ahead of us and pages from before the app.
 */
interface UState {
  uniox: number;
}
function depthOf(state: unknown): number | null {
  const d = (state as UState | null)?.uniox;
  return typeof d === 'number' ? d : null;
}
let depth = depthOf(history.state) ?? 0;
if (depthOf(history.state) == null) history.replaceState({ uniox: 0 } satisfies UState, '');

let current = parse();
const subs = new Set<() => void>();
const notify = () => {
  current = parse();
  subs.forEach((s) => s());
};
window.addEventListener('hashchange', () => {
  const d = depthOf(history.state);
  if (d == null) {
    // A plain link or location.hash change: one step further in.
    depth += 1;
    history.replaceState({ uniox: depth } satisfies UState, '');
  } else depth = d;
  notify();
});
window.addEventListener('popstate', () => {
  const d = depthOf(history.state);
  if (d != null) depth = d;
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
  if (location.hash === hash) return;
  if (replace) history.replaceState({ uniox: depth } satisfies UState, '', hash);
  else {
    depth += 1;
    history.pushState({ uniox: depth } satisfies UState, '', hash);
  }
  notify();
}

/** One step back through the screens you came through; `fallback` when there are none. */
export function back(fallback = 'home'): void {
  if (depth > 0) history.back();
  else go(fallback, true);
}
