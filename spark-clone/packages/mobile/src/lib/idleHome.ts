import { useEffect } from 'react';
import { go } from './router';

/**
 * Back to Home after ten minutes with no taps, typing or scrolling. A phone
 * suspends the page while Uniox is in the background, so the check also runs
 * when the app comes back to the front: if you were away long enough it opens
 * on Home instead of where you left it.
 *
 * Unsent work is never lost: the composer stays put, and so does any screen
 * with text typed into a box (a thread reply, for instance).
 *
 * Cheap: activity only writes a timestamp; one timeout runs per idle period.
 */
const IDLE_MS = 10 * 60_000;

/** Screens we never leave on our own. */
const STAY = new Set(['home', 'welcome', 'auth', 'compose']);

function hasTypedText(): boolean {
  for (const el of document.querySelectorAll<HTMLTextAreaElement>('textarea'))
    if (el.value.trim()) return true;
  return false;
}

function currentScreen(): string {
  return location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
}

export function useIdleHome(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let last = Date.now();
    let timer: number | undefined;
    const mark = () => {
      last = Date.now();
    };
    const check = () => {
      window.clearTimeout(timer);
      const left = last + IDLE_MS - Date.now();
      if (left > 0) {
        timer = window.setTimeout(check, left);
        return;
      }
      const at = currentScreen();
      if (at && !STAY.has(at) && !hasTypedText()) go('home', true);
      last = Date.now();
      timer = window.setTimeout(check, IDLE_MS);
    };
    // Coming back to the app: decide before the next tap counts as activity.
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    const opts = { passive: true, capture: true } as const;
    const events = ['pointerdown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const;
    events.forEach((e) => window.addEventListener(e, mark, opts));
    document.addEventListener('visibilitychange', onVisible);
    timer = window.setTimeout(check, IDLE_MS);
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, mark, opts));
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);
}
