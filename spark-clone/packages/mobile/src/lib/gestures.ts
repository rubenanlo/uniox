import { type RefObject, useEffect, useRef, useState } from 'react';

const EDGE = 28;
const BACK_GO = 90;
const PULL_GO = 72;

/**
 * Inbox gestures that replace the top bar buttons:
 * - swipe in from the left edge to go back (the page follows the finger);
 * - pull down at the top of the list to refresh.
 * Touch only; both stay out of the way of normal scrolling and row swipes.
 */
export function useEdgeBackAndPull(
  ref: RefObject<HTMLElement | null>,
  onBack: () => void,
  onRefresh: () => Promise<unknown>,
): { pull: number; refreshing: boolean } {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const cb = useRef({ onBack, onRefresh });
  cb.current = { onBack, onRefresh };
  const busy = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let g: {
      x: number;
      y: number;
      mode: 'back' | 'pull' | null;
      edge: boolean;
      d: number;
    } | null = null;
    const page = () => el.closest<HTMLElement>('.ib-page') ?? el;
    const start = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || e.touches.length > 1) return;
      g = {
        x: t.clientX,
        y: t.clientY,
        mode: null,
        edge: t.clientX <= EDGE,
        d: 0,
      };
    };
    const move = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!g || !t) return;
      const dx = t.clientX - g.x;
      const dy = t.clientY - g.y;
      if (!g.mode) {
        if (Math.hypot(dx, dy) < 10) return;
        if (g.edge && dx > Math.abs(dy)) g.mode = 'back';
        else if (dy > Math.abs(dx) && el.scrollTop <= 0 && !busy.current) g.mode = 'pull';
        else {
          g = null;
          return;
        }
      }
      if (g.mode === 'back') {
        e.preventDefault();
        g.d = Math.max(0, dx);
        const p = page();
        p.style.transition = 'none';
        p.style.transform = `translateX(${g.d}px)`;
      } else {
        g.d = Math.max(0, dy);
        setPull(Math.min(80, g.d * 0.5));
      }
    };
    const end = () => {
      if (!g) return;
      const { mode, d } = g;
      g = null;
      if (mode === 'back') {
        const p = page();
        p.style.transition = 'transform .32s cubic-bezier(.22,1,.36,1)';
        if (d >= BACK_GO) {
          p.style.transform = 'translateX(100%)';
          setTimeout(() => cb.current.onBack(), 200);
        } else p.style.transform = '';
      } else if (mode === 'pull') {
        if (d >= PULL_GO) {
          busy.current = true;
          setRefreshing(true);
          setPull(44);
          void cb.current.onRefresh().finally(() => {
            busy.current = false;
            setRefreshing(false);
            setPull(0);
          });
        } else setPull(0);
      }
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
  }, [ref]);

  return { pull, refreshing };
}
