import { useEffect } from 'react';
import { useUi } from '../state/store';
import { activePalette } from './palettes';
import { softTint } from './utils';

/**
 * Follow the theme preference (and the system appearance under "system"), and
 * mark <html> with the color theme picked for the current mode.
 */
export function useTheme() {
  const theme = useUi((s) => s.theme);
  const darkPalette = useUi((s) => s.darkPalette);
  const lightPalette = useUi((s) => s.lightPalette);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      const root = document.documentElement;
      const palette = activePalette(dark, darkPalette, lightPalette);
      if (palette) root.dataset.palette = palette;
      else delete root.dataset.palette;
      root.classList.toggle('dark', dark);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme, darkPalette, lightPalette]);
}

/**
 * A custom accent overrides --color-accent everywhere (buttons, links, the
 * unread rail) via an inline var, which wins over the theme's stylesheet value.
 * accent-soft is derived so selected-row tints follow along in both themes.
 * Clearing it hands control back to the theme.
 */
export function useAccentColor() {
  const accentColor = useUi((s) => s.accentColor);
  useEffect(() => {
    const root = document.documentElement.style;
    if (accentColor) {
      root.setProperty('--color-accent', accentColor);
      root.setProperty('--color-accent-soft', softTint(accentColor));
    } else {
      root.removeProperty('--color-accent');
      root.removeProperty('--color-accent-soft');
    }
  }, [accentColor]);
}
