import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MailDb } from '@app/db';
import type { DeltaEvent, SyncToMain } from '@app/shared';
import {
  appFolderPath,
  isAppNamespacePath,
  isGmailAccount,
  isMirrorFolder,
  mapFolderRole,
} from '../src/folders';
import { AccountSync } from '../src/account-sync';
import { SyncService } from '../src/service';
import {
  ingestEnvelope,
  parseReferencesHeader,
  runNewMessageHook,
  structureHasAttachments,
  type FetchedEnvelope,
} from '../src/ingest';
import { makeSnippet, normalizeSubject, threadReferenceIds } from '../src/util';

describe('util', () => {
  it('normalizes Re:/Fwd: chains', () => {
    expect(normalizeSubject('Re: Re: Fwd: Hello')).toBe('Hello');
    expect(normalizeSubject('RE[2]: Hello')).toBe('Hello');
    expect(normalizeSubject('AW: Termin')).toBe('Termin');
  });

  it('builds the reference chain in order without duplicates', () => {
    expect(
      threadReferenceIds({ messageId: '<c>', inReplyTo: '<b>', references: '<a> <b>' }),
    ).toEqual(['<a>', '<b>']);
    expect(threadReferenceIds({ references: ['<a>', '<a>'] })).toEqual(['<a>']);
  });

  it('makes clean snippets', () => {
    expect(makeSnippet('  hello\n\n  world  ')).toBe('hello world');
    expect(makeSnippet('x'.repeat(300)).length).toBe(140);
  });
});

describe('folder role mapping', () => {
  it('prefers SPECIAL-USE, falls back to names', () => {
    expect(mapFolderRole({ path: 'INBOX', name: 'INBOX' })).toBe('inbox');
    expect(mapFolderRole({ path: 'Foo', name: 'Foo', specialUse: '\\Sent' })).toBe('sent');
    expect(mapFolderRole({ path: 'Sent Items', name: 'Sent Items' })).toBe('sent');
    expect(mapFolderRole({ path: 'Deleted Items', name: 'Deleted Items' })).toBe('trash');
    expect(mapFolderRole({ path: 'Junk', name: 'Junk' })).toBe('spam');
    expect(mapFolderRole({ path: 'Random', name: 'Random' })).toBe('other');
  });
});

describe('mirror folder detection (Gmail label duplicates)', () => {
  it('flags Gmail All Mail / Important / Starred as mirror folders', () => {
    // \All is standard special-use; \Important/\Starred are Gmail-only and never
    // surface in specialUse, so they must be caught by their [Gmail] path.
    expect(isMirrorFolder({ path: '[Gmail]/All Mail', name: 'All Mail', specialUse: '\\All' })).toBe(true);
    expect(isMirrorFolder({ path: '[Gmail]/Important', name: 'Important', delimiter: '/' })).toBe(true);
    expect(isMirrorFolder({ path: '[Gmail]/Starred', name: 'Starred', delimiter: '/' })).toBe(true);
    expect(isMirrorFolder({ path: '[Google Mail]/Important', name: 'Important', delimiter: '/' })).toBe(true);
  });

  it('leaves real folders and user labels alone', () => {
    expect(isMirrorFolder({ path: 'INBOX', name: 'INBOX' })).toBe(false);
    expect(isMirrorFolder({ path: '[Gmail]/Sent Mail', name: 'Sent Mail', specialUse: '\\Sent' })).toBe(false);
    expect(isMirrorFolder({ path: '[Gmail]/Trash', name: 'Trash', specialUse: '\\Trash' })).toBe(false);
    expect(isMirrorFolder({ path: '[Gmail]/Drafts', name: 'Drafts', specialUse: '\\Drafts' })).toBe(false);
    expect(isMirrorFolder({ path: 'Priority', name: 'Priority', delimiter: '/' })).toBe(false);
    expect(isMirrorFolder({ path: 'Important', name: 'Important', delimiter: '/' })).toBe(false); // user label, not [Gmail]
  });

  it('never treats app-namespace labels as mirrors', () => {
    expect(isMirrorFolder({ path: 'Uniox/Priority', name: 'Priority', delimiter: '/' })).toBe(false);
    expect(isMirrorFolder({ path: 'Uniox/Starred', name: 'Starred', delimiter: '/' })).toBe(false);
    expect(isMirrorFolder({ path: 'SparkClone/Snoozed', name: 'Snoozed', delimiter: '/' })).toBe(false);
  });
});

describe('app namespace + Gmail detection', () => {
  it('builds and recognizes app folder paths', () => {
    expect(appFolderPath('Priority', '/')).toBe('Uniox/Priority');
    expect(appFolderPath('Archive', '.')).toBe('Uniox.Archive');
    expect(isAppNamespacePath('Uniox/Priority')).toBe(true);
    expect(isAppNamespacePath('Uniox.Archive')).toBe(true);
    expect(isAppNamespacePath('SparkClone/Snoozed')).toBe(true);
    expect(isAppNamespacePath('INBOX')).toBe(false);
    expect(isAppNamespacePath('UnioxFake')).toBe(false);
  });

  it('detects Gmail accounts by IMAP host', () => {
    expect(isGmailAccount({ imap: { host: 'imap.gmail.com', port: 993, secure: true } })).toBe(true);
    expect(isGmailAccount({ imap: { host: 'imap.googlemail.com', port: 993, secure: true } })).toBe(true);
    expect(isGmailAccount({ imap: { host: 'imap.fastmail.com', port: 993, secure: true } })).toBe(false);
    expect(isGmailAccount({ imap: { host: 'localhost', port: 1143, secure: false } })).toBe(false);
  });
});

describe('references parsing', () => {
  it('parses folded References headers', () => {
    const raw = Buffer.from('References: <a@x>\r\n <b@x>\r\nSubject: hi\r\n\r\n');
    expect(parseReferencesHeader(raw)).toEqual(['<a@x>', '<b@x>']);
  });
  it('returns empty when absent', () => {
    expect(parseReferencesHeader(Buffer.from('Subject: hi\r\n\r\n'))).toEqual([]);
  });
});

describe('bodyStructure attachment detection', () => {
  it('detects disposition=attachment at any depth', () => {
    expect(
      structureHasAttachments({
        type: 'multipart/mixed',
        childNodes: [{ type: 'text/plain' }, { type: 'application/pdf', disposition: 'attachment' }],
      }),
    ).toBe(true);
    expect(
      structureHasAttachments({
        type: 'multipart/alternative',
        childNodes: [{ type: 'text/plain' }, { type: 'text/html' }],
      }),
    ).toBe(false);
  });
});

function setupDb(): MailDb {
  const db = new MailDb(':memory:');
  db.insertAccount({
    id: 'acc1',
    email: 'alice@dev.local',
    displayName: 'Alice',
    authType: 'password',
    imap: { host: 'x', port: 1, secure: false },
    smtp: { host: 'x', port: 1, secure: false },
  });
  db.upsertFolder({ id: 'f-inbox', accountId: 'acc1', path: 'INBOX', role: 'inbox', delimiter: '/' });
  return db;
}

function env(uid: number, over: Partial<FetchedEnvelope['envelope']> = {}, headers?: string): FetchedEnvelope {
  return {
    uid,
    envelope: {
      messageId: `<m${uid}@x>`,
      subject: 'Hello',
      from: [{ name: 'Carol', address: 'carol@partner.example' }],
      to: [{ address: 'alice@dev.local' }],
      date: new Date(uid * 1000),
      ...over,
    },
    flags: new Set<string>(),
    headers: headers ? Buffer.from(headers) : undefined,
  };
}

describe('ingest + threading', () => {
  it('threads a reply onto the original via References', () => {
    const db = setupDb();
    const first = ingestEnvelope(db, 'acc1', 'f-inbox', env(1));
    const reply = ingestEnvelope(
      db,
      'acc1',
      'f-inbox',
      env(2, { inReplyTo: '<m1@x>', subject: 'Re: Hello' }, 'References: <m1@x>\r\n\r\n'),
    );
    expect(first!.threadWasNew).toBe(true);
    expect(reply!.threadWasNew).toBe(false);
    expect(reply!.threadId).toBe(first!.threadId);
  });

  it('joins a second copy of the same message-id to the same thread', () => {
    const db = setupDb();
    db.upsertFolder({ id: 'f-sent', accountId: 'acc1', path: 'Sent', role: 'sent', delimiter: '/' });
    const inbox = ingestEnvelope(db, 'acc1', 'f-inbox', env(1));
    const sentCopy = ingestEnvelope(db, 'acc1', 'f-sent', env(9, { messageId: '<m1@x>' }));
    expect(sentCopy!.threadId).toBe(inbox!.threadId);
  });

  it('is idempotent per folder+uid', () => {
    const db = setupDb();
    expect(ingestEnvelope(db, 'acc1', 'f-inbox', env(1))).not.toBeNull();
    expect(ingestEnvelope(db, 'acc1', 'f-inbox', env(1))).toBeNull();
  });
});

function hookArgs(threadId: string, over: Partial<Parameters<typeof runNewMessageHook>[1]> = {}) {
  return {
    accountId: 'acc1',
    threadId,
    messageId: 'm-hook',
    folderRole: 'inbox' as const,
    seen: false,
    isBackfill: false,
    fromAddress: 'carol@partner.example',
    subject: 'Hello',
    hasCalendar: false,
    headers: new Map<string, string>(),
    ...over,
  };
}

describe('new-message-on-thread hook', () => {
  it('cancels snooze (via unsnooze task) and reminder on incoming inbox mail', () => {
    const db = setupDb();
    const r = ingestEnvelope(db, 'acc1', 'f-inbox', env(1))!;
    db.upsertSnooze(r.threadId, Date.now() + 60_000, false);
    db.upsertReminder(r.threadId, Date.now() + 60_000);
    db.setPlacement(r.threadId, 'snoozed');

    const out = runNewMessageHook(db, hookArgs(r.threadId));
    expect(out.cancelledSnooze).toBe(true);
    expect(out.cancelledReminder).toBe(true);
    expect(db.getPlacement(r.threadId)).toBe('inbox');
    expect(db.getSnooze(r.threadId)).toBeNull();
    const task = db.claimNextTask();
    expect(task?.payload.type).toBe('unsnooze-thread');

    const quiet = runNewMessageHook(db, hookArgs(r.threadId, { isBackfill: true }));
    expect(quiet.notify).toBe(false);
  });

  it('does NOT cancel snooze/reminder for non-inbox ingests (moved/sent copies)', () => {
    const db = setupDb();
    db.upsertFolder({ id: 'f-snoozed', accountId: 'acc1', path: 'SparkClone/Snoozed', role: 'snoozed', delimiter: '/' });
    const r = ingestEnvelope(db, 'acc1', 'f-inbox', env(1))!;
    db.upsertSnooze(r.threadId, Date.now() + 60_000, false);
    db.upsertReminder(r.threadId, Date.now() + 60_000);

    const out = runNewMessageHook(db, hookArgs(r.threadId, { folderRole: 'snoozed' }));
    expect(out.cancelledSnooze).toBe(false);
    expect(out.cancelledReminder).toBe(false);
    expect(db.getSnooze(r.threadId)).not.toBeNull();
  });

  it('categorizes newsletters and suppresses their notifications (smart mode)', () => {
    const db = setupDb();
    db.setSetting('notifications', 'smart');
    const r = ingestEnvelope(db, 'acc1', 'f-inbox', env(1))!;
    // sender must be gatekeeper-accepted to isolate the category effect
    db.setReputation('acc1', 'carol@partner.example', 'address', 'accepted');
    const out = runNewMessageHook(
      db,
      hookArgs(r.threadId, { headers: new Map([['list-unsubscribe', '<https://x/unsub>']]) }),
    );
    expect(out.category).toBe('newsletters');
    expect(out.notify).toBe(false);
    // sticky heuristic override written
    expect(db.getCategoryOverride('acc1', 'carol@partner.example', 'partner.example')).toBe('newsletters');
  });

  it('user override beats rules and reclassification re-routes existing threads', () => {
    const db = setupDb();
    const r = ingestEnvelope(db, 'acc1', 'f-inbox', env(1))!;
    db.setReputation('acc1', 'carol@partner.example', 'address', 'accepted');
    db.setSenderCategory('acc1', 'carol@partner.example', 'address', 'personal', 'user');
    // heuristic write must not clobber the user row
    db.setSenderCategory('acc1', 'carol@partner.example', 'address', 'newsletters', 'heuristic');
    const out = runNewMessageHook(
      db,
      hookArgs(r.threadId, { headers: new Map([['list-id', 'x.list.example']]) }),
    );
    expect(out.category).toBe('personal');

    db.reclassifyThreadsForSender('acc1', 'carol@partner.example', 'address', 'newsletters');
    const [t] = db.listThreads({ view: 'inbox', limit: 10, offset: 0 });
    expect(t!.category).toBe('newsletters');
  });
});

describe('gatekeeper', () => {
  it('first contact from an unknown sender goes pending and is not notified (smart mode)', () => {
    const db = setupDb();
    db.setSetting('notifications', 'smart');
    const r = ingestEnvelope(db, 'acc1', 'f-inbox', env(1))!;
    const out = runNewMessageHook(db, hookArgs(r.threadId));
    expect(out.gatekeeper).toBe('pending');
    expect(out.notify).toBe(false);
    expect(db.listGatekeeperPending()).toHaveLength(1);
  });

  it('senders we have written to are auto-accepted', () => {
    const db = setupDb();
    db.upsertFolder({ id: 'f-sent', accountId: 'acc1', path: 'Sent', role: 'sent', delimiter: '/' });
    db.createThread('t-sent', 'acc1', 'hi');
    db.insertMessage({
      id: 'ms',
      accountId: 'acc1',
      threadId: 't-sent',
      folderId: 'f-sent',
      uid: 50,
      messageIdHdr: '<ms@x>',
      inReplyTo: null,
      references: [],
      subject: 'hi',
      from: { email: 'alice@dev.local' },
      to: [{ email: 'carol@partner.example' }],
      cc: [],
      date: 1000,
      snippet: '',
      seen: true,
      flagged: false,
      answered: false,
      draft: false,
      hasAttachments: false,
      size: 10,
    });
    const r = ingestEnvelope(db, 'acc1', 'f-inbox', env(1))!;
    const out = runNewMessageHook(db, hookArgs(r.threadId));
    expect(out.gatekeeper).toBe('ok');
    expect(out.notify).toBe(true);
    expect(db.getReputation('acc1', 'carol@partner.example', 'partner.example')).toBe('accepted');
  });

  it('blocked senders auto-archive on arrival', () => {
    const db = setupDb();
    db.setReputation('acc1', 'carol@partner.example', 'address', 'blocked');
    const r = ingestEnvelope(db, 'acc1', 'f-inbox', env(1))!;
    const out = runNewMessageHook(db, hookArgs(r.threadId));
    expect(out.gatekeeper).toBe('blocked');
    expect(out.notify).toBe(false);
    const task = db.claimNextTask();
    expect(task?.payload).toMatchObject({ type: 'move-thread', toRole: 'archive', threadId: r.threadId });
  });
});

describe('triage is local-first', () => {
  it('move-thread hides the thread from the inbox immediately on enqueue', async () => {
    const deltas: DeltaEvent[] = [];
    const service = new SyncService((msg: SyncToMain) => {
      if (msg.kind === 'delta') deltas.push(msg.event);
    });
    service.init(':memory:', mkdtempSync(join(tmpdir(), 'unit-att-')));
    const db = (service as unknown as { db: MailDb }).db;
    db.insertAccount({
      id: 'acc1',
      email: 'alice@dev.local',
      displayName: 'Alice',
      authType: 'password',
      imap: { host: 'x', port: 1, secure: false },
      smtp: { host: 'x', port: 1, secure: false },
    });
    db.upsertFolder({ id: 'f-inbox', accountId: 'acc1', path: 'INBOX', role: 'inbox', delimiter: '/' });
    const r = ingestEnvelope(db, 'acc1', 'f-inbox', env(1))!;

    deltas.length = 0;
    // no credentials were provided, so the IMAP move can never run — the
    // thread must still leave the inbox instantly from the local placement
    service.enqueue({ type: 'move-thread', accountId: 'acc1', threadId: r.threadId, toRole: 'archive' });

    expect(db.getPlacement(r.threadId)).toBe('done');
    const inbox = db.listThreads({ view: 'inbox', limit: 10, offset: 0 });
    expect(inbox.some((t) => t.id === r.threadId)).toBe(false);
    expect(deltas.some((d) => d.kind === 'threads-changed')).toBe(true);

    await service.shutdown();
  });

  it('delete-draft removes the draft from the drafts view immediately on enqueue', async () => {
    const deltas: DeltaEvent[] = [];
    const service = new SyncService((msg: SyncToMain) => {
      if (msg.kind === 'delta') deltas.push(msg.event);
    });
    service.init(':memory:', mkdtempSync(join(tmpdir(), 'unit-att-')));
    const db = (service as unknown as { db: MailDb }).db;
    db.insertAccount({
      id: 'acc1',
      email: 'alice@dev.local',
      displayName: 'Alice',
      authType: 'password',
      imap: { host: 'x', port: 1, secure: false },
      smtp: { host: 'x', port: 1, secure: false },
    });
    db.upsertFolder({ id: 'f-drafts', accountId: 'acc1', path: 'Drafts', role: 'drafts', delimiter: '/' });
    const draftEnv = env(1);
    draftEnv.flags = new Set(['\\Draft']);
    const r = ingestEnvelope(db, 'acc1', 'f-drafts', draftEnv)!;
    expect(db.listThreads({ view: 'drafts', limit: 10, offset: 0 }).some((t) => t.id === r.threadId)).toBe(true);

    deltas.length = 0;
    // no credentials were provided, so the IMAP move can never run — the
    // draft must still leave the drafts view instantly
    service.enqueue({ type: 'delete-draft', accountId: 'acc1', messageId: r.messageId });

    expect(db.listThreads({ view: 'drafts', limit: 10, offset: 0 }).some((t) => t.id === r.threadId)).toBe(false);
    expect(deltas.some((d) => d.kind === 'threads-changed')).toBe(true);

    await service.shutdown();
  });
});

describe('on-demand body fetch survives the launch race', () => {
  function serviceWithAccount(): {
    service: SyncService;
    posts: SyncToMain[];
    inner: { db: MailDb; waitForAccount: (id: string, ms?: number) => Promise<unknown> };
  } {
    const posts: SyncToMain[] = [];
    const service = new SyncService((m: SyncToMain) => posts.push(m));
    service.init(':memory:', mkdtempSync(join(tmpdir(), 'unit-body-')));
    const inner = service as unknown as {
      db: MailDb;
      waitForAccount: (id: string, ms?: number) => Promise<unknown>;
    };
    inner.db.insertAccount({
      id: 'acc1',
      email: 'alice@dev.local',
      displayName: 'Alice',
      authType: 'password',
      imap: { host: '127.0.0.1', port: 1, secure: false },
      smtp: { host: '127.0.0.1', port: 1, secure: false },
    });
    return { service, posts, inner };
  }

  it('waits for a not-yet-registered account and re-requests credentials instead of failing', async () => {
    const { service, posts, inner } = serviceWithAccount();
    posts.length = 0;

    // No credentials yet: the engine is not in the map. The old code threw
    // "no sync engine" here and burned the task's 3 retries in seconds.
    await expect(inner.waitForAccount('acc1', 50)).rejects.toThrow(/no sync engine/);
    // It asked the main process for credentials rather than giving up silently.
    expect(posts.some((p) => p.kind === 'need-credentials' && p.accountId === 'acc1')).toBe(true);

    await service.shutdown();
  });

  it('resolves the pending wait once credentials arrive (engine registers)', async () => {
    const { service, inner } = serviceWithAccount();

    // Request the engine before it exists, then hand credentials back a tick
    // later — exactly the launch race that stranded messages on "Loading…".
    const pending = inner.waitForAccount('acc1', 5_000);
    service.provideCredentials('acc1', 'pw');
    const sync = (await pending) as { account: { id: string } };
    expect(sync.account.id).toBe('acc1');

    await service.shutdown();
  });
});

describe('Uniox namespace migration + Gmail archive', () => {
  const gmailAccount = {
    id: 'acc1',
    email: 'alice@gmail.com',
    displayName: 'Alice',
    authType: 'password' as const,
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
  };

  function gmailDb(): MailDb {
    const db = new MailDb(':memory:');
    db.insertAccount(gmailAccount);
    db.upsertFolder({ id: 'f-inbox', accountId: 'acc1', path: 'INBOX', role: 'inbox', delimiter: '/' });
    return db;
  }

  function fakeClient(calls: string[][]) {
    return {
      usable: false, // repark() no-ops
      async mailboxRename(from: string, to: string) {
        calls.push(['rename', from, to]);
      },
      async mailboxCreate(path: string) {
        calls.push(['create', path]);
      },
      async mailboxDelete(path: string) {
        calls.push(['delete', path]);
      },
    };
  }

  function makeSync(db: MailDb, account = gmailAccount, calls: string[][] = []) {
    const sync = new AccountSync(db, account, async () => '', '/tmp', () => {});
    (sync as unknown as { client: unknown }).client = fakeClient(calls);
    return { sync, calls };
  }

  it('renames SparkClone/* and Gmail "Archive" into Uniox/*, keeping local rows', async () => {
    const db = gmailDb();
    db.upsertFolder({ id: 'f-snz', accountId: 'acc1', path: 'SparkClone/Snoozed', role: 'snoozed', delimiter: '/' });
    db.upsertFolder({ id: 'f-arch', accountId: 'acc1', path: 'Archive', role: 'archive', delimiter: '/' });
    db.createThread('t1', 'acc1', 'Hi');
    db.insertMessage({
      id: 'm1', accountId: 'acc1', threadId: 't1', folderId: 'f-arch', uid: 5,
      messageIdHdr: '<a@x>', inReplyTo: null, references: [], subject: 'Hi',
      from: { email: 'c@x.example' }, to: [], cc: [], date: 1000, snippet: '',
      seen: true, flagged: false, answered: false, draft: false, hasAttachments: false, size: 1,
    });

    const { sync, calls } = makeSync(db);
    await (sync as unknown as { migrateLegacyAppFolders(): Promise<void> }).migrateLegacyAppFolders();

    expect(calls).toContainEqual(['rename', 'SparkClone/Snoozed', 'Uniox/Snoozed']);
    expect(calls).toContainEqual(['rename', 'Archive', 'Uniox/Archive']);
    // rows kept: same folder ids, new paths, messages intact
    expect(db.getFolder('f-snz')!.path).toBe('Uniox/Snoozed');
    expect(db.getFolder('f-arch')!.path).toBe('Uniox/Archive');
    expect(db.getFolder('f-arch')!.role).toBe('archive');
    expect(db.getMessage('m1')!.folderId).toBe('f-arch');
  });

  it('is a no-op when nothing legacy exists, and leaves non-Gmail Archive alone', async () => {
    const db = new MailDb(':memory:');
    const fastmail = { ...gmailAccount, email: 'a@fastmail.com', imap: { host: 'imap.fastmail.com', port: 993, secure: true } };
    db.insertAccount(fastmail);
    db.upsertFolder({ id: 'f-inbox', accountId: 'acc1', path: 'INBOX', role: 'inbox', delimiter: '/' });
    db.upsertFolder({ id: 'f-arch', accountId: 'acc1', path: 'Archive', role: 'archive', delimiter: '/' });
    const { sync, calls } = makeSync(db, fastmail);
    await (sync as unknown as { migrateLegacyAppFolders(): Promise<void> }).migrateLegacyAppFolders();
    expect(calls).toEqual([]);
    expect(db.getFolder('f-arch')!.path).toBe('Archive');
  });

  it('ensureRoleFolder(archive) creates Uniox/Archive on Gmail, top-level Archive elsewhere', async () => {
    const db = gmailDb();
    const { sync } = makeSync(db);
    const folder = await sync.ensureRoleFolder('archive', 'Archive');
    expect(folder.path).toBe('Uniox/Archive');
    expect(folder.role).toBe('archive');

    const db2 = new MailDb(':memory:');
    const fastmail = { ...gmailAccount, email: 'a@fastmail.com', imap: { host: 'imap.fastmail.com', port: 993, secure: true } };
    db2.insertAccount(fastmail);
    db2.upsertFolder({ id: 'f-inbox', accountId: 'acc1', path: 'INBOX', role: 'inbox', delimiter: '/' });
    const { sync: sync2 } = makeSync(db2, fastmail);
    const folder2 = await sync2.ensureRoleFolder('archive', 'Archive');
    expect(folder2.path).toBe('Archive');
  });
});

describe('notification modes', () => {
  it("default 'all': every fresh unseen inbox message notifies, even newsletters and first contacts", () => {
    const db = setupDb();
    const r = ingestEnvelope(db, 'acc1', 'f-inbox', env(1))!;
    const out = runNewMessageHook(
      db,
      hookArgs(r.threadId, { messageId: r.messageId, headers: new Map([['list-unsubscribe', '<https://x>']]) }),
    );
    expect(out.category).toBe('newsletters');
    expect(out.notify).toBe(true); // gatekeeper 'pending' no longer silences in 'all'
  });

  it("'all' still keeps blocked senders, seen mail, and backfill quiet", () => {
    const db = setupDb();
    db.setReputation('acc1', 'carol@partner.example', 'address', 'blocked');
    const r = ingestEnvelope(db, 'acc1', 'f-inbox', env(1))!;
    expect(runNewMessageHook(db, hookArgs(r.threadId, { messageId: r.messageId })).notify).toBe(false);

    const db2 = setupDb();
    const r2 = ingestEnvelope(db2, 'acc1', 'f-inbox', env(1))!;
    expect(
      runNewMessageHook(db2, hookArgs(r2.threadId, { messageId: r2.messageId, isBackfill: true })).notify,
    ).toBe(false);
    expect(
      runNewMessageHook(db2, hookArgs(r2.threadId, { messageId: r2.messageId, seen: true })).notify,
    ).toBe(false);
  });

  it("'off' silences everything", () => {
    const db = setupDb();
    db.setSetting('notifications', 'off');
    db.setReputation('acc1', 'carol@partner.example', 'address', 'accepted');
    const r = ingestEnvelope(db, 'acc1', 'f-inbox', env(1))!;
    expect(runNewMessageHook(db, hookArgs(r.threadId, { messageId: r.messageId })).notify).toBe(false);
  });
});

describe('priority senders', () => {
  it('round-trips the DB list and normalizes case', () => {
    const db = setupDb();
    expect(db.setPrioritySender('acc1', ' Boss@Example.com ', true)).toBe(true);
    expect(db.setPrioritySender('acc1', 'boss@example.com', true)).toBe(false); // already there
    expect(db.isPrioritySender('acc1', 'BOSS@example.com')).toBe(true);
    expect(db.listPrioritySenders('acc1').map((r) => r.email)).toEqual(['boss@example.com']);
    expect(db.setPrioritySender('acc1', 'boss@example.com', false)).toBe(true);
    expect(db.listPrioritySenders()).toEqual([]);
  });

  it('hook enqueues an apply-label task for incoming mail from a priority sender', () => {
    const db = setupDb();
    db.setPrioritySender('acc1', 'carol@partner.example', true);
    db.setReputation('acc1', 'carol@partner.example', 'address', 'accepted');
    const r = ingestEnvelope(db, 'acc1', 'f-inbox', env(1))!;
    runNewMessageHook(db, hookArgs(r.threadId, { messageId: r.messageId }));
    const tasks: string[] = [];
    for (;;) {
      const t = db.claimNextTask();
      if (!t) break;
      tasks.push(t.payload.type);
      if (t.payload.type === 'apply-label') {
        expect(t.payload.label).toBe('Priority');
        expect(t.payload.messageId).toBe(r.messageId);
      }
      db.finishTask(t.id, 'done');
    }
    expect(tasks).toContain('apply-label');
  });

  it('hook stays quiet for non-priority senders and blocked mail', () => {
    const db = setupDb();
    db.setReputation('acc1', 'carol@partner.example', 'address', 'accepted');
    const r = ingestEnvelope(db, 'acc1', 'f-inbox', env(1))!;
    runNewMessageHook(db, hookArgs(r.threadId, { messageId: r.messageId }));
    const types: string[] = [];
    for (;;) {
      const t = db.claimNextTask();
      if (!t) break;
      types.push(t.payload.type);
      db.finishTask(t.id, 'done');
    }
    expect(types).not.toContain('apply-label');
  });
});

describe('category override label sync', () => {
  it('user override enqueues apply-label with the category label for new mail', () => {
    const db = setupDb();
    db.setReputation('acc1', 'carol@partner.example', 'address', 'accepted');
    db.setSenderCategory('acc1', 'carol@partner.example', 'address', 'newsletters', 'user');
    const r = ingestEnvelope(db, 'acc1', 'f-inbox', env(1))!;
    runNewMessageHook(db, hookArgs(r.threadId, { messageId: r.messageId }));
    const labels: string[] = [];
    for (;;) {
      const t = db.claimNextTask();
      if (!t) break;
      if (t.payload.type === 'apply-label') labels.push(t.payload.label);
      db.finishTask(t.id, 'done');
    }
    expect(labels).toEqual(['Newsletters']);
  });

  it('heuristic classification never enqueues a label task', () => {
    const db = setupDb();
    db.setReputation('acc1', 'carol@partner.example', 'address', 'accepted');
    const r = ingestEnvelope(db, 'acc1', 'f-inbox', env(1))!;
    // list-unsubscribe → heuristic 'newsletters', sticky heuristic row written
    runNewMessageHook(
      db,
      hookArgs(r.threadId, { messageId: r.messageId, headers: new Map([['list-unsubscribe', '<https://x>']]) }),
    );
    const labels: string[] = [];
    for (;;) {
      const t = db.claimNextTask();
      if (!t) break;
      if (t.payload.type === 'apply-label') labels.push(t.payload.label);
      db.finishTask(t.id, 'done');
    }
    expect(labels).toEqual([]);
    // and the heuristic row exists but is not a user override
    expect(db.getCategoryOverride('acc1', 'carol@partner.example', 'partner.example')).toBe('newsletters');
    expect(db.getUserCategoryOverride('acc1', 'carol@partner.example', 'partner.example')).toBeNull();
  });

  it('personal user override maps to no label', () => {
    const db = setupDb();
    db.setReputation('acc1', 'carol@partner.example', 'address', 'accepted');
    db.setSenderCategory('acc1', 'carol@partner.example', 'address', 'personal', 'user');
    const r = ingestEnvelope(db, 'acc1', 'f-inbox', env(1))!;
    runNewMessageHook(db, hookArgs(r.threadId, { messageId: r.messageId }));
    for (;;) {
      const t = db.claimNextTask();
      if (!t) break;
      expect(t.payload.type).not.toBe('apply-label');
      db.finishTask(t.id, 'done');
    }
  });
});

describe('label read-back (reconcileServerState)', () => {
  const gmail = {
    id: 'acc1',
    email: 'alice@gmail.com',
    displayName: 'Alice',
    authType: 'password' as const,
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
  };

  function setupGmail() {
    const db = new MailDb(':memory:');
    db.insertAccount(gmail);
    db.upsertFolder({ id: 'f-inbox', accountId: 'acc1', path: 'INBOX', role: 'inbox', delimiter: '/' });
    db.upsertFolder({ id: 'f-prio', accountId: 'acc1', path: 'Uniox/Priority', role: 'other', delimiter: '/' });
    db.upsertFolder({ id: 'f-news', accountId: 'acc1', path: 'Uniox/Newsletters', role: 'other', delimiter: '/' });
    db.upsertFolder({ id: 'f-arch', accountId: 'acc1', path: 'Uniox/Archive', role: 'archive', delimiter: '/' });
    const deltas: DeltaEvent[] = [];
    const sync = new AccountSync(db, gmail, async () => '', '/tmp', (e) => deltas.push(e));
    const reconcile = () =>
      (sync as unknown as { reconcileServerState(): void }).reconcileServerState();
    return { db, reconcile, deltas };
  }

  function addMsg(db: MailDb, id: string, folderId: string, uid: number, from: string, threadId = 't1', msgid?: string) {
    db.insertMessage({
      id, accountId: 'acc1', threadId, folderId, uid,
      messageIdHdr: msgid ?? `<${id}@x>`, inReplyTo: null, references: [], subject: 'S',
      from: { email: from }, to: [], cc: [], date: 1000, snippet: '',
      seen: true, flagged: false, answered: false, draft: false, hasAttachments: false, size: 1,
    });
  }

  it('adopts priority senders from label membership and drops stale locals', () => {
    const { db, reconcile } = setupGmail();
    db.createThread('t1', 'acc1', 'S');
    // bob has a labeled copy → adopt
    addMsg(db, 'm1', 'f-inbox', 1, 'bob@x.example');
    addMsg(db, 'm1p', 'f-prio', 1, 'bob@x.example', 't1', '<m1@x>');
    // stale local: old row, has mail, no labeled copy → drop
    addMsg(db, 'm2', 'f-inbox', 2, 'old@x.example', 't1');
    db.setPrioritySender('acc1', 'old@x.example', true);
    db.raw.prepare(`UPDATE priority_senders SET updated_at = 1 WHERE email = 'old@x.example'`).run();
    // fresh local: within grace → kept even without membership
    addMsg(db, 'm3', 'f-inbox', 3, 'fresh@x.example', 't1');
    db.setPrioritySender('acc1', 'fresh@x.example', true);

    reconcile();
    expect(db.isPrioritySender('acc1', 'bob@x.example')).toBe(true);
    expect(db.isPrioritySender('acc1', 'old@x.example')).toBe(false);
    expect(db.isPrioritySender('acc1', 'fresh@x.example')).toBe(true);
  });

  it('adopts and withdraws user category overrides from label membership', () => {
    const { db, reconcile } = setupGmail();
    db.createThread('t1', 'acc1', 'S');
    // carol labeled Newsletters on the server → adopt + reclassify
    addMsg(db, 'm1', 'f-inbox', 1, 'carol@p.example');
    addMsg(db, 'm1n', 'f-news', 1, 'carol@p.example', 't1', '<m1@x>');
    // stale override without membership → withdrawn
    addMsg(db, 'm2', 'f-inbox', 2, 'gone@p.example');
    db.setSenderCategory('acc1', 'gone@p.example', 'address', 'newsletters', 'user');
    db.raw.prepare(`UPDATE sender_categories SET updated_at = 1 WHERE key = 'gone@p.example'`).run();

    reconcile();
    expect(db.getUserCategoryOverride('acc1', 'carol@p.example', 'p.example')).toBe('newsletters');
    const t = db.raw.prepare(`SELECT category FROM threads WHERE id = 't1'`).get() as { category: string };
    expect(t.category).toBe('newsletters');
    expect(db.getUserCategoryOverride('acc1', 'gone@p.example', 'p.example')).toBeNull();
  });

  it('reconciles placement: archived elsewhere → done; back in inbox → inbox', () => {
    const { db, reconcile } = setupGmail();
    db.createThread('t-archived', 'acc1', 'A');
    db.createThread('t-restored', 'acc1', 'B');
    // t-archived: placement inbox, but its only message now lives in Uniox/Archive
    addMsg(db, 'a1', 'f-arch', 10, 'x@y.example', 't-archived');
    db.setPlacement('t-archived', 'inbox');
    // t-restored: placement done, but a message is back in INBOX
    addMsg(db, 'b1', 'f-inbox', 11, 'x@y.example', 't-restored');
    db.setPlacement('t-restored', 'done');

    reconcile();
    expect(db.getPlacement('t-archived')).toBe('done');
    expect(db.getPlacement('t-restored')).toBe('inbox');
  });

  it('never touches snoozed/set-aside placements and is a no-op off Gmail', () => {
    const { db, reconcile } = setupGmail();
    db.createThread('t-snoozed', 'acc1', 'S');
    addMsg(db, 's1', 'f-arch', 20, 'x@y.example', 't-snoozed');
    db.setPlacement('t-snoozed', 'snoozed');
    reconcile();
    expect(db.getPlacement('t-snoozed')).toBe('snoozed');

    // non-Gmail account: reconcile must not adopt anything
    const db2 = new MailDb(':memory:');
    const fm = { ...gmail, email: 'a@fastmail.com', imap: { host: 'imap.fastmail.com', port: 993, secure: true } };
    db2.insertAccount(fm);
    db2.upsertFolder({ id: 'f-prio', accountId: 'acc1', path: 'Uniox/Priority', role: 'other', delimiter: '/' });
    db2.createThread('t1', 'acc1', 'S');
    db2.insertMessage({
      id: 'm1', accountId: 'acc1', threadId: 't1', folderId: 'f-prio', uid: 1,
      messageIdHdr: '<m1@x>', inReplyTo: null, references: [], subject: 'S',
      from: { email: 'bob@x.example' }, to: [], cc: [], date: 1000, snippet: '',
      seen: true, flagged: false, answered: false, draft: false, hasAttachments: false, size: 1,
    });
    const sync2 = new AccountSync(db2, fm, async () => '', '/tmp', () => {});
    (sync2 as unknown as { reconcileServerState(): void }).reconcileServerState();
    expect(db2.isPrioritySender('acc1', 'bob@x.example')).toBe(false);
  });
});

describe('ingest resilience', () => {
  it('ingests a message whose Date header is unparseable', () => {
    const db = setupDb();
    const r = ingestEnvelope(db, 'acc1', 'f-inbox', env(1, { date: new Date('garbage') }));
    expect(r).not.toBeNull();
    expect(db.getMessage(r!.messageId)!.date).toBeGreaterThan(0);
  });

  it('leaves no orphan thread behind when the message insert fails', () => {
    const db = setupDb();
    // an unknown folder trips the messages.folder_id foreign key
    expect(() => ingestEnvelope(db, 'acc1', 'f-missing', env(1))).toThrow();
    expect(db.raw.prepare(`SELECT count(*) AS c FROM threads`).get()).toEqual({ c: 0 });
  });
});

describe('sync error containment', () => {
  function stubClient(attempted: string[], failOn: string) {
    return {
      usable: false, // keeps repark() from adding noise to `attempted`
      capabilities: new Set<string>(),
      mailbox: false, // syncFolder bails right after taking the lock
      getMailboxLock: async (path: string) => {
        attempted.push(path);
        if (path === failOn) throw new Error('mailbox exploded');
        return { release() {} };
      },
    };
  }

  it('keeps syncing the remaining folders when one folder throws', async () => {
    const db = setupDb();
    db.upsertFolder({ id: 'f-arch', accountId: 'acc1', path: 'Archive', role: 'archive', delimiter: '/' });
    const attempted: string[] = [];
    const sync = new AccountSync(
      db,
      db.getAccount('acc1')!,
      async () => 'pw',
      '/tmp/attach-test',
      () => {},
    );
    (sync as unknown as { client: unknown }).client = stubClient(attempted, 'INBOX');

    await sync.syncAllFolders();

    expect(attempted).toEqual(['INBOX', 'Archive']);
  });
});

describe('poison message containment', () => {
  function fullStubClient(msgs: Record<string, unknown>[]) {
    return {
      usable: false,
      capabilities: new Set<string>(),
      mailbox: { uidValidity: 1, uidNext: 99, exists: msgs.length, highestModseq: null },
      getMailboxLock: async () => ({ release() {} }),
      search: async () => msgs.map((m) => m.uid).filter((u) => typeof u === 'number'),
      fetch: async function* () {
        for (const m of msgs) yield m;
      },
    };
  }

  it('skips an envelope that cannot be stored and still finishes the folder', async () => {
    const db = setupDb();
    const sync = new AccountSync(
      db,
      db.getAccount('acc1')!,
      async () => 'pw',
      '/tmp/attach-test',
      () => {},
    );
    // uid 1 arrives with no uid on the row — unstorable (messages.uid NOT NULL).
    const poison = { ...env(1), uid: undefined };
    const good = env(2);
    (sync as unknown as { client: unknown }).client = fullStubClient([
      { ...poison, flags: new Set<string>() },
      { ...good, flags: new Set<string>() },
    ]);

    await sync.syncFolder(db.listFolders('acc1')[0]!);

    // The good message landed and the poison one was dropped, leaving exactly
    // one thread and no orphan. Asserted against the tables rather than
    // listThreads, which also applies Gatekeeper screening: these senders are
    // first contacts, so the inbox view legitimately holds them back.
    expect(db.raw.prepare(`SELECT count(*) AS c FROM messages`).get()).toEqual({ c: 1 });
    expect(db.raw.prepare(`SELECT count(*) AS c FROM threads`).get()).toEqual({ c: 1 });
    // and the folder cursor advanced, so the next pass does not refetch
    expect(db.getFolderCursor('f-inbox').lastSeenUid).toBeGreaterThan(0);
  });
});

describe('storage sweep', () => {
  it('reclaims settled tasks and orphan threads', async () => {
    const svc = new SyncService(() => {});
    svc.init(':memory:', mkdtempSync(join(tmpdir(), 'sweep-')));
    const db = (svc as unknown as { db: MailDb }).db;
    db.insertAccount({
      id: 'acc1',
      email: 'a@x.dev',
      displayName: 'A',
      authType: 'password',
      imap: { host: 'x', port: 1, secure: false },
      smtp: { host: 'x', port: 1, secure: false },
    });
    const taskId = db.enqueueTask({ type: 'sync-now', accountId: 'acc1' });
    db.finishTask(taskId, 'done');
    db.raw.prepare(`UPDATE tasks SET updated_at = 1 WHERE id = ?`).run(taskId);
    db.createThread('ghost', 'acc1', 'Ghost');

    svc.sweepStorage();

    expect(db.raw.prepare(`SELECT count(*) AS c FROM tasks`).get()).toEqual({ c: 0 });
    expect(db.raw.prepare(`SELECT count(*) AS c FROM threads`).get()).toEqual({ c: 0 });
    await svc.shutdown();
  });
});

describe('body hydration batching', () => {
  function rfc822(subject: string): Buffer {
    return Buffer.from(
      `From: Carol <carol@partner.example>\r\nTo: alice@dev.local\r\n` +
        `Subject: ${subject}\r\nDate: ${new Date(1000).toUTCString()}\r\n` +
        `Message-ID: <${subject}@x>\r\nContent-Type: text/plain\r\n\r\nbody of ${subject}\r\n`,
    );
  }

  it('hydrates a folder of pending bodies with a single mailbox lock and fetch', async () => {
    const db = setupDb();
    for (const uid of [1, 2, 3]) {
      const r = ingestEnvelope(db, 'acc1', 'f-inbox', env(uid))!;
      db.refreshThreadAggregates(r.threadId);
    }
    let locks = 0;
    let fetches = 0;
    const sync = new AccountSync(
      db,
      db.getAccount('acc1')!,
      async () => 'pw',
      mkdtempSync(join(tmpdir(), 'hydrate-')),
      () => {},
    );
    Object.assign(sync as unknown as Record<string, unknown>, {
      connected: true,
      client: {
        usable: true,
        getMailboxLock: async () => {
          locks++;
          return { release() {} };
        },
        fetch: async function* () {
          fetches++;
          for (const uid of [1, 2, 3]) yield { uid, source: rfc822(`m${uid}`) };
        },
      },
    });

    await (sync as unknown as { hydrateRecentBodies(): Promise<void> }).hydrateRecentBodies();

    // one fetch for the whole folder, not one per message
    expect(fetches).toBe(1);
    // one lock for that fetch, plus at most the fire-and-forget IDLE repark
    expect(locks).toBeLessThanOrEqual(2);
    const bodies = db.raw.prepare(`SELECT count(*) AS c FROM message_bodies`).get();
    expect(bodies).toEqual({ c: 3 });
  });
});
