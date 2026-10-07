import { describe, expect, it } from 'vitest';
import type { ThreadSummary } from '@app/shared';
import { priorityPeers, withPriorityFrom } from '../src/lib/utils';

const PRIO = new Set(['alyson.marks@unsdsn.org', 'grayson.fuller@unsdsn.org']);

/** Grayson opened the thread; Alyson replied most recently. */
function thread(over: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    id: 't1',
    accountId: 'acc1',
    subject: 'Generative AI for Images',
    participants: [
      { name: 'Tara Everton', email: 'tara.everton@unsdsn.org' },
      { name: 'Alyson Marks', email: 'alyson.marks@unsdsn.org' },
      { name: 'Grayson Fuller', email: 'grayson.fuller@unsdsn.org' },
    ],
    senders: [
      { name: 'Alyson Marks', email: 'alyson.marks@unsdsn.org' },
      { name: 'Tara Everton', email: 'tara.everton@unsdsn.org' },
      { name: 'Grayson Fuller', email: 'grayson.fuller@unsdsn.org' },
    ],
    fromEmails: ['alyson.marks@unsdsn.org', 'tara.everton@unsdsn.org', 'grayson.fuller@unsdsn.org'],
    lastMessageDate: 9000,
    snippet: '',
    messageCount: 4,
    unreadCount: 0,
    hasAttachments: false,
    pinned: false,
    category: 'personal',
    ...over,
  };
}

describe('withPriorityFrom', () => {
  it('names the priority person who replied most recently', () => {
    expect(withPriorityFrom(thread(), PRIO).participants[0]!.email).toBe('alyson.marks@unsdsn.org');
  });
});

describe('priorityPeers', () => {
  it('lists every priority person on the thread, most recent first', () => {
    expect(priorityPeers(thread(), PRIO).map((a) => a.email)).toEqual([
      'alyson.marks@unsdsn.org',
      'grayson.fuller@unsdsn.org',
    ]);
  });

  it('keeps their display names', () => {
    expect(priorityPeers(thread(), PRIO)[0]!.name).toBe('Alyson Marks');
  });

  it('leaves out correspondents who are not priority', () => {
    expect(priorityPeers(thread(), PRIO).some((a) => a.email.includes('tara'))).toBe(false);
  });

  it('returns nothing when no priority sender wrote', () => {
    expect(priorityPeers(thread(), new Set(['nobody@example.com']))).toEqual([]);
  });

  it('falls back to participants when senders is absent', () => {
    const t = thread({ senders: undefined, fromEmails: undefined });
    expect(priorityPeers(t, PRIO).map((a) => a.email)).toEqual([
      'alyson.marks@unsdsn.org',
      'grayson.fuller@unsdsn.org',
    ]);
  });
});
