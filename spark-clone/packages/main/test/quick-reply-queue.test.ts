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

  it('keeps kept emails past the day and the size cap', () => {
    let now = 0;
    const q = new QuickReplyQueue(() => now);
    const a = q.record(mail('kept'));
    expect(q.keep(a.id, true)).toBe(true);
    now = QUEUE_MAX_AGE_MS + 1;
    for (let i = 0; i < QUEUE_MAX + 5; i++) q.record(mail(`t${i}`));
    expect(q.list().some((i) => i.threadId === 'kept')).toBe(true);
    expect(q.kept().map((i) => i.threadId)).toEqual(['kept']);
    q.keep(a.id, false);
    expect(q.list().some((i) => i.threadId === 'kept')).toBe(false);
  });

  it('stays kept when a newer notification for the thread arrives', () => {
    const q = new QuickReplyQueue();
    q.keep(q.record(mail('t1', 'Old')).id, true);
    const fresh = q.record(mail('t1', 'New'));
    expect(fresh.kept).toBe(true);
    expect(q.list()).toHaveLength(1);
  });

  it('drops the unread origin once the thread really notifies', () => {
    const q = new QuickReplyQueue();
    expect(q.record({ ...mail('t1'), origin: 'unread' }).origin).toBe('unread');
    expect(q.record(mail('t1')).origin).toBeUndefined();
  });

  it('restores saved kept emails, newest first, skipping threads already listed', () => {
    const q = new QuickReplyQueue(() => 5000);
    q.record(mail('t1'));
    q.restore([
      { ...mail('t1'), id: 'x', at: 1 },
      { ...mail('t2'), id: 'y', at: 3000 },
      { ...mail('t3'), id: 'z', at: 4000 },
    ]);
    expect(q.list().map((i) => [i.threadId, !!i.kept])).toEqual([
      ['t1', false],
      ['t3', true],
      ['t2', true],
    ]);
  });
});
