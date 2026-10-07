import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MailDb, type MessageInsert } from '@app/db';
import { MIGRATIONS } from '../src/schema';
import type { Account } from '@app/shared';

function makeDb(): MailDb {
  return new MailDb(':memory:');
}

const account: Account = {
  id: 'acc1',
  email: 'alice@dev.local',
  displayName: 'Alice',
  authType: 'password',
  imap: { host: 'localhost', port: 1143, secure: false },
  smtp: { host: 'localhost', port: 1025, secure: false },
};

function setup(db: MailDb) {
  db.insertAccount(account);
  db.upsertFolder({ id: 'f-inbox', accountId: 'acc1', path: 'INBOX', role: 'inbox', delimiter: '/' });
  db.upsertFolder({ id: 'f-arch', accountId: 'acc1', path: 'Archive', role: 'archive', delimiter: '/' });
}

function msg(over: Partial<MessageInsert>): MessageInsert {
  return {
    id: over.id ?? 'm1',
    accountId: 'acc1',
    threadId: over.threadId ?? 't1',
    folderId: 'f-inbox',
    uid: over.uid ?? 1,
    messageIdHdr: over.messageIdHdr ?? '<m1@x>',
    inReplyTo: null,
    references: [],
    subject: over.subject ?? 'Hello',
    from: { name: 'Carol', email: 'carol@partner.example' },
    to: [{ email: 'alice@dev.local' }],
    cc: [],
    date: over.date ?? 1000,
    snippet: over.snippet ?? 'hi there',
    seen: over.seen ?? false,
    flagged: false,
    answered: false,
    draft: false,
    hasAttachments: false,
    size: 100,
    ...over,
  };
}

describe('migrations', () => {
  it('applies cleanly and is idempotent on reopen', () => {
    const db = makeDb();
    expect(db.raw.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(2);
    expect(db.listAccounts()).toEqual([]);
  });

  it('applies perf pragmas and the folders role index', () => {
    const db = makeDb();
    expect(db.raw.pragma('synchronous', { simple: true })).toBe(1); // NORMAL
    expect(db.raw.pragma('busy_timeout', { simple: true })).toBe(5000);
    const indexes = db.raw.prepare(`PRAGMA index_list('folders')`).all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain('folders_account_role');
  });
});

describe('threads and aggregates', () => {
  it('refreshes counts, snippet, participants from messages', () => {
    const db = makeDb();
    setup(db);
    db.createThread('t1', 'acc1', 'Hello');
    db.insertMessage(msg({ id: 'm1', uid: 1, date: 1000, seen: true }));
    db.insertMessage(msg({ id: 'm2', uid: 2, date: 2000, snippet: 'latest', messageIdHdr: '<m2@x>' }));
    db.refreshThreadAggregates('t1');

    const [t] = db.listThreads({ view: 'inbox', limit: 10, offset: 0 });
    expect(t).toBeDefined();
    expect(t!.messageCount).toBe(2);
    expect(t!.unreadCount).toBe(1);
    expect(t!.snippet).toBe('latest');
    expect(t!.lastMessageDate).toBe(2000);
    expect(t!.participants[0]!.email).toBe('carol@partner.example');
  });

  it('flags threads holding a draft and lists the draft recipient as participant', () => {
    const db = makeDb();
    setup(db);
    db.upsertFolder({ id: 'f-drafts', accountId: 'acc1', path: 'Drafts', role: 'drafts', delimiter: '/' });
    db.createThread('t1', 'acc1', 'Hello');
    db.insertMessage(
      msg({
        id: 'm1',
        folderId: 'f-drafts',
        draft: true,
        from: { name: 'Alice', email: 'alice@dev.local' },
        to: [{ name: 'Aline', email: 'aline@partner.example' }],
      }),
    );
    db.refreshThreadAggregates('t1');

    const [t] = db.listThreads({ view: 'drafts', limit: 10, offset: 0 });
    expect(t).toBeDefined();
    expect(t!.hasDraft).toBe(true);
    // the draft contributes its recipient, not the author ("Draft, Aline")
    expect(t!.participants[0]!.email).toBe('aline@partner.example');

    const [inboxThread] = db.listThreads({ view: 'inbox', limit: 10, offset: 0 });
    expect(inboxThread).toBeUndefined();
  });

  it('dedupes Gmail label copies of one message for display and counts', () => {
    const db = makeDb();
    setup(db);
    // A user label folder that Gmail multi-homes the same message into.
    db.upsertFolder({ id: 'f-label', accountId: 'acc1', path: 'Priority', role: 'other', delimiter: '/' });
    db.createThread('t1', 'acc1', 'Hello');
    // Same Message-ID, two folders (INBOX unread, label copy read), different uid.
    db.insertMessage(msg({ id: 'm-inbox', folderId: 'f-inbox', uid: 10, messageIdHdr: '<dup@x>', seen: false }));
    db.insertMessage(msg({ id: 'm-label', folderId: 'f-label', uid: 20, messageIdHdr: '<dup@x>', seen: true }));
    db.refreshThreadAggregates('t1');

    // Display collapses to one — the canonical INBOX copy.
    const shown = db.getThreadMessagesForDisplay('t1');
    expect(shown).toHaveLength(1);
    expect(shown[0]!.id).toBe('m-inbox');
    // Operational view still sees every folder copy (relocate/flag need them).
    expect(db.getMessagesByThread('t1')).toHaveLength(2);
    // Counts reflect the deduped set, using the canonical (unread) copy.
    const [t] = db.listThreads({ view: 'inbox', limit: 10, offset: 0 });
    expect(t!.messageCount).toBe(1);
    expect(t!.unreadCount).toBe(1);
  });

  it('keeps distinct messages that share no Message-ID', () => {
    const db = makeDb();
    setup(db);
    db.createThread('t1', 'acc1', 'Hello');
    db.insertMessage(msg({ id: 'm1', uid: 1, messageIdHdr: '<a@x>' }));
    db.insertMessage(msg({ id: 'm2', uid: 2, messageIdHdr: '<b@x>', folderId: 'f-arch' }));
    db.refreshThreadAggregates('t1');
    expect(db.getThreadMessagesForDisplay('t1')).toHaveLength(2);
  });

  it('deleteFolder removes its messages and reports affected threads', () => {
    const db = makeDb();
    setup(db);
    db.upsertFolder({ id: 'f-imp', accountId: 'acc1', path: '[Gmail]/Important', role: 'other', delimiter: '/' });
    db.createThread('t1', 'acc1', 'Hello');
    db.insertMessage(msg({ id: 'm-inbox', folderId: 'f-inbox', uid: 1, messageIdHdr: '<dup@x>' }));
    db.insertMessage(msg({ id: 'm-imp', folderId: 'f-imp', uid: 1, messageIdHdr: '<dup@x>' }));

    expect(db.deleteFolder('f-imp')).toEqual(['t1']);
    expect(db.getFolder('f-imp')).toBeNull();
    expect(db.getMessagesByThread('t1').map((m) => m.id)).toEqual(['m-inbox']);
  });

  it('excludes our own address from participants unless we are the only one', () => {
    const db = makeDb();
    setup(db);
    db.createThread('t1', 'acc1', 'Fable request');
    // our sent copy is oldest; the reply comes later
    db.insertMessage(
      msg({ id: 'm1', uid: 1, date: 1000, from: { name: 'Alice', email: 'alice@dev.local' }, messageIdHdr: '<a@x>' }),
    );
    db.insertMessage(
      msg({ id: 'm2', uid: 2, date: 2000, from: { name: 'Rukhsar', email: 'rukhsar@partner.example' }, messageIdHdr: '<b@x>' }),
    );
    db.refreshThreadAggregates('t1');
    const [t] = db.listThreads({ view: 'inbox', limit: 10, offset: 0 });
    expect(t!.participants[0]!.email).toBe('rukhsar@partner.example');
    expect(t!.participants.some((a) => a.email === 'alice@dev.local')).toBe(false);
  });

  it('a sent-only thread shows the recipient, not us', () => {
    const db = makeDb();
    setup(db);
    db.createThread('t1', 'acc1', 'Outreach');
    // we wrote the only message; nobody has replied yet
    db.insertMessage(
      msg({
        id: 'm1',
        uid: 1,
        from: { name: 'Alice', email: 'alice@dev.local' },
        to: [{ name: 'Alyson', email: 'alyson@partner.example' }],
      }),
    );
    db.refreshThreadAggregates('t1');
    const [t] = db.listThreads({ view: 'inbox', limit: 10, offset: 0 });
    expect(t!.participants[0]!.email).toBe('alyson@partner.example');
  });

  it('keeps ourselves as participant for self-sent threads', () => {
    const db = makeDb();
    setup(db);
    db.createThread('t1', 'acc1', 'Note to self');
    db.insertMessage(msg({ id: 'm1', uid: 1, from: { name: 'Alice', email: 'alice@dev.local' } }));
    db.refreshThreadAggregates('t1');
    const [t] = db.listThreads({ view: 'inbox', limit: 10, offset: 0 });
    expect(t!.participants[0]!.email).toBe('alice@dev.local');
  });

  it('deletes the thread when its last message goes away', () => {
    const db = makeDb();
    setup(db);
    db.createThread('t1', 'acc1', 'Hello');
    db.insertMessage(msg({}));
    db.refreshThreadAggregates('t1');
    const threadIds = db.deleteMessagesByUids('f-inbox', [1]);
    expect(threadIds).toEqual(['t1']);
    db.refreshThreadAggregates('t1');
    expect(db.listThreads({ view: 'inbox', limit: 10, offset: 0 })).toEqual([]);
  });

  it('threads by referenced message-id headers', () => {
    const db = makeDb();
    setup(db);
    db.createThread('t1', 'acc1', 'Hello');
    db.insertMessage(msg({}));
    expect(db.findThreadByMessageIds('acc1', ['<m1@x>'])).toBe('t1');
    expect(db.findThreadByMessageIds('acc1', ['<nope@x>'])).toBeNull();
  });
});

describe('views', () => {
  it('inbox view excludes threads whose messages are only in archive', () => {
    const db = makeDb();
    setup(db);
    db.createThread('t1', 'acc1', 'Hello');
    db.insertMessage(msg({ folderId: 'f-arch' }));
    db.refreshThreadAggregates('t1');
    expect(db.listThreads({ view: 'inbox', limit: 10, offset: 0 })).toEqual([]);
    expect(db.listThreads({ view: 'archive', limit: 10, offset: 0 })).toHaveLength(1);
  });
});

describe('FTS', () => {
  it('finds messages by subject and by body text once the body arrives', () => {
    const db = makeDb();
    setup(db);
    db.createThread('t1', 'acc1', 'Quarterly budget review');
    db.insertMessage(msg({ subject: 'Quarterly budget review' }));
    db.refreshThreadAggregates('t1');

    expect(db.searchThreads({ fts: 'budget' })).toHaveLength(1);
    expect(db.searchThreads({ fts: 'zanzibar' })).toHaveLength(0);

    db.upsertBody('m1', null, 'the zanzibar shipment is delayed');
    expect(db.searchThreads({ fts: 'zanzibar' })).toHaveLength(1);
  });

  it('drops the index entry when the message is deleted', () => {
    const db = makeDb();
    setup(db);
    db.createThread('t1', 'acc1', 'Hello');
    db.insertMessage(msg({ subject: 'unicorn festival' }));
    expect(db.searchThreads({ fts: 'unicorn' })).toHaveLength(1);
    db.deleteMessagesByUids('f-inbox', [1]);
    expect(db.searchThreads({ fts: 'unicorn' })).toHaveLength(0);
  });
});

describe('task queue', () => {
  it('enqueues, claims in order, and finishes', () => {
    const db = makeDb();
    const id1 = db.enqueueTask({ type: 'sync-now' });
    const id2 = db.enqueueTask({ type: 'set-seen', accountId: 'acc1', messageIds: ['m1'], seen: true });
    expect(id2).toBeGreaterThan(id1);

    const t1 = db.claimNextTask();
    expect(t1?.id).toBe(id1);
    expect(t1?.status).toBe('running');
    db.finishTask(id1, 'done');

    const t2 = db.claimNextTask();
    expect(t2?.payload.type).toBe('set-seen');
    db.finishTask(id2, 'failed', 'boom');
    expect(db.claimNextTask()).toBeNull();
  });

  it('recovers running tasks after a crash', () => {
    const db = makeDb();
    db.enqueueTask({ type: 'sync-now' });
    db.claimNextTask();
    expect(db.claimNextTask()).toBeNull();
    db.resetRunningTasks();
    expect(db.claimNextTask()).not.toBeNull();
  });
});

describe('folder cursors', () => {
  it('stores and clears sync cursors', () => {
    const db = makeDb();
    setup(db);
    db.setFolderCursor('f-inbox', { uidvalidity: 42, highestmodseq: '99', lastSeenUid: 10 });
    expect(db.getFolderCursor('f-inbox')).toEqual({
      uidvalidity: 42,
      highestmodseq: '99',
      lastSeenUid: 10,
    });
    db.createThread('t1', 'acc1', 'x');
    db.insertMessage(msg({}));
    db.clearFolderMessages('f-inbox');
    expect(db.messageUidsInFolder('f-inbox')).toEqual([]);
    expect(db.getFolderCursor('f-inbox').lastSeenUid).toBe(0);
  });
});

describe('calendar events', () => {
  const gcal = {
    id: 'gcal:acc1:fam',
    accountId: 'acc1',
    remoteId: 'fam@group.calendar.google.com',
    name: 'Family',
    color: '#ffffff',
    visible: true,
    primary: false,
  };
  const gevent = {
    id: 'gev:gcal:acc1:fam:ev1',
    calendarId: 'gcal:acc1:fam',
    remoteId: 'ev1',
    title: 'Antibiotico',
    description: 'take it',
    location: '',
    startMs: 1000,
    endMs: 2000,
    allDay: false,
    eventType: 'default' as const,
  };

  it('round-trips transparency on local events', () => {
    const db = makeDb();
    const id = db.upsertEvent({
      title: 'Focus',
      startMs: 1000,
      endMs: 2000,
      allDay: false,
      transparency: 'transparent',
    });
    expect(db.listEvents(0, 10_000).find((e) => e.id === id)?.transparency).toBe('transparent');
  });

  it('getEventSync exposes source, remote id, and calendar', () => {
    const db = makeDb();
    db.insertAccount(account);
    db.upsertGoogleCalendar(gcal);
    db.upsertGoogleEvent(gevent);
    expect(db.getEventSync(gevent.id)).toEqual({
      source: 'google',
      remoteId: 'ev1',
      calendarId: 'gcal:acc1:fam',
    });
    expect(db.getEventSync('nope')).toBeNull();
  });

  it('patchEvent updates times and only the provided fields, keeping source', () => {
    const db = makeDb();
    db.insertAccount(account);
    db.upsertGoogleCalendar(gcal);
    db.upsertGoogleEvent({ ...gevent, transparency: 'transparent' });
    db.patchEvent(gevent.id, { startMs: 5000, endMs: 6000, allDay: false });
    let e = db.listEvents(0, 10_000).find((x) => x.id === gevent.id)!;
    expect([e.startMs, e.endMs]).toEqual([5000, 6000]);
    expect(e.title).toBe('Antibiotico');
    expect(e.transparency).toBe('transparent'); // untouched when not provided
    expect(e.source).toBe('google');

    db.patchEvent(gevent.id, {
      startMs: 5000,
      endMs: 6000,
      allDay: false,
      title: 'Renamed',
      transparency: 'opaque',
    });
    e = db.listEvents(0, 10_000).find((x) => x.id === gevent.id)!;
    expect(e.title).toBe('Renamed');
    expect(e.transparency).toBeUndefined(); // opaque (busy) is the default
  });

  it('listBusyEvents spans hidden own calendars but skips colleagues and Free events', () => {
    const db = makeDb();
    db.insertAccount(account);
    db.upsertGoogleCalendar({ ...gcal, visible: false });
    db.upsertGoogleEvent(gevent);
    db.upsertGoogleCalendar({ ...gcal, id: 'gcal:acc1:bob', remoteId: 'bob@partner.example' });
    db.upsertGoogleEvent({ ...gevent, id: 'gev:bob', calendarId: 'gcal:acc1:bob' });
    db.upsertGoogleCalendar({ ...gcal, id: 'gcal:acc1:hol', remoteId: 'es.spain#holiday@group.v.calendar.google.com' });
    db.upsertGoogleEvent({ ...gevent, id: 'gev:hol', calendarId: 'gcal:acc1:hol' });
    db.upsertGoogleCalendar({ ...gcal, id: 'gcal:acc1:me', remoteId: 'ALICE@dev.local' });
    db.upsertGoogleEvent({ ...gevent, id: 'gev:me', calendarId: 'gcal:acc1:me' });
    db.upsertGoogleEvent({ ...gevent, id: 'gev:free', remoteId: 'ev2', transparency: 'transparent' });
    db.upsertEvent({ title: 'Local', startMs: 1500, endMs: 2500, allDay: false });
    const ids = db.listBusyEvents(0, 10_000).map((e) => e.id);
    expect(ids).toContain(gevent.id);
    expect(ids).toContain('gev:me');
    expect(ids).not.toContain('gev:bob');
    expect(ids).not.toContain('gev:hol');
    expect(ids).not.toContain('gev:free');
    expect(db.listBusyEvents(0, 10_000).some((e) => e.title === 'Local')).toBe(true);
  });
});

describe('lastSentDisplayName', () => {
  it('returns the newest sent-mail name that is not the bare local part', () => {
    const db = makeDb();
    setup(db);
    db.upsertFolder({ id: 'f-sent', accountId: 'acc1', path: 'Sent', role: 'sent', delimiter: '/' });
    const sent = (id: string, date: number, name: string | undefined) => {
      db.createThread(`t-${id}`, 'acc1', 'Sent mail');
      db.insertMessage(
        msg({
          id,
          threadId: `t-${id}`,
          uid: date,
          messageIdHdr: `<${id}@x>`,
          folderId: 'f-sent',
          date,
          from: { name, email: 'alice@dev.local' },
        }),
      );
    };
    sent('s1', 1000, 'Alice Wonder');
    sent('s2', 2000, 'alice'); // the app's own old bad send: bare local part
    sent('s3', 3000, undefined);
    expect(db.lastSentDisplayName('acc1', 'alice@dev.local')).toBe('Alice Wonder');
  });

  it('returns null when no usable sent name exists', () => {
    const db = makeDb();
    setup(db);
    expect(db.lastSentDisplayName('acc1', 'alice@dev.local')).toBeNull();
  });
});

describe('thread table hygiene', () => {
  it('purges thread rows that have no messages', () => {
    const db = makeDb();
    setup(db);
    db.createThread('t1', 'acc1', 'Hello');
    db.insertMessage(msg({}));
    db.createThread('t-ghost', 'acc1', 'Ghost');

    expect(db.purgeOrphanThreads()).toBe(1);
    expect(db.raw.prepare(`SELECT count(*) AS c FROM threads`).get()).toEqual({ c: 1 });
  });

  it('indexes threads by placement and date so the inbox list avoids a full scan', () => {
    const db = makeDb();
    const indexes = db.raw.prepare(`PRAGMA index_list('threads')`).all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain('threads_placement_date');
  });

  it('has query planner statistics available', () => {
    const db = makeDb();
    setup(db);
    db.createThread('t1', 'acc1', 'Hello');
    db.insertMessage(msg({}));
    db.analyze();
    const stat = db.raw.prepare(`SELECT count(*) AS c FROM sqlite_stat1`).get() as { c: number };
    expect(stat.c).toBeGreaterThan(0);
  });
});

describe('task queue retention', () => {
  it('purges settled tasks past the cutoff and keeps live ones', () => {
    const db = makeDb();
    setup(db);
    const done = db.enqueueTask({ type: 'sync-now', accountId: 'acc1' });
    const failed = db.enqueueTask({ type: 'sync-now', accountId: 'acc1' });
    const pending = db.enqueueTask({ type: 'sync-now', accountId: 'acc1' });
    db.finishTask(done, 'done');
    db.finishTask(failed, 'failed');
    // age the two settled rows past the cutoff
    db.raw.prepare(`UPDATE tasks SET updated_at = 1 WHERE id IN (?, ?)`).run(done, failed);

    expect(db.purgeSettledTasks(Date.now() - 1000)).toBe(2);
    const left = db.raw.prepare(`SELECT id FROM tasks`).all() as { id: number }[];
    expect(left.map((r) => r.id)).toEqual([pending]);
  });

  it('keeps settled tasks that are still inside the retention window', () => {
    const db = makeDb();
    setup(db);
    const id = db.enqueueTask({ type: 'sync-now', accountId: 'acc1' });
    db.finishTask(id, 'done');

    expect(db.purgeSettledTasks(Date.now() - 1000)).toBe(0);
  });
});

describe('prepared statement cache', () => {
  it('prepares a repeated query only once', () => {
    const db = makeDb();
    setup(db);
    db.createThread('t1', 'acc1', 'Hello');
    db.insertMessage(msg({}));
    db.refreshThreadAggregates('t1');
    db.listThreads({ view: 'inbox', limit: 10, offset: 0 });

    const spy = vi.spyOn(db.raw, 'prepare');
    db.listThreads({ view: 'inbox', limit: 10, offset: 0 });
    db.listThreads({ view: 'inbox', limit: 10, offset: 0 });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('still returns correct results from a cached statement', () => {
    const db = makeDb();
    setup(db);
    db.createThread('t1', 'acc1', 'Hello');
    db.insertMessage(msg({}));
    db.refreshThreadAggregates('t1');

    expect(db.listThreads({ view: 'inbox', limit: 10, offset: 0 })).toHaveLength(1);
    db.insertMessage(msg({ id: 'm2', uid: 2, messageIdHdr: '<m2@x>', threadId: 't1' }));
    db.refreshThreadAggregates('t1');
    expect(db.listThreads({ view: 'inbox', limit: 10, offset: 0 })[0]!.messageCount).toBe(2);
  });
});

describe('upgrade from a pre-denormalization database', () => {
  /** Build a database at the schema version that shipped before this change. */
  function legacyDb(): string {
    const path = join(mkdtempSync(join(tmpdir(), 'legacy-')), 'mail.db');
    const raw = new Database(path);
    raw.pragma('foreign_keys = ON');
    for (let i = 0; i < MIGRATIONS.length - 1; i++) {
      raw.exec(MIGRATIONS[i]!);
      raw.pragma(`user_version = ${i + 1}`);
    }
    raw.exec(`
      INSERT INTO accounts (id, email, display_name, provider, imap_json, smtp_json, created_at)
        VALUES ('acc1', 'alice@dev.local', 'Alice', 'imap', '{}', '{}', 0);
      INSERT INTO folders (id, account_id, path, role) VALUES ('f-inbox', 'acc1', 'INBOX', 'inbox');
      INSERT INTO threads (id, account_id, subject, placement) VALUES ('t-real', 'acc1', 'Real', 'inbox');
      INSERT INTO threads (id, account_id, subject, placement) VALUES ('t-ghost', 'acc1', 'Ghost', 'inbox');
      INSERT INTO messages (id, account_id, thread_id, folder_id, uid, message_id_hdr, subject, from_json, date, draft)
        VALUES ('m1', 'acc1', 't-real', 'f-inbox', 1, '<m1@x>', 'Real', '{"email":"carol@partner.example"}', 5000, 1);
    `);
    raw.close();
    return path;
  }

  it('purges orphans and backfills the denormalized columns', () => {
    const db = new MailDb(legacyDb());

    const threads = db.listThreads({ view: 'inbox', limit: 10, offset: 0 });
    expect(threads).toHaveLength(1);
    expect(threads[0]!.id).toBe('t-real');
    // the ghost row is gone
    expect(db.raw.prepare(`SELECT count(*) AS c FROM threads`).get()).toEqual({ c: 1 });
    // and the columns that used to be correlated subqueries are populated
    expect(threads[0]!.hasDraft).toBe(true);
    expect(threads[0]!.fromEmails).toEqual(['carol@partner.example']);
  });
});

describe('migration idempotence on reopen', () => {
  it('does not re-run the thread backfill once the database is fully migrated', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'reopen-')), 'mail.db');
    const first = new MailDb(path);
    setup(first);
    first.createThread('t1', 'acc1', 'Hello');
    first.insertMessage(msg({}));
    first.refreshThreadAggregates('t1');
    first.close();

    // A second open of an already-migrated database must do no per-thread work.
    const spy = vi.spyOn(MailDb.prototype, 'refreshThreadAggregates');
    const second = new MailDb(path);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    second.close();
  });
});

describe('search scoping', () => {
  function twoAccounts(db: MailDb) {
    setup(db);
    db.insertAccount({
      id: 'acc2',
      email: 'bob@dev.local',
      displayName: 'Bob',
      authType: 'password',
      imap: { host: 'x', port: 1, secure: false },
      smtp: { host: 'x', port: 1, secure: false },
    });
    db.upsertFolder({ id: 'f2', accountId: 'acc2', path: 'INBOX', role: 'inbox', delimiter: '/' });
    db.createThread('t1', 'acc1', 'shared keyword here');
    db.insertMessage(msg({ id: 'm1', uid: 1, subject: 'shared keyword here' }));
    db.refreshThreadAggregates('t1');
    db.createThread('t2', 'acc2', 'shared keyword here');
    db.insertMessage(
      msg({ id: 'm2', uid: 2, accountId: 'acc2', threadId: 't2', folderId: 'f2',
            subject: 'shared keyword here', messageIdHdr: '<m2@x>' }),
    );
    db.refreshThreadAggregates('t2');
  }

  it('returns hits from every account when unscoped', () => {
    const db = makeDb();
    twoAccounts(db);
    expect(db.searchThreads({ fts: '"keyword"*' })).toHaveLength(2);
  });

  it('returns only the focused account when scoped', () => {
    const db = makeDb();
    twoAccounts(db);
    const hits = db.searchThreads({ fts: '"keyword"*', accountId: 'acc2' });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.accountId).toBe('acc2');
  });

  it('scopes filter-only searches too', () => {
    const db = makeDb();
    twoAccounts(db);
    db.raw.prepare(`UPDATE threads SET has_attachments = 1`).run();
    const hits = db.searchThreads({ fts: null, hasAttachment: true, accountId: 'acc1' });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.accountId).toBe('acc1');
  });
});

describe('last inbound message', () => {
  function threadWithOurReplies(db: MailDb) {
    setup(db);
    db.upsertFolder({ id: 'f-sent', accountId: 'acc1', path: 'Sent', role: 'sent', delimiter: '/' });
    db.upsertFolder({ id: 'f-drafts', accountId: 'acc1', path: 'Drafts', role: 'drafts', delimiter: '/' });
    db.createThread('t1', 'acc1', 'Migration');
    // Carol writes, we reply, then we leave a draft sitting in the thread.
    db.insertMessage(msg({ id: 'm1', uid: 1, date: 1000, messageIdHdr: '<m1@x>' }));
    db.insertMessage(
      msg({ id: 'm2', uid: 2, date: 2000, folderId: 'f-sent', messageIdHdr: '<m2@x>',
            from: { name: 'Alice', email: 'alice@dev.local' } }),
    );
    db.insertMessage(
      msg({ id: 'm3', uid: 3, date: 3000, folderId: 'f-drafts', messageIdHdr: '<m3@x>',
            from: { name: 'Alice', email: 'alice@dev.local' } }),
    );
    db.refreshThreadAggregates('t1');
    return db.listThreads({ view: 'inbox', limit: 10, offset: 0 })[0]!;
  }

  it('dates the thread by our newest message, as before', () => {
    const t = threadWithOurReplies(makeDb());
    expect(t.lastMessageDate).toBe(3000);
  });

  it('reports the newest message that did not come from us', () => {
    const t = threadWithOurReplies(makeDb());
    expect(t.lastInboundDate).toBe(1000);
  });

  it('reports who actually sent that message', () => {
    const t = threadWithOurReplies(makeDb());
    expect(t.lastInboundFrom?.email).toBe('carol@partner.example');
  });

  it('leaves a thread of only our own mail with no inbound message', () => {
    const db = makeDb();
    setup(db);
    db.upsertFolder({ id: 'f-sent', accountId: 'acc1', path: 'Sent', role: 'sent', delimiter: '/' });
    db.createThread('t1', 'acc1', 'Just me');
    db.insertMessage(
      msg({ id: 'm1', uid: 1, date: 1000, from: { name: 'Alice', email: 'alice@dev.local' } }),
    );
    db.refreshThreadAggregates('t1');
    const t = db.listThreads({ view: 'inbox', limit: 10, offset: 0 })[0]!;
    expect(t.lastInboundDate).toBe(0);
    expect(t.lastInboundFrom).toBeNull();
  });
});

describe('thread senders ordering', () => {
  function threadWithTwoSenders(db: MailDb) {
    setup(db);
    db.createThread('t1', 'acc1', 'Shared');
    db.insertMessage(
      msg({ id: 'm1', uid: 1, date: 1000, messageIdHdr: '<m1@x>',
            from: { name: 'Grayson Fuller', email: 'grayson@unsdsn.org' } }),
    );
    db.insertMessage(
      msg({ id: 'm2', uid: 2, date: 2000, messageIdHdr: '<m2@x>',
            from: { name: 'Alyson Marks', email: 'alyson@unsdsn.org' } }),
    );
    db.refreshThreadAggregates('t1');
    return db.listThreads({ view: 'inbox', limit: 10, offset: 0 })[0]!;
  }

  // Grayson wrote first, Alyson wrote last: insertion order and recency
  // disagree, so this fails if the list is not genuinely date-ordered.
  it('lists each sender once, most recent first', () => {
    const t = threadWithTwoSenders(makeDb());
    expect(t.fromEmails).toEqual(['alyson@unsdsn.org', 'grayson@unsdsn.org']);
  });

  it('carries display names alongside the addresses', () => {
    const t = threadWithTwoSenders(makeDb());
    expect(t.senders).toEqual([
      { name: 'Alyson Marks', email: 'alyson@unsdsn.org' },
      { name: 'Grayson Fuller', email: 'grayson@unsdsn.org' },
    ]);
  });

  it(`takes the display name from that sender's most recent message`, () => {
    const db = makeDb();
    setup(db);
    db.createThread('t1', 'acc1', 'Renamed');
    db.insertMessage(
      msg({ id: 'm1', uid: 1, date: 1000, messageIdHdr: '<m1@x>',
            from: { name: 'A. Marks', email: 'alyson@unsdsn.org' } }),
    );
    db.insertMessage(
      msg({ id: 'm2', uid: 2, date: 2000, messageIdHdr: '<m2@x>',
            from: { name: 'Alyson Marks', email: 'alyson@unsdsn.org' } }),
    );
    db.refreshThreadAggregates('t1');
    const t = db.listThreads({ view: 'inbox', limit: 10, offset: 0 })[0]!;
    expect(t.senders?.[0]?.name).toBe('Alyson Marks');
  });
});

describe('gatekeeper screening of the list', () => {
  function withPendingSender(db: MailDb) {
    setup(db);
    db.createThread('t-known', 'acc1', 'From someone we know');
    db.insertMessage(msg({ id: 'm1', uid: 1, threadId: 't-known', messageIdHdr: '<m1@x>' }));
    db.refreshThreadAggregates('t-known');
    db.createThread('t-new', 'acc1', 'First contact');
    db.insertMessage(
      msg({ id: 'm2', uid: 2, threadId: 't-new', messageIdHdr: '<m2@x>',
            from: { name: 'Stranger', email: 'stranger@unknown.example' } }),
    );
    db.refreshThreadAggregates('t-new');
    db.setReputation('acc1', 'stranger@unknown.example', 'address', 'pending');
  }

  it('keeps a thread from a sender awaiting a decision out of the inbox', () => {
    const db = makeDb();
    withPendingSender(db);
    const ids = db.listThreads({ view: 'inbox', limit: 10, offset: 0 }).map((t) => t.id);
    expect(ids).toEqual(['t-known']);
  });

  it('lets the thread in once the sender is accepted', () => {
    const db = makeDb();
    withPendingSender(db);
    db.setReputation('acc1', 'stranger@unknown.example', 'address', 'accepted');
    const ids = db.listThreads({ view: 'inbox', limit: 10, offset: 0 }).map((t) => t.id);
    expect(ids.sort()).toEqual(['t-known', 't-new']);
  });

  it('screens a whole domain when the pending record is a domain', () => {
    const db = makeDb();
    withPendingSender(db);
    db.setReputation('acc1', 'stranger@unknown.example', 'address', 'accepted');
    db.setReputation('acc1', 'unknown.example', 'domain', 'pending');
    const ids = db.listThreads({ view: 'inbox', limit: 10, offset: 0 }).map((t) => t.id);
    expect(ids).toEqual(['t-known']);
  });
});

describe('getThreadSummary', () => {
  it('returns a thread the list is hiding, so it can still be read', () => {
    const db = makeDb();
    setup(db);
    db.createThread('t-new', 'acc1', 'First contact');
    db.insertMessage(msg({ id: 'm1', uid: 1, threadId: 't-new' }));
    db.refreshThreadAggregates('t-new');
    db.setReputation('acc1', 'carol@partner.example', 'address', 'pending');

    expect(db.listThreads({ view: 'inbox', limit: 10, offset: 0 })).toHaveLength(0);
    expect(db.getThreadSummary('t-new')?.subject).toBe('First contact');
  });

  it('returns null for a thread that does not exist', () => {
    const db = makeDb();
    setup(db);
    expect(db.getThreadSummary('nope')).toBeNull();
  });
});

describe('priority outranks gatekeeper screening', () => {
  it('never holds back a sender the user marked priority', () => {
    const db = makeDb();
    setup(db);
    db.createThread('t-vip', 'acc1', 'From a priority sender');
    db.insertMessage(
      msg({ id: 'm1', uid: 1, threadId: 't-vip',
            from: { name: 'Alyson Marks', email: 'alyson@unsdsn.org' } }),
    );
    db.refreshThreadAggregates('t-vip');
    // Contradictory state: vouched for by the user, yet never accepted.
    db.setReputation('acc1', 'alyson@unsdsn.org', 'address', 'pending');
    db.setPrioritySender('acc1', 'alyson@unsdsn.org', true);

    const ids = db.listThreads({ view: 'inbox', limit: 10, offset: 0 }).map((t) => t.id);
    expect(ids).toEqual(['t-vip']);
  });
});

describe('review fixes', () => {
  it('does not index the from_json keys as searchable words', () => {
    const db = makeDb();
    setup(db);
    db.createThread('t1', 'acc1', 'Hello');
    db.insertMessage(msg({ id: 'm1' }));
    expect(db.searchThreads({ fts: '"email"*' })).toHaveLength(0);
    expect(db.searchThreads({ fts: '"name"*' })).toHaveLength(0);
    expect(db.searchThreads({ fts: 'from_text:"carol"*' })).toHaveLength(1);
    expect(db.searchThreads({ fts: 'from_text:"partner"*' })).toHaveLength(1);
  });

  it('re-indexes a body that is replaced', () => {
    const db = makeDb();
    setup(db);
    db.createThread('t1', 'acc1', 'Hello');
    db.insertMessage(msg({ id: 'm1' }));
    db.upsertBody('m1', null, 'first version');
    db.upsertBody('m1', null, 'zanzibar second version');
    expect(db.searchThreads({ fts: 'zanzibar' })).toHaveLength(1);
  });

  it('deletes more UIDs than SQLite allows bound parameters', () => {
    const db = makeDb();
    setup(db);
    db.createThread('t1', 'acc1', 'Hello');
    db.insertMessage(msg({ id: 'm1', uid: 7 }));
    const uids = Array.from({ length: 40_000 }, (_, i) => i + 1);
    expect(db.deleteMessagesByUids('f-inbox', uids)).toEqual(['t1']);
  });

  it('leaves a thread with a queued move alone when reconciling placement', () => {
    const db = makeDb();
    setup(db);
    db.createThread('t1', 'acc1', 'Hello');
    db.insertMessage(msg({ id: 'm1' }));
    db.raw.prepare(`UPDATE threads SET placement = 'done' WHERE id = 't1'`).run();
    db.enqueueTask({ type: 'move-thread', accountId: 'acc1', threadId: 't1', toRole: 'archive' });
    expect(db.reconcilePlacements('acc1')).toBe(false);
    db.raw.prepare(`UPDATE tasks SET status = 'done'`).run();
    expect(db.reconcilePlacements('acc1')).toBe(true);
  });
});
