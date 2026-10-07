import { describe, expect, it, vi } from 'vitest';
import type { DeltaEvent } from '@app/shared';
import { DeltaCoalescer } from '../src/delta-coalescer';

const tc = (ids: string[]): DeltaEvent => ({ kind: 'threads-changed', accountIds: ids });

describe('DeltaCoalescer', () => {
  it('emits the first threads-changed immediately, merges the burst into one trailing event', () => {
    vi.useFakeTimers();
    const out: DeltaEvent[] = [];
    const c = new DeltaCoalescer((e) => out.push(e), 250);
    c.push(tc(['a']));
    c.push(tc(['a']));
    c.push(tc(['b']));
    expect(out).toEqual([tc(['a'])]); // leading edge only
    vi.advanceTimersByTime(250);
    expect(out).toEqual([tc(['a']), tc(['a', 'b'])]); // merged trailing
    vi.advanceTimersByTime(1000);
    expect(out.length).toBe(2); // nothing more pending
    vi.useRealTimers();
  });

  it('keeps only the latest sync-status per account', () => {
    vi.useFakeTimers();
    const out: DeltaEvent[] = [];
    const c = new DeltaCoalescer((e) => out.push(e), 250);
    const st = (state: 'syncing' | 'idle'): DeltaEvent => ({
      kind: 'sync-status',
      status: { accountId: 'a', state },
    });
    c.push(st('syncing'));
    c.push(st('idle'));
    vi.advanceTimersByTime(250);
    expect(out).toEqual([st('syncing'), st('idle')]);
    vi.useRealTimers();
  });

  it('passes other kinds through untouched', () => {
    const out: DeltaEvent[] = [];
    const c = new DeltaCoalescer((e) => out.push(e), 250);
    const n: DeltaEvent = { kind: 'notify', title: 't', body: 'b' };
    c.push(n);
    expect(out).toEqual([n]);
  });
});

describe('DeltaCoalescer message-body batching', () => {
  const mb = (messageIds: string[], threadIds: string[]): DeltaEvent => ({
    kind: 'message-body',
    messageIds,
    threadIds,
  });

  it('merges a hydration burst into one trailing event', () => {
    vi.useFakeTimers();
    const out: DeltaEvent[] = [];
    const c = new DeltaCoalescer((e) => out.push(e), 250);
    c.push(mb(['m1'], ['t1']));
    c.push(mb(['m2'], ['t1']));
    c.push(mb(['m3'], ['t2']));
    expect(out).toEqual([mb(['m1'], ['t1'])]); // leading edge only
    vi.advanceTimersByTime(250);
    expect(out).toEqual([mb(['m1'], ['t1']), mb(['m2', 'm3'], ['t1', 't2'])]);
    vi.useRealTimers();
  });
});
