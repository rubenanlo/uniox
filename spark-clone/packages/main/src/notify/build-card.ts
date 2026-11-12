import type { NotifyContext, NotifyPayload } from '@app/shared';
import type { CardAction, NotifyCard } from './card';

/** How long a mail card stays (paused while hovered). */
export const MAIL_TTL_MS = 7_000;
/** A "starting now" meeting card leaves on its own after this; a heads-up stays until then. */
export const EVENT_START_TTL_MS = 5 * 60_000;

const CALENDAR_RED = '#e5484d';
const FALLBACK_COLOR = '#2f63e7';

export function initials(name: string): string {
  const words = name
    .replace(/[<>"()[\]]/g, ' ')
    .split(/[\s@._-]+/)
    .filter((w) => /\p{L}|\p{N}/u.test(w));
  if (!words.length) return '?';
  const first = [...words[0]!][0] ?? '';
  const last = words.length > 1 ? ([...words[words.length - 1]!][0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** A stable avatar hue per sender. */
export function hueFor(key: string): number {
  let h = 0;
  for (const ch of key.toLowerCase()) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h % 360;
}

function hhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function buildCard(id: string, p: NotifyPayload, ctx: NotifyContext | null, now: number): NotifyCard {
  const account = p.accountId ? ctx?.accounts.find((a) => a.id === p.accountId) : undefined;

  if (p.category === 'event') {
    const start = p.startMs ?? now;
    const minutes = Math.round((start - now) / 60_000);
    const upcoming = minutes >= 1;
    const range = p.endMs ? `${hhmm(start)} – ${hhmm(p.endMs)}` : hhmm(start);
    const where = p.location || (p.meetingUrl ? 'Video call' : '');
    const d = new Date(start);
    const actions: CardAction[] = p.meetingUrl ? ['join', 'snooze'] : ['snooze'];
    return {
      id,
      key: `event:${start}:${p.title}`,
      kind: 'event',
      title: p.title,
      line: where ? `${range} · ${where}` : range,
      source: 'Calendar',
      sourceColor: CALENDAR_RED,
      when: upcoming ? `in ${minutes} min` : 'now',
      month: d.toLocaleString('en', { month: 'short' }).toUpperCase(),
      day: String(d.getDate()),
      actions,
      ttl: upcoming ? 0 : EVENT_START_TTL_MS,
    };
  }

  const actions: CardAction[] = [];
  if (p.threadId) actions.push('reply');
  if (p.threadId && p.accountId) actions.push('archive');
  if (p.messageId && p.accountId) actions.push('read');
  if (p.threadId && p.accountId) actions.push('later');
  return {
    id,
    key: `mail:${p.threadId ?? id}`,
    kind: 'mail',
    title: p.title,
    line: p.body,
    snippet: p.snippet?.trim() || undefined,
    source: account?.label ?? 'Mail',
    sourceColor: account?.color ?? FALLBACK_COLOR,
    when: 'now',
    initials: initials(p.title),
    hue: hueFor(p.fromEmail ?? p.title),
    actions,
    ttl: MAIL_TTL_MS,
  };
}
