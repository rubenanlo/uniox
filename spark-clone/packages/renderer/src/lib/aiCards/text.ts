import type { ThreadSummary } from '@app/shared';
import type { ResourceKind, TaskBucket } from './types';

/** Pure helpers for the AI cards (no app state), so they stay unit-testable. */

export const DAY_MS = 86_400_000;

/** Local calendar day key, e.g. 2026-11-18. */
export function dayKey(ms = Date.now()): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function startOfDay(ms = Date.now()): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Pull the JSON object out of a model reply (tolerates a fence, preamble or trailing text). */
export function parseJson<T>(text: string): T {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('The assistant did not return a result.');
  // Walk to the brace that closes the first object, skipping braces inside strings.
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1)) as T;
  }
  throw new Error('The assistant’s answer was cut off. Try again.');
}

/** Plain-text URLs (descriptions and text bodies). */
export function urlsIn(text: string): string[] {
  const found = (text.match(/https?:\/\/[^\s<>"')\]]+/g) ?? []).map((u) =>
    u.replace(/[.,;:!?]+$/, ''),
  );
  return [...new Set(found)];
}

export function personName(a: { name?: string; email?: string } | null | undefined): string {
  return a?.name?.trim() || a?.email || 'Someone';
}

export function firstName(name: string): string {
  return name.includes('@') ? name.split('@')[0]! : (name.split(/\s+/)[0] ?? name);
}

/** "2h", "1d" — how long something has been waiting. */
export function ago(at: number, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - at) / 60_000));
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function clock(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** What kind of resource a link is, or null for links not worth listing. */
export function resourceKind(url: string): ResourceKind | null {
  if (/docs\.google\.com\/document/i.test(url)) return 'doc';
  if (/docs\.google\.com\/spreadsheets/i.test(url)) return 'sheet';
  if (/docs\.google\.com\/presentation/i.test(url)) return 'slides';
  if (/drive\.google\.com|docs\.google\.com/i.test(url)) return 'drive';
  if (/notion\.(so|site)/i.test(url)) return 'notion';
  return null;
}

const RESOURCE_LABEL: Record<ResourceKind, string> = {
  doc: 'Google Doc',
  sheet: 'Google Sheet',
  slides: 'Google Slides',
  drive: 'Google Drive file',
  notion: 'Notion page',
  link: 'Link',
  task: 'Notion task',
};

export function resourceLabel(kind: ResourceKind): string {
  return RESOURCE_LABEL[kind];
}

/** Meaningful words of a title, for matching threads and tasks to a meeting. */
export function keywords(text: string): string[] {
  const STOP = new Set(
    (
      'the and for with from about meeting call sync weekly daily review team catch catchup ' +
      'update invitation updated invite re fwd fw your our this that will into over'
    ).split(' '),
  );
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9\u00c0-\u024f]+/)
        .filter((w) => w.length > 3 && !STOP.has(w) && !/^\d+$/.test(w)),
    ),
  ];
}

export function byNewest(a: ThreadSummary, b: ThreadSummary): number {
  return b.lastMessageDate - a.lastMessageDate;
}

export function bucketOf(due: string | null, today: number): TaskBucket {
  if (!due) return 'none';
  const [y, m, d] = due.slice(0, 10).split('-').map(Number);
  if (!y) return 'none';
  const day = new Date(y, (m ?? 1) - 1, d ?? 1).getTime();
  if (day < today) return 'overdue';
  if (day < today + DAY_MS) return 'today';
  if (day < today + 7 * DAY_MS) return 'week';
  return 'later';
}
