import { describe, expect, it } from 'vitest';
import { MailDb } from '@app/db';
import type { Account } from '@app/shared';
import { Scheduler, type SchedulerFire } from '../src/scheduler';
import { categorize } from '../src/categorize';

function setup(): MailDb {
  const db = new MailDb(':memory:');
  const account: Account = {
    id: 'acc1',
    email: 'a@x',
    displayName: 'A',
    authType: 'password',
    imap: { host: 'x', port: 1, secure: false },
    smtp: { host: 'x', port: 1, secure: false },
  };
  db.insertAccount(account);
  db.createThread('t1', 'acc1', 'Hello');
  return db;
}

describe('scheduler', () => {
  it('fires due snoozes/reminders/sends exactly once (rows consumed)', () => {
    const db = setup();
    db.upsertSnooze('t1', Date.now() - 1000, true);
    db.upsertReminder('t1', Date.now() - 1000);
    db.insertScheduledSend({
      id: 'ss1',
      accountId: 'acc1',
      sendAt: Date.now() - 1000,
      rawMime: 'raw',
      draft: { accountId: 'acc1', to: [], cc: [], bcc: [], subject: 's', html: '', text: '', attachments: [] },
    });

    const fires: SchedulerFire[] = [];
    const scheduler = new Scheduler(db, (f) => fires.push(f));
    scheduler.fireDue();
    scheduler.stop();

    expect(fires.map((f) => f.kind).sort()).toEqual(['reminder', 'send', 'snooze']);
    const snoozeFire = fires.find((f) => f.kind === 'snooze');
    expect(snoozeFire).toMatchObject({ threadId: 't1', accountId: 'acc1', alert: true });

    // consumed: firing again does nothing
    const before = fires.length;
    scheduler.fireDue();
    scheduler.stop();
    expect(fires.length).toBe(before);
    expect(db.getSnooze('t1')).toBeNull();
    expect(db.getScheduledSend('ss1')?.status).toBe('sending');
  });

  it('"Someday" snoozes (null wake) never fire', () => {
    const db = setup();
    db.upsertSnooze('t1', null, false);
    const fires: SchedulerFire[] = [];
    const scheduler = new Scheduler(db, (f) => fires.push(f));
    scheduler.fireDue();
    scheduler.stop();
    expect(fires).toEqual([]);
    expect(db.getSnooze('t1')).not.toBeNull();
  });

  it('launch catch-up marks stale pending sends overdue', () => {
    const db = setup();
    db.insertScheduledSend({
      id: 'old',
      accountId: 'acc1',
      sendAt: Date.now() - 3_600_000,
      rawMime: 'raw',
      draft: { accountId: 'acc1', to: [], cc: [], bcc: [], subject: 's', html: '', text: '', attachments: [] },
    });
    expect(db.markOverdueScheduledSends()).toBe(1);
    expect(db.listScheduledSends()[0]!.status).toBe('overdue');
  });
});

describe('categorizer rules', () => {
  const base = {
    headers: new Map<string, string>(),
    fromAddress: 'x@y.example',
    subject: 'Weekly digest',
    hasCalendar: false,
    threadHasOurReply: false,
  };

  it.each([
    ['list-unsubscribe header', new Map([['list-unsubscribe', '<mailto:u@x>']]), 'newsletters'],
    ['list-id header', new Map([['list-id', 'dev.lists.example']]), 'newsletters'],
    ['auto-submitted', new Map([['auto-submitted', 'auto-generated']]), 'notifications'],
    ['precedence bulk', new Map([['precedence', 'bulk']]), 'notifications'],
    ['plain human mail', new Map<string, string>(), 'personal'],
  ])('%s → %s', (_label, headers, expected) => {
    expect(categorize({ ...base, headers })).toBe(expected);
  });

  it('no-reply senders are notifications', () => {
    expect(categorize({ ...base, fromAddress: 'no-reply@service.example' })).toBe('notifications');
    expect(categorize({ ...base, fromAddress: 'noreply@service.example' })).toBe('notifications');
  });

  it('participation always wins (a list we reply on is a conversation)', () => {
    expect(
      categorize({
        ...base,
        headers: new Map([['list-id', 'x']]),
        fromAddress: 'no-reply@x.example',
        threadHasOurReply: true,
      }),
    ).toBe('personal');
  });

  it('calendar parts are invites, beating every other rule', () => {
    expect(
      categorize({
        ...base,
        hasCalendar: true,
        headers: new Map([['list-unsubscribe', '<mailto:u@x>']]),
        fromAddress: 'no-reply@calendar.example',
      }),
    ).toBe('invites');
  });

  it('a known correspondent is personal even with bulk headers (Google Groups mail)', () => {
    expect(
      categorize({
        ...base,
        headers: new Map([['list-unsubscribe', '<mailto:u@x>']]),
        knownCorrespondent: true,
      }),
    ).toBe('personal');
  });

  it('a same-org colleague is personal, but org noreply senders are not', () => {
    const bulk = new Map([['list-id', 'team.example']]);
    expect(categorize({ ...base, headers: bulk, sameOrgSender: true })).toBe('personal');
    expect(
      categorize({
        ...base,
        headers: new Map<string, string>(),
        fromAddress: 'noreply@y.example',
        sameOrgSender: true,
      }),
    ).toBe('notifications');
  });

  it('list headers with a visible handful of recipients read as a discussion, not bulk', () => {
    const bulk = new Map([['list-id', 'team.example']]);
    expect(categorize({ ...base, headers: bulk, recipientCount: 4 })).toBe('personal');
    // broadcast to you alone, or to a huge visible list, stays bulk
    expect(categorize({ ...base, headers: bulk, recipientCount: 1 })).toBe('newsletters');
    expect(categorize({ ...base, headers: bulk, recipientCount: 40 })).toBe('newsletters');
  });

  it('bulk mail with marketing language or sender is promotions, not newsletters', () => {
    const bulk = new Map([['list-unsubscribe', '<https://x/unsub>']]);
    expect(categorize({ ...base, headers: bulk, subject: 'Flash sale: 30% off everything' })).toBe('promotions');
    expect(categorize({ ...base, headers: bulk, fromAddress: 'promo@deals.example' })).toBe('promotions');
    expect(categorize({ ...base, headers: bulk, subject: 'Engineering digest #42' })).toBe('newsletters');
  });
});
