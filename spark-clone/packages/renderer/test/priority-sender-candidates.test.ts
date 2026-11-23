import { describe, expect, it } from 'vitest';
import type { ThreadSummary } from '@app/shared';
import { prioritySenderCandidates } from '../src/lib/utils';

const ME = new Set(['ruben@example.com']);

function thread(over: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    id: 't1',
    accountId: 'acc1',
    subject: 'Rappel',
    participants: [
      { name: 'Rubén Andino', email: 'ruben@example.com' },
      { name: 'Equipe SAV', email: 'sav@artcrafters.fr' },
    ],
    senders: [
      { name: 'Equipe SAV', email: 'SAV@artcrafters.fr' },
      { name: 'Rubén Andino', email: 'ruben@example.com' },
      { name: 'Tania Martins-Rivas', email: 'contact@artcrafters.fr' },
      { name: 'Equipe SAV', email: 'sav@artcrafters.fr' },
    ],
    lastMessageDate: 0,
    snippet: '',
    messageCount: 4,
    unreadCount: 0,
    hasAttachments: false,
    pinned: false,
    ...over,
  };
}

describe('prioritySenderCandidates', () => {
  it('lists other senders latest first, without you or repeats', () => {
    expect(prioritySenderCandidates(thread(), ME).map((a) => a.email)).toEqual([
      'SAV@artcrafters.fr',
      'contact@artcrafters.fr',
    ]);
  });

  it('falls back to participants on rows without senders', () => {
    expect(prioritySenderCandidates(thread({ senders: undefined }), ME).map((a) => a.email)).toEqual([
      'sav@artcrafters.fr',
    ]);
  });

  it('is empty when only you wrote', () => {
    expect(
      prioritySenderCandidates(thread({ senders: [{ email: 'Ruben@example.com' }] }), ME),
    ).toEqual([]);
  });
});
