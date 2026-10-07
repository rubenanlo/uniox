import { api } from '../lib/api';
import { useUi } from './store';

/**
 * Priority senders live in the sync DB (and, for Gmail accounts, as the
 * Uniox/Priority label server-side) so every client shares one list. The UI
 * store's `priorityEmails` is just the runtime cache of that list.
 */

/** Pull the DB-backed list into the UI store (union across accounts). */
export async function loadPrioritySenders(): Promise<void> {
  const rows = await api.query('priority:list', undefined);
  const emails = [...new Set(rows.map((r) => r.email))].sort();
  const current = useUi.getState().priorityEmails;
  if (emails.length !== current.length || emails.some((e, i) => e !== current[i])) {
    useUi.getState().setPriorityEmails(emails);
  }
}

/** Add/remove a sender everywhere: optimistic UI + one durable task per account. */
export async function mutatePrioritySender(email: string, priority: boolean): Promise<void> {
  const key = email.trim().toLowerCase();
  if (!key) return;
  const { priorityEmails, setPriorityEmails } = useUi.getState();
  setPriorityEmails(
    priority ? [...new Set([...priorityEmails, key])].sort() : priorityEmails.filter((e) => e !== key),
  );
  const accounts = await api.query('accounts:list', undefined);
  for (const a of accounts) {
    void api.command('task:enqueue', { type: 'set-priority-sender', accountId: a.id, email: key, priority });
  }
}

/** Re-pull the list when sync deltas land (read-back from another client). */
let wired = false;
export function wirePriorityDeltaRefresh(): void {
  if (wired) return;
  wired = true;
  let timer: number | undefined;
  api.onDelta((e) => {
    if (e.kind !== 'threads-changed' && e.kind !== 'accounts-changed') return;
    clearTimeout(timer);
    timer = window.setTimeout(() => void loadPrioritySenders(), 500);
  });
}

/**
 * One-time migration: priority senders used to live in the ui-prefs blob.
 * When the DB list is empty and the legacy blob has entries, replay them as
 * tasks; the blob field is no longer persisted, so this cannot loop.
 */
export async function seedLegacyPriorityEmails(legacy: string[] | undefined): Promise<void> {
  if (!legacy?.length) return;
  const rows = await api.query('priority:list', undefined);
  if (rows.length > 0) return;
  for (const email of legacy) await mutatePrioritySender(email, true);
}
