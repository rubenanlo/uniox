import type { Address, ThreadSummary } from '@app/shared';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { prioritySenderCandidates } from '../lib/utils';
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

/** Our own addresses (every account), lowercased. */
export async function selfEmails(): Promise<Set<string>> {
  const accounts = await api.query('accounts:list', undefined).catch(() => []);
  return new Set(accounts.map((a) => a.email.toLowerCase()));
}

const who = (a: Address) => a.name?.trim() || a.email;

/**
 * Add or remove one sender, with a toast that names them. Adding offers
 * Undo; removing says so plainly (P again, or the bolt, puts them back).
 */
export function togglePrioritySender(a: Address, on: boolean): void {
  void mutatePrioritySender(a.email, on);
  if (on) {
    toast(`${who(a)} is now Priority`, {
      action: { label: 'Undo', onClick: () => void mutatePrioritySender(a.email, false) },
    });
  } else {
    toast(`${who(a)} removed from Priority`);
  }
}

/** P: flip the thread's latest sender (who isn't you) in or out of Priority. */
export async function togglePriorityForThread(t: ThreadSummary): Promise<void> {
  const [latest] = prioritySenderCandidates(t, await selfEmails());
  if (!latest) {
    toast('Only your own mail in this thread');
    return;
  }
  const on = !useUi.getState().priorityEmails.includes(latest.email.toLowerCase());
  togglePrioritySender(latest, on);
}
