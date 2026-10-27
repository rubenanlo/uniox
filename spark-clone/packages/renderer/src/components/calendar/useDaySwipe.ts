import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/** A wheel gap longer than this starts a new gesture (and re-picks its axis). */
const GESTURE_GAP_MS = 160;
/** Quiet time after the last wheel event (momentum included) before snapping. */
const SETTLE_MS = 120;
const SNAP_MS = 220;

interface SwipeState {
  offset: number;
  axis: 'x' | 'y' | null;
  last: number;
  colW: number;
  /** A day shift is waiting on React's commit, which draws the next frame. */
  pending: boolean;
  settleTimer: number;
  raf: number;
  tracks: HTMLElement[];
}

function apply(s: SwipeState) {
  const x = Math.round(s.offset * 100) / 100;
  for (const t of s.tracks) t.style.transform = x ? `translate3d(${x}px,0,0)` : '';
}

/**
 * Horizontal trackpad swipe / shift+wheel over the time grid rolls it by days,
 * Notion Calendar style. The day tracks (`[data-day-track]`, each holding one
 * buffer day either side of the visible range) follow the fingers via a
 * transform written straight to the DOM, so a swipe never re-renders React
 * per wheel event. Each time the offset crosses a whole column `onShift`
 * rolls the range by a day and the offset rebases; when the wheel goes quiet
 * the grid eases onto the nearest column.
 *
 * `rangeKey` must change whenever the rendered days do: the rebased offset is
 * applied in a layout effect on it, the same commit that swaps the columns, so
 * the shift never flashes.
 */
export function useDaySwipe(
  rootRef: RefObject<HTMLElement | null>,
  cols: number,
  rangeKey: number,
  onShift: (days: number) => void,
) {
  const state = useRef<SwipeState>({
    offset: 0,
    axis: null,
    last: 0,
    colW: 0,
    pending: false,
    settleTimer: 0,
    raf: 0,
    tracks: [],
  });
  const onShiftRef = useRef(onShift);
  useLayoutEffect(() => {
    onShiftRef.current = onShift;
  });

  // New columns are in the DOM: pick up the (possibly re-created) tracks and
  // draw the rebased offset before the browser paints.
  useLayoutEffect(() => {
    const s = state.current;
    s.tracks = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-day-track]') ?? []);
    s.pending = false;
    apply(s);
  }, [rangeKey, cols]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const s = state.current;

    const shift = (n: number) => {
      s.pending = true; // the layout effect draws the next frame
      onShiftRef.current(n);
    };
    const draw = () => {
      if (!s.pending) apply(s);
    };
    /** Roll whole columns out of the offset so it stays within one column. */
    const rebase = () => {
      let n = 0;
      while (s.offset <= -s.colW) {
        s.offset += s.colW;
        n++;
      }
      while (s.offset >= s.colW) {
        s.offset -= s.colW;
        n--;
      }
      if (n) shift(n);
      else draw();
    };
    const stopAnim = () => {
      cancelAnimationFrame(s.raf);
      s.raf = 0;
    };
    const settle = () => {
      const target = Math.round(s.offset / s.colW);
      if (target) {
        s.offset -= target * s.colW;
        shift(-target);
      }
      const from = s.offset;
      if (!from) {
        draw();
        return;
      }
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / SNAP_MS);
        s.offset = from * Math.pow(1 - t, 3); // ease-out cubic toward 0
        draw();
        s.raf = t < 1 ? requestAnimationFrame(step) : 0;
      };
      s.raf = requestAnimationFrame(step);
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch-zoom
      let dx = e.deltaX;
      let dy = e.deltaY;
      // A plain mouse wheel scrolls sideways with shift held.
      if (e.shiftKey && !dx) [dx, dy] = [dy, 0];
      const now = performance.now();
      if (now - s.last > GESTURE_GAP_MS) s.axis = null;
      s.last = now;
      if (!s.axis) {
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        // Lock the axis for the whole gesture so a diagonal drift while
        // scrolling the hours never jiggles the days (and vice versa).
        s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }
      if (s.axis !== 'x') return;
      e.preventDefault();
      stopAnim();
      const clip = s.tracks[0]?.parentElement;
      if (!clip) return;
      s.colW = clip.clientWidth / cols;
      if (!s.colW) return;
      if (e.deltaMode === 1) dx *= 16; // lines → px
      s.offset -= dx;
      rebase();
      clearTimeout(s.settleTimer);
      s.settleTimer = window.setTimeout(settle, SETTLE_MS);
    };

    root.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      root.removeEventListener('wheel', onWheel);
      clearTimeout(s.settleTimer);
      stopAnim();
      s.offset = 0;
    };
  }, [rootRef, cols]);
}
