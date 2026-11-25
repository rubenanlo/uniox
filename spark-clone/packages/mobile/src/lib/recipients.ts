import type { Address } from '@app/shared';
import type { MobileMessage } from '../data/types';

export type Role = 'from' | 'to' | 'cc';

export interface CastMember {
  addr: Address;
  me: boolean;
  /** Where this person sits on the newest message; null when they dropped off. */
  role: Role | null;
}

const key = (a: Address) => a.email.trim().toLowerCase();

/** Every address that is the user: the account's own plus any sender of a sent copy. */
export function myEmails(messages: MobileMessage[], accountEmail?: string): Set<string> {
  const s = new Set<string>();
  if (accountEmail) s.add(accountEmail.trim().toLowerCase());
  for (const m of messages) if (m.fromMe && m.from) s.add(key(m.from));
  return s;
}

const people = (m: MobileMessage) => [...(m.from ? [m.from] : []), ...m.to, ...m.cc];

/**
 * Everyone on the thread in order of first appearance, the user last, each
 * with their role on the newest message.
 */
export function threadCast(messages: MobileMessage[], mine: Set<string>): CastMember[] {
  const seen = new Map<string, Address>();
  for (const m of messages)
    for (const a of people(m)) {
      const k = key(a);
      const had = seen.get(k);
      if (!had || (!had.name && a.name)) seen.set(k, had ? { ...had, name: a.name } : a);
    }
  const last = messages[messages.length - 1];
  const roleOf = (k: string): Role | null => {
    if (!last) return null;
    if (last.from && key(last.from) === k) return 'from';
    if (last.to.some((a) => key(a) === k)) return 'to';
    if (last.cc.some((a) => key(a) === k)) return 'cc';
    return null;
  };
  const all = [...seen].map(([k, addr]) => ({
    addr,
    me: mine.has(k),
    role: roleOf(k),
  }));
  return [...all.filter((c) => !c.me), ...all.filter((c) => c.me)];
}

export interface RecipientChange {
  by: Address | null;
  byMe: boolean;
  added: { addr: Address; me: boolean; role: 'to' | 'cc' }[];
  removed: { addr: Address; me: boolean }[];
}

/**
 * Who a reply brought in or left out compared with the message before it.
 * Invites are skipped: their recipient lists follow the calendar, not a reply.
 */
export function recipientChange(
  prev: MobileMessage | undefined,
  m: MobileMessage,
  mine: Set<string>,
): RecipientChange | null {
  if (!prev || prev.invite || m.invite) return null;
  const before = new Set(people(prev).map(key));
  const after = new Set(people(m).map(key));
  const sender = m.from ? key(m.from) : '';
  const added = [...m.to, ...m.cc]
    .filter((a) => !before.has(key(a)) && key(a) !== sender)
    .filter((a, i, xs) => xs.findIndex((b) => key(b) === key(a)) === i)
    .map((a) => ({
      addr: a,
      me: mine.has(key(a)),
      role: m.cc.some((b) => key(b) === key(a)) ? ('cc' as const) : ('to' as const),
    }));
  const removed = people(prev)
    .filter((a) => !after.has(key(a)))
    .filter((a, i, xs) => xs.findIndex((b) => key(b) === key(a)) === i)
    .map((a) => ({ addr: a, me: mine.has(key(a)) }));
  if (!added.length && !removed.length) return null;
  return {
    by: m.from,
    byMe: m.fromMe || (!!m.from && mine.has(sender)),
    added,
    removed,
  };
}

/** "Ana", "Ana and Ben", "Ana, Ben and 2 others". */
export function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} others`;
}

/** Everyone else on the last message, for Reply all: its To and Cc minus the user and the To. */
export function replyAllCc(last: MobileMessage | undefined, to: Address[], mine: Set<string>) {
  if (!last) return [];
  const skip = new Set([...mine, ...to.map(key)]);
  return [...last.to, ...last.cc].filter((a, i, xs) => {
    const k = key(a);
    return !skip.has(k) && xs.findIndex((b) => key(b) === k) === i;
  });
}
