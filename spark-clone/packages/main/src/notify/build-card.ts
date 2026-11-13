import type { Category, NotifyContext, NotifyPayload } from '@app/shared';
import type { CardAction, CardTone, NotifyCard } from './card';

/**
 * How long any card stays: about a second fully on screen after its ~0.3 s
 * slide-in. Hovering pauses it (and a card lingers 2.5 s after the pointer leaves).
 */
export const NOTIFY_TTL_MS = 1_300;
/** The heads-up window (matches the sync side's LEAD_MS): the countdown bar drains over it. */
export const EVENT_LEAD_MS = 10 * 60_000;

const CATEGORY_CHIPS: Record<Category, { chip: string; tone: CardTone }> = {
  personal: { chip: 'People', tone: 'people' },
  invites: { chip: 'Invite', tone: 'people' },
  notifications: { chip: 'Notification', tone: 'quiet' },
  newsletters: { chip: 'Newsletter', tone: 'quiet' },
  promotions: { chip: 'Promotion', tone: 'quiet' },
};

function hhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function mailChip(p: NotifyPayload): { chip: string; tone: CardTone } {
  if (p.priority) return { chip: 'Priority', tone: 'priority' };
  if (p.reason === 'reminder') return { chip: 'Reminder', tone: 'people' };
  if (p.reason === 'snoozed') return { chip: 'Snoozed', tone: 'people' };
  return (p.mailCategory && CATEGORY_CHIPS[p.mailCategory]) || { chip: 'Mail', tone: 'quiet' };
}

export function buildCard(id: string, p: NotifyPayload, ctx: NotifyContext | null, now: number): NotifyCard {
  if (p.category === 'event') {
    const start = p.startMs ?? now;
    return {
      id,
      key: `event:${start}:${p.title}`,
      kind: 'event',
      title: p.title,
      chip: 'Meeting',
      tone: 'meeting',
      source: 'Calendar',
      when: hhmm(start),
      startsAt: start,
      where: p.location || (p.meetingUrl ? 'Video call' : undefined),
      leadMs: EVENT_LEAD_MS,
      actions: p.meetingUrl ? ['snooze', 'join'] : ['snooze'],
      ttl: NOTIFY_TTL_MS,
    };
  }

  const account = p.accountId ? ctx?.accounts.find((a) => a.id === p.accountId) : undefined;
  const actions: CardAction[] = [];
  if (p.threadId) actions.push('open', 'reply');
  if (p.threadId && p.accountId) actions.push('archive', 'later');
  return {
    id,
    key: `mail:${p.threadId ?? id}`,
    kind: 'mail',
    title: p.title,
    line: p.body,
    snippet: p.snippet?.trim() || undefined,
    ...mailChip(p),
    source: account?.label ?? '',
    when: 'now',
    actions,
    ttl: NOTIFY_TTL_MS,
  };
}
