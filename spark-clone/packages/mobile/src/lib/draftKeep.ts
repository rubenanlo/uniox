import type { Address } from '@app/shared';

/**
 * A composer draft set aside while you look at the Inbox, Calendar or Search
 * from the composer's island. Opening the composer again (same reply, or a
 * plain "Write") brings it back. Kept for the browser session only.
 */
export interface KeptDraft {
  /** The composer's query string when the draft was set aside. */
  query: string;
  accountId: string;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  body: string;
}

const KEY = 'uniox.keptDraft';

export function keepDraft(d: KeptDraft): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // Storage can be unavailable (private mode); the draft is just not kept.
  }
}

/** The kept draft if it belongs to the composer being opened with `query`. */
export function takeKeptDraft(query: string): KeptDraft | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as KeptDraft;
    if (query && query !== d.query) return null;
    return d;
  } catch {
    return null;
  }
}

export function clearKeptDraft(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}
