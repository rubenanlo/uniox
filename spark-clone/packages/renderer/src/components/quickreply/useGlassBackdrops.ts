import type { GlassRect } from '@app/shared';
import { useEffect } from 'react';
import { api } from '../../lib/api';

/** Where each visible glass panel is, in window CSS pixels, with its (clamped) corner radius. */
export function glassRects(root: ParentNode = document): GlassRect[] {
  return [...root.querySelectorAll<HTMLElement>('.qr-glass')]
    .map((el) => {
      const r = el.getBoundingClientRect();
      const radius = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, r.width / 2, r.height / 2);
      return { x: r.left, y: r.top, width: r.width, height: r.height, radius };
    })
    .filter((r) => r.width > 0 && r.height > 0);
}

/**
 * Frosted island: tell main where the glass panels are, so it can put
 * macOS's blur (a vibrancy window) behind each. Panels move while they
 * animate (enter, the list's spring, the AI menu), so a transition, an
 * animation, a resize or a new panel follows them once a frame for a moment;
 * at rest nothing runs. Off (or closing), the blur is cleared.
 */
export function useGlassBackdrops(on: boolean): void {
  useEffect(() => {
    if (!on) {
      void api.command('quick-reply:glass', { rects: [] });
      return;
    }
    let raf = 0;
    let until = 0;
    let last = '';
    const report = () => {
      const rects = glassRects();
      const key = JSON.stringify(rects);
      if (key === last) return;
      last = key;
      void api.command('quick-reply:glass', { rects });
    };
    const follow = (ms = 450) => {
      until = Math.max(until, performance.now() + ms);
      if (raf) return;
      const step = () => {
        report();
        raf = performance.now() < until ? requestAnimationFrame(step) : 0;
      };
      raf = requestAnimationFrame(step);
    };
    const resize = new ResizeObserver(() => follow(120));
    const observe = () => {
      resize.disconnect();
      document.querySelectorAll('.qr-glass').forEach((el) => resize.observe(el));
    };
    const mutations = new MutationObserver(() => {
      observe();
      follow();
    });
    mutations.observe(document.body, { childList: true, subtree: true });
    const onMotion = () => follow();
    document.addEventListener('transitionrun', onMotion, true);
    document.addEventListener('animationstart', onMotion, true);
    window.addEventListener('resize', onMotion);
    observe();
    follow();
    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      mutations.disconnect();
      document.removeEventListener('transitionrun', onMotion, true);
      document.removeEventListener('animationstart', onMotion, true);
      window.removeEventListener('resize', onMotion);
      void api.command('quick-reply:glass', { rects: [] });
    };
  }, [on]);
}
