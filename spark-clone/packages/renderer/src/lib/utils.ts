import type { Address, ThreadSummary } from '@app/shared';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatListDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const days = (now.getTime() - ms) / 86_400_000;
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatFullDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function senderLabel(p: { name?: string; email: string } | null | undefined): string {
  if (!p) return 'Unknown';
  return p.name || p.email.split('@')[0] || p.email;
}

export function initials(label: string): string {
  const parts = label.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const isMac = navigator.platform.toUpperCase().includes('MAC');

/** Spark-style date sections for the mail list. */
export function dateSection(ms: number): string {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ms >= startOfDay) return 'Today';
  if (ms >= startOfDay - 86_400_000) return 'Yesterday';
  const weekday = (now.getDay() + 6) % 7; // Monday = 0
  const weekStart = startOfDay - weekday * 86_400_000;
  if (ms >= weekStart) return 'This Week';
  if (ms >= weekStart - 7 * 86_400_000) return 'Last Week';
  const d = new Date(ms);
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return 'This Month';
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** Fixed hue rotation for account icons, by position in the accounts list. */
export const ACCOUNT_HUES = [212, 158, 22, 282, 340];

/** An account's identity color when it hasn't picked a custom one. */
export function defaultAccountColor(index: number): string {
  return `hsl(${ACCOUNT_HUES[index % ACCOUNT_HUES.length]} 55% 45%)`;
}

/**
 * Curated colors offered in the Settings swatch pickers. Each sits around
 * 45–55% lightness so white label text stays legible on the accent buttons
 * and the dots read clearly on both light and dark rows.
 */
export const COLOR_SWATCHES: { name: string; hex: string }[] = [
  { name: 'Cobalt', hex: '#2f63e7' },
  { name: 'Indigo', hex: '#4f46e5' },
  { name: 'Violet', hex: '#7c3aed' },
  { name: 'Fuchsia', hex: '#c026d3' },
  { name: 'Rose', hex: '#e11d48' },
  { name: 'Amber', hex: '#d97706' },
  { name: 'Emerald', hex: '#059669' },
  { name: 'Teal', hex: '#0d9488' },
  { name: 'Cyan', hex: '#0891b2' },
  { name: 'Slate', hex: '#475569' },
];

/**
 * A tight, well-spread set for the per-account dot: shown after the account's
 * default color, it keeps the whole picker to one line while still covering
 * warm and cool. Anything else is a keystroke away via the custom chip.
 */
export const ACCOUNT_SWATCHES: { name: string; hex: string }[] = [
  { name: 'Violet', hex: '#7c3aed' },
  { name: 'Rose', hex: '#e11d48' },
  { name: 'Amber', hex: '#d97706' },
  { name: 'Teal', hex: '#0d9488' },
];

/** A soft, theme-adaptive tint of an accent for selected-row backgrounds. */
export function softTint(hex: string): string {
  return `color-mix(in srgb, ${hex} 16%, transparent)`;
}

/** Stable avatar hue per sender. */
export function hueOf(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
  return h;
}

/**
 * A thread is priority when ANY of its messages was sent from a priority
 * address (fromEmails aggregates every message's From field; older cached
 * summaries without it fall back to the visible sender).
 */
export function isPriorityThread(t: ThreadSummary, prio: Set<string>): boolean {
  const froms = t.fromEmails?.length ? t.fromEmails : [t.participants[0]?.email ?? ''];
  return froms.some((e) => prio.has(e.toLowerCase()));
}

/**
 * Every priority person who wrote in the thread, most recent first. The row
 * can only name one of them, so the rest surface on hover.
 */
export function priorityPeers(t: ThreadSummary, prio: Set<string>): Address[] {
  // `senders` carries names; older cached rows only have participants.
  const pool: Address[] = t.senders?.length ? t.senders : t.participants;
  const seen = new Set<string>();
  return pool.filter((a) => {
    const email = a.email.toLowerCase();
    if (!prio.has(email) || seen.has(email)) return false;
    seen.add(email);
    return true;
  });
}

/**
 * Label a search hit with the sender the query asked for. A thread normally
 * shows its most recent correspondent, so a `from:grayson` hit on a thread
 * Tara replied to last read as "Tara Everton" and looked like a wrong result.
 * Terms match against address or display name, substring, case-insensitively.
 */
export function withSearchFrom(t: ThreadSummary, fromTerms: string[]): ThreadSummary {
  if (!fromTerms.length) return t;
  const hits = (value: string | undefined) =>
    !!value && fromTerms.some((term) => value.toLowerCase().includes(term));

  const match = t.participants.find((a) => hits(a.email) || hits(a.name));
  if (match) {
    if (t.participants[0] === match) return t;
    return { ...t, participants: [match, ...t.participants.filter((a) => a !== match)] };
  }
  // The sender may sit outside the participants window the list keeps.
  const email = t.fromEmails?.find((e) => hits(e));
  if (!email) return t;
  return { ...t, participants: [{ email }, ...t.participants] };
}

/**
 * Display copy of a priority thread with the priority sender leading
 * `participants`, so list rows show the person who made it priority. Since
 * `fromEmails` is most-recent-first, that is the one who replied last.
 */
export function withPriorityFrom(t: ThreadSummary, prio: Set<string>): ThreadSummary {
  const email = t.fromEmails?.find((e) => prio.has(e.toLowerCase()));
  if (!email) return t;
  const match = t.participants.find((a) => a.email.toLowerCase() === email);
  if (!match) return { ...t, participants: [{ email }, ...t.participants] };
  if (t.participants[0] === match) return t;
  return { ...t, participants: [match, ...t.participants.filter((a) => a !== match)] };
}
