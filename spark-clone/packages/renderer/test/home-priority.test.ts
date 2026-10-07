import { describe, expect, it } from 'vitest';
import type { ThreadSummary } from '@app/shared';
import { freshPriorityThreads } from '../src/lib/homePriority';

const PRIO = new Set(['alyson.marks@unsdsn.org']);
const BASELINE = 5000;

function thread(over: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    id: 't1',
    accountId: 'acc1',
    subject: 'Migration to Cloudflare',
    participants: [{ name: 'Alyson Marks', email: 'alyson.marks@unsdsn.org' }],
    lastMessageDate: 9000,
    snippet: '',
    messageCount: 3,
    unreadCount: 0,
    hasAttachments: false,
    fromEmails: ['alyson.marks@unsdsn.org'],
    lastInboundDate: 9000,
    lastInboundFrom: { name: 'Alyson Marks', email: 'alyson.marks@unsdsn.org' },
    pinned: false,
    category: 'personal',
    ...over,
  };
}

describe('freshPriorityThreads', () => {
  it('includes priority mail that arrived since the baseline', () => {
    expect(freshPriorityThreads([thread()], PRIO, BASELINE)).toHaveLength(1);
  });

  it('excludes a thread whose only new activity is our own draft', () => {
    // Our draft re-dated the thread, but nothing new actually arrived.
    const t = thread({ lastMessageDate: 9000, lastInboundDate: 1000 });
    expect(freshPriorityThreads([t], PRIO, BASELINE)).toEqual([]);
  });

  it('excludes threads that are only our own mail', () => {
    const t = thread({ lastInboundDate: 0, lastInboundFrom: null });
    expect(freshPriorityThreads([t], PRIO, BASELINE)).toEqual([]);
  });

  it('excludes mail from senders who are not priority', () => {
    const t = thread({ fromEmails: ['someone@else.com'] });
    expect(freshPriorityThreads([t], PRIO, BASELINE)).toEqual([]);
  });

  it('orders by when the message actually arrived, not when we last touched it', () => {
    const older = thread({ id: 'older', lastInboundDate: 6000, lastMessageDate: 99999 });
    const newer = thread({ id: 'newer', lastInboundDate: 8000, lastMessageDate: 8000 });
    expect(freshPriorityThreads([newer, older], PRIO, BASELINE).map((t) => t.id)).toEqual([
      'older',
      'newer',
    ]);
  });

  it('falls back to lastMessageDate for threads predating the inbound column', () => {
    // Rows not yet re-aggregated have no lastInboundDate; they should not vanish.
    const t = thread({ lastInboundDate: undefined, lastInboundFrom: undefined });
    expect(freshPriorityThreads([t], PRIO, BASELINE)).toHaveLength(1);
  });
});
