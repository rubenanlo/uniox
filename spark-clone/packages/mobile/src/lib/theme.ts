import { useEffect } from 'react';
import type { SharedSettings } from '../data/types';

const DARK_PALETTES = new Set(['midnight', 'ember', 'aubergine']);

/** Applies light/dark, the color theme and the glass transparency to <html>. */
export function useTheme(s: SharedSettings): void {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = s.theme === 'dark' || (s.theme === 'auto' && mq.matches);
      const root = document.documentElement;
      root.classList.toggle('dark', dark);
      const palette = dark ? s.paletteDark : s.palette;
      const fits = palette !== 'default' && DARK_PALETTES.has(palette) === dark;
      if (fits) root.dataset.palette = palette;
      else delete root.dataset.palette;
      // 0% = clear glass, 100% = fully frosted.
      root.style.setProperty('--glass-a', String(0.3 + (s.glassTransparency / 100) * 0.55));
      const bg = getComputedStyle(root).getPropertyValue('--app').trim();
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', bg || (dark ? '#141416' : '#f6f6f4'));
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [s.theme, s.palette, s.paletteDark, s.glassTransparency]);
}
