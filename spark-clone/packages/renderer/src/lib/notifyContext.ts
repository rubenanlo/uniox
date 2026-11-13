import { useEffect } from 'react';
import { useAccounts } from '../state/queries';
import { useUi } from '../state/store';
import { api } from './api';
import { defaultAccountColor } from './utils';

/**
 * Keep main's notification cards in step with the app: each account's colour
 * (custom or default) and label, and the resolved light/dark theme. Sent only
 * when one of those changes.
 */
export function useNotifyContext() {
  const { accounts } = useAccounts();
  const accountColors = useUi((s) => s.accountColors);
  const theme = useUi((s) => s.theme);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const push = () => {
      void api.command('notify:context', {
        dark: theme === 'dark' || (theme === 'system' && mq.matches),
        accounts: accounts.map((a, i) => ({
          id: a.id,
          label: a.email,
          color: accountColors[a.id] ?? defaultAccountColor(i),
        })),
      });
    };
    push();
    mq.addEventListener('change', push);
    return () => mq.removeEventListener('change', push);
  }, [accounts, accountColors, theme]);
}
