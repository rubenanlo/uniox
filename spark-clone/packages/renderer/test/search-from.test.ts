import { describe, expect, it } from 'vitest';
import type { ThreadSummary } from '@app/shared';
import { withSearchFrom } from '../src/lib/utils';

function thread(over: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    id: 't1',
    accountId: 'acc1',
    subject: 'Pause on closing consultation',
    participants: [
      { name: 'Tara Everton', email: 'tara.everton@unsdsn.org' },
      { name: 'Grayson Fuller', email: 'grayson.fuller@unsdsn.org' },
    ],
    lastMessageDate: 1000,
    snippet: '',
    messageCount: 3,
    unreadCount: 0,
    hasAttachments: false,
    hasDraft: false,
    fromEmails: ['tara.everton@unsdsn.org', 'grayson.fuller@unsdsn.org'],
    pinned: false,
    category: 'personal',
    ...over,
  };
}

describe('withSearchFrom', () => {
  it('labels the thread with the sender the search asked for', () => {
    const t = withSearchFrom(thread(), ['grayson']);
    expect(t.participants[0]!.email).toBe('grayson.fuller@unsdsn.org');
  });

  it('matches on display name as well as address', () => {
    const t = withSearchFrom(thread(), ['everton']);
    expect(t.participants[0]!.email).toBe('tara.everton@unsdsn.org');
  });

  it('leaves the thread alone when nothing matches', () => {
    const t = thread();
    expect(withSearchFrom(t, ['nobody'])).toBe(t);
  });

  it('leaves the thread alone when there are no from: terms', () => {
    const t = thread();
    expect(withSearchFrom(t, [])).toBe(t);
  });

  it('surfaces a matching sender that is not among the shown participants', () => {
    const t = withSearchFrom(
      thread({ participants: [{ name: 'Tara Everton', email: 'tara.everton@unsdsn.org' }] }),
      ['grayson'],
    );
    expect(t.participants[0]!.email).toBe('grayson.fuller@unsdsn.org');
  });
});
