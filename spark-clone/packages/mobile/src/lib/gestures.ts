import { type RefObject, useEffect, useRef, useState } from 'react';
import { back } from './router';

const EDGE = 28;
const BACK_GO = 90;
const PULL_GO = 72;

/**
 * Pull down at the top of a list to refresh. Touch only; stays out of the way
 * of normal scrolling and row swipes. (Going back is app-wide: useEdgeBack.)
 */
export function usePullRefresh(
  ref: RefObject<HTMLElement | null>,
  onRefresh: () => Promise<unknown>,
): { pull: number; refreshing: boolean } {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const cb = useRef(onRefresh);
  useEffect(() => {
    cb.current = onRefresh;
  });
  const busy = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let g: { x: number; y: number; on: boolean; d: number } | null = null;
    const start = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || e.touches.length > 1 || t.clientX <= EDGE) return;
      g = { x: t.clientX, y: t.clientY, on: false, d: 0 };
    };
    const move = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!g || !t) return;
      const dx = t.clientX - g.x;
      const dy = t.clientY - g.y;
      if (!g.on) {
        if (Math.hypot(dx, dy) < 10) return;
        if (dy > Math.abs(dx) && el.scrollTop <= 0 && !busy.current) g.on = true;
        else {
          g = null;
          return;
        }
      }
      g.d = Math.max(0, dy);
      setPull(Math.min(80, g.d * 0.5));
    };
    const end = () => {
      if (!g) return;
      const { on, d } = g;
      g = null;
      if (!on) return;
      if (d >= PULL_GO) {
        busy.current = true;
        setRefreshing(true);
        setPull(44);
        void cb.current().finally(() => {
          busy.current = false;
          setRefreshing(false);
          setPull(0);
        });
      } else setPull(0);
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [ref]);

  return { pull, refreshing };
}

/**
 * Swipe in from the left edge to go back one step, to the screen you came
 * from (a thread goes back to the Inbox, Search, Home or the notification list
 * it was opened from). The page follows the finger. Works on every screen
 * except the ones in `off`; `fallback(at)` names where to land when there is
 * no earlier screen, such as a cold start straight into a thread.
 */
export function useEdgeBack(
  off: (at: string) => boolean,
  fallback: (at: string) => string,
): void {
  const cb = useRef({ off, fallback });
  useEffect(() => {
    cb.current = { off, fallback };
  });

  useEffect(() => {
    const el = window;
    const screen = () => location.hash.replace(/^#\/?/, '').split('?')[0] ?? '';
    let g: { x: number; y: number; on: boolean; d: number } | null = null;
    // The screen's own root: what slides away under the finger.
    const page = () => document.querySelector<HTMLElement>('.app > *');
    const start = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || e.touches.length > 1 || t.clientX > EDGE) return;
      if (cb.current.off(screen().split('/')[0] ?? '')) return;
      g = { x: t.clientX, y: t.clientY, on: false, d: 0 };
    };
    const move = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!g || !t) return;
      const dx = t.clientX - g.x;
      const dy = t.clientY - g.y;
      if (!g.on) {
        if (Math.hypot(dx, dy) < 10) return;
        if (dx > Math.abs(dy)) g.on = true;
        else {
          g = null;
          return;
        }
      }
      e.preventDefault();
      g.d = Math.max(0, dx);
      const p = page();
      if (p) {
        p.style.transition = 'none';
        p.style.transform = `translateX(${g.d}px)`;
      }
    };
    const end = () => {
      if (!g) return;
      const { on, d } = g;
      g = null;
      if (!on) return;
      const p = page();
      if (p) p.style.transition = 'transform .32s cubic-bezier(.22,1,.36,1)';
      if (d < BACK_GO) {
        if (p) p.style.transform = '';
        return;
      }
      if (p) p.style.transform = 'translateX(100%)';
      const at = screen();
      setTimeout(() => {
        back(cb.current.fallback(at));
        // The screen we land on can reuse the same element (Settings pages,
        // a calendar sheet): never leave it pushed off to the side.
        setTimeout(() => {
          if (p) {
            p.style.transition = '';
            p.style.transform = '';
          }
        }, 60);
      }, 200);
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, []);
}
