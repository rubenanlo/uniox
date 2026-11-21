import type { Address } from '@app/shared';

const AVATAR_COLORS = [
  '#d0679a',
  '#d4386c',
  '#2db682',
  '#e0883a',
  '#4a6ee0',
  '#8a5cd6',
  '#3a8f8f',
  '#de6a3d',
  '#c9a12e',
  '#5a6170',
];

export function initials(a: Address | null | undefined): string {
  const src = (a?.name || a?.email || '?').replace(/["']/g, '').trim();
  const parts = src.split(/[\s.@_-]+/).filter(Boolean);
  const two = parts.length >= 2 ? `${parts[0]![0]}${parts[1]![0]}` : src.slice(0, 2);
  return two.toUpperCase();
}

export function avatarColor(a: Address | null | undefined): string {
  const key = a?.email ?? a?.name ?? '?';
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

export const displayName = (a: Address | null | undefined) => a?.name || a?.email || 'Unknown';
export const firstName = (a: Address | null | undefined) => displayName(a).split(/[\s@]/)[0] ?? '';

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** List timestamps: 4:34 PM today, Yesterday, Nov 12 otherwise. */
export function listTime(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const n = new Date(now);
  if (sameDay(d, n)) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const y = new Date(now - 86_400_000);
  if (sameDay(d, y)) return 'Yesterday';
  return d.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== n.getFullYear() ? { year: 'numeric' } : {}),
  });
}

export const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
export const clock12 = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function dayLabel(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const n = new Date(now);
  if (sameDay(d, n)) return 'Today';
  if (sameDay(d, new Date(now - 86_400_000))) return 'Yesterday';
  if (sameDay(d, new Date(now + 86_400_000))) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'long' });
}

export const startOfDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** Monday of the week containing ms. */
export function startOfWeek(ms: number): number {
  const d = new Date(startOfDay(ms));
  const dow = (d.getDay() + 6) % 7;
  return addDays(d.getTime(), -dow);
}

export const fullDate = (ms: number) =>
  new Date(ms).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
export const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

export function timeRange(start: number, end: number): string {
  return `${clock12(start)} – ${clock12(end)}`;
}

/** Plain text quote-trimming for chat bubbles: drops "On … wrote:" history and signatures. */
export function chatText(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .+wrote:\s*$/.test(line) || /^-{2,}\s*Original Message/i.test(line) || /^>/.test(line))
      break;
    if (/^Le .+a écrit\s*:/.test(line) || /^El .+escribió:/.test(line)) break;
    out.push(line);
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Greeting by local hour. */
export function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 5
    ? 'Good night'
    : h < 12
      ? 'Good morning'
      : h < 18
        ? 'Good afternoon'
        : 'Good evening';
}

/** Share of the 9:00–18:00 workday that has passed (0–100). */
export function workdayPercent(now = new Date()): number {
  const mins = now.getHours() * 60 + now.getMinutes();
  return Math.max(0, Math.min(100, Math.round(((mins - 540) / 540) * 100)));
}
