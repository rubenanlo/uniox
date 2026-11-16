import { describe, expect, it } from 'vitest';
import { QUEUE_MAX, QUEUE_MAX_AGE_MS, QuickReplyQueue } from '../src/quick-reply/queue';

const mail = (threadId: string, title = 'Maya') => ({ title, body: 'Subject', threadId, accountId: 'a1' });

describe('QuickReplyQueue', () => {
  it('keeps notifications newest first', () => {
    const q = new QuickReplyQueue();
    q.record(mail('t1'));
    q.record(mail('t2'));
    expect(q.list().map((i) => i.threadId)).toEqual(['t2', 't1']);
  });

  it('keeps one row per thread, moving it to the top with the newest payload', () => {
    const q = new QuickReplyQueue();
    q.record(mail('t1', 'Old'));
    q.record(mail('t2'));
    q.record(mail('t1', 'New'));
    expect(q.list().map((i) => [i.threadId, i.title])).toEqual([
      ['t1', 'New'],
      ['t2', 'Maya'],
    ]);
  });

  it('dedupes meeting alerts by title and start, not thread', () => {
    const q = new QuickReplyQueue();
    q.record({ title: 'Sync', body: '', category: 'event', startMs: 1 });
    q.record({ title: 'Sync', body: '', category: 'event', startMs: 1 });
    q.record({ title: 'Sync', body: '', category: 'event', startMs: 2 });
    expect(q.list()).toHaveLength(2);
  });

  it('caps the list size and drops notifications older than a day', () => {
    let now = 0;
    const q = new QuickReplyQueue(() => now);
    q.record(mail('old'));
    now = QUEUE_MAX_AGE_MS + 1;
    for (let i = 0; i < QUEUE_MAX + 5; i++) q.record(mail(`t${i}`));
    const list = q.list();
    expect(list).toHaveLength(QUEUE_MAX);
    expect(list.some((i) => i.threadId === 'old')).toBe(false);
  });

  it('finds and dismisses rows', () => {
    const q = new QuickReplyQueue();
    const a = q.record(mail('t1'));
    expect(q.find(mail('t1'))?.id).toBe(a.id);
    expect(q.get(a.id)?.threadId).toBe('t1');
    expect(q.dismiss(a.id)).toBe(true);
    expect(q.dismiss(a.id)).toBe(false);
    expect(q.find(mail('t1'))).toBeNull();
  });
});
