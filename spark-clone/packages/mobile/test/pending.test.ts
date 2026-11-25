import { describe, expect, it } from 'vitest';
import type { MobileThread } from '../src/data/types';
import { PendingActions, withThread, without } from '../src/lib/pending';

const t = (id: string, lastMessageAt: number) => ({ id, lastMessageAt }) as MobileThread;

describe('pending thread actions', () => {
  it('keeps a still-running archive applied when a racing refresh returns it', () => {
    const p = new PendingActions();
    const server = [t('a', 3), t('b', 2), t('c', 1)];
    const a = p.begin('a', without('a'));
    const b = p.begin('b', without('b'));

    // A's write lands; its realtime change refetches while B is in flight.
    p.settle(a, 100);
    const started = 150;
    const fetched = [t('b', 2), t('c', 1)]; // server: A gone, B not yet
    expect(p.applyTo(fetched).map((x) => x.id)).toEqual(['c']);
    p.prune(started);
    expect(p.size).toBe(1); // A reflected, B still pending

    // B lands; the next refresh started after it, so B is forgotten.
    p.settle(b, 200);
    expect(p.applyTo([t('c', 1)]).map((x) => x.id)).toEqual(['c']);
    p.prune(250);
    expect(p.size).toBe(0);
    expect(server).toHaveLength(3);
  });

  it('does not drop an entry on a refresh that started before the write finished', () => {
    const p = new PendingActions();
    const a = p.begin('a', without('a'));
    p.settle(a, 200);
    p.prune(150); // this fetch began before the server had the change
    expect(p.applyTo([t('a', 1)])).toEqual([]);
  });

  it('lets the newest action on a thread win (archive then undo)', () => {
    const p = new PendingActions();
    p.begin('a', without('a'));
    p.begin('a', withThread(t('a', 5)));
    expect(p.applyTo([t('b', 9), t('c', 1)]).map((x) => x.id)).toEqual(['b', 'a', 'c']);
    expect(p.size).toBe(1);
  });
});
