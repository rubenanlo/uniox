import { useMemo } from 'react';
import { useAccounts } from '../state/queries';
import { useUi } from '../state/store';
import { defaultAccountColor } from './utils';

/**
 * Resolve an account's identity color by id: its custom color (Settings →
 * Accounts) or the account's default hue by list position. Used by the unread
 * dot, so the list only needs the thread's accountId.
 */
export function useAccountColor(): (accountId: string) => string {
  const { accounts } = useAccounts();
  const accountColors = useUi((s) => s.accountColors);
  return useMemo(() => {
    const map = new Map<string, string>();
    accounts.forEach((a, i) => map.set(a.id, accountColors[a.id] ?? defaultAccountColor(i)));
    return (accountId: string) => map.get(accountId) ?? 'var(--color-accent)';
  }, [accounts, accountColors]);
}
