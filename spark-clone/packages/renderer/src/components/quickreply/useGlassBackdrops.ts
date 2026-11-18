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

/** A rounded rect as an SVG path (clockwise), for cutting holes in the dim. */
function roundedRect({ x, y, width: w, height: h, radius: r }: GlassRect): string {
  return (
    `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}` +
    `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}` +
    `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
  );
}

/**
 * Frosted: dim the screen around the panels but not under them. The dim lives
 * in the island's window, above macOS's blur windows, so a plain full-screen
 * dim would grey the blur too; cutting each panel out keeps the glass clear.
 */
function cutDim(rects: GlassRect[]): void {
  const dim = document.querySelector<HTMLElement>('.qr-dim');
  if (!dim) return;
  const outer = `M0 0H${window.innerWidth}V${window.innerHeight}H0Z`;
  dim.style.clipPath = `path(evenodd, '${outer}${rects.map(roundedRect).join('')}')`;
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
      cutDim(rects);
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
