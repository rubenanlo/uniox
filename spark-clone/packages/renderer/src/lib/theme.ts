import { useEffect } from 'react';
import { useUi } from '../state/store';
import { softTint } from './utils';

/** Follow the theme preference (and the system appearance under "system"). */
export function useTheme() {
  const theme = useUi((s) => s.theme);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
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
