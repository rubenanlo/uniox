/**
 * Service-level integration: the full Spark layer (snooze→wake, reminders,
 * Send Later, Gatekeeper) against the live dev Dovecot + Mailpit
 * (dev/docker-compose.yml). Skips itself when the servers aren't reachable.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImapFlow } from 'imapflow';
import { connect } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MailDb } from '@app/db';
import type { DeltaEvent, SyncToMain, ThreadSummary } from '@app/shared';
import { SyncService } from '../src/service';

const HOST = '127.0.0.1';
const IMAP_PORT = 1143;
const USER = `svc-${Date.now()}@dev.local`;

function serverUp(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect(port, HOST);
    s.once('connect', () => {
      s.end();
      resolve(true);
    });
    s.once('error', () => resolve(false));
    setTimeout(() => resolve(false), 2000);
  });
}

async function waitFor<T>(
  fn: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  ms = 30_000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function appendMail(subject: string, msgId: string, refs?: string[]) {
  const client = new ImapFlow({
    host: HOST,
    port: IMAP_PORT,
    secure: false,
    auth: { user: USER, pass: 'pass' },
    tls: { rejectUnauthorized: false },
    logger: false,
  });
  await client.connect();
  await client.append(
    'INBOX',
    `From: Sender <ext@ext.example>\r\nTo: ${USER}\r\nSubject: ${subject}\r\n` +
      `Date: ${new Date().toUTCString()}\r\nMessage-ID: ${msgId}\r\n` +
      (refs?.length ? `References: ${refs.join(' ')}\r\nIn-Reply-To: ${refs[refs.length - 1]}\r\n` : '') +
      `Content-Type: text/plain\r\n\r\nbody\r\n`,
    [],
  );
  await client.logout();
}

const up = (await serverUp(IMAP_PORT)) && (await serverUp(1025));

describe.skipIf(!up)('SyncService Spark layer against live servers', () => {
  const deltas: DeltaEvent[] = [];
  let service: SyncService;
  let accountId: string;

  const db = () => (service as unknown as { db: MailDb }).db;
  const inbox = (): ThreadSummary[] => db().listThreads({ view: 'inbox', limit: 100, offset: 0 });
  const enqueue = (task: Parameters<SyncService['enqueue']>[0]) => service.enqueue(task);

  beforeAll(async () => {
    await appendMail('Snooze target', '<svc-1@x>');
    await appendMail('Reminder target', '<svc-2@x>');
    await appendMail('Block target', '<svc-3@x>');

    service = new SyncService((msg: SyncToMain) => {
      if (msg.kind === 'delta') deltas.push(msg.event);
    });
    service.init(':memory:', mkdtempSync(join(tmpdir(), 'svc-att-')));
    const result = (await service.handleQuery('account:add', {
      config: {
        email: USER,
        displayName: 'Svc',
        imap: { host: HOST, port: IMAP_PORT, secure: false, allowInsecureTls: true },
        smtp: { host: HOST, port: 1025, secure: false, allowInsecureTls: true },
      },
      password: 'pass',
    })) as { ok: boolean; accountId: string };
    expect(result.ok).toBe(true);
    accountId = result.accountId;
    await waitFor(() => inbox().length === 3, 45_000);
  }, 60_000);

  afterAll(async () => {
    await service?.shutdown();
  });

  it('snoozes a thread (IMAP-encoded) and wakes it unread with an alert', async () => {
    const thread = inbox().find((t) => t.subject === 'Snooze target')!;
    enqueue({ type: 'snooze-thread', accountId, threadId: thread.id, wakeAt: Date.now() + 2_500, alert: true });

    await waitFor(() => db().getPlacement(thread.id) === 'snoozed', 20_000);
    expect(inbox().some((t) => t.id === thread.id)).toBe(false);
    const snoozedView = db().listThreads({ view: 'snoozed', limit: 10, offset: 0 });
    expect(snoozedView.some((t) => t.id === thread.id)).toBe(true);
    // messages actually left the inbox folder
    const folders = db().listFolders(accountId);
    const snoozedFolder = folders.find((f) => f.path.includes('Uniox'));
    expect(snoozedFolder).toBeDefined();

    // the scheduler wakes it
    await waitFor(() => db().getPlacement(thread.id) === 'inbox', 25_000);
    await waitFor(() => inbox().find((t) => t.id === thread.id && t.unreadCount > 0), 20_000);
    expect(deltas.some((d) => d.kind === 'notify' && d.title.includes('Snoozed'))).toBe(true);
    expect(db().getSnooze(thread.id)).toBeNull();
  }, 60_000);

  it('a new incoming message cancels an active snooze', async () => {
    const thread = inbox().find((t) => t.subject === 'Snooze target')!;
    enqueue({ type: 'snooze-thread', accountId, threadId: thread.id, wakeAt: Date.now() + 3_600_000, alert: false });
    await waitFor(() => db().getPlacement(thread.id) === 'snoozed', 20_000);

    await appendMail('Re: Snooze target', '<svc-1b@x>', ['<svc-1@x>']);
    await waitFor(() => db().getPlacement(thread.id) === 'inbox', 30_000);
    expect(db().getSnooze(thread.id)).toBeNull();
    // and the parked messages come home
    await waitFor(() => {
      const t = inbox().find((x) => x.id === thread.id);
      return t && t.messageCount >= 2 ? true : null;
    }, 30_000);
  }, 60_000);

  it('fires a reminder: thread returns unread with a notification', async () => {
    const thread = inbox().find((t) => t.subject === 'Reminder target')!;
    // mark it read first so the unread flip is observable
    const [msg] = db().getMessagesByThread(thread.id);
    db().setFlagsById(msg!.id, { seen: true });
    db().refreshThreadAggregates(thread.id);

    enqueue({ type: 'set-reminder', accountId, threadId: thread.id, remindAt: Date.now() + 1_500 });
    await waitFor(() => deltas.some((d) => d.kind === 'notify' && d.title === 'Reminder'), 20_000).catch(
      (err) => {
        console.log('DIAG reminders:', db().raw.prepare('SELECT * FROM reminders').all());
        console.log('DIAG tasks:', db().raw.prepare('SELECT id,type,status,last_error FROM tasks ORDER BY id DESC LIMIT 8').all());
        console.log('DIAG deltas:', deltas.filter((d) => d.kind === 'notify'));
        throw err;
      },
    );
    await waitFor(() => inbox().find((t) => t.id === thread.id && t.unreadCount > 0), 20_000);
  }, 40_000);

  it('sends a scheduled email when its time comes (Mailpit receives it)', async () => {
    const marker = `Scheduled hello ${Date.now()}`;
    enqueue({
      type: 'schedule-send',
      sendAt: Date.now() + 1_200,
      draft: {
        accountId,
        to: [{ email: 'someone@ext.example' }],
        cc: [],
        bcc: [],
        subject: marker,
        html: '<p>later</p>',
        text: 'later',
        attachments: [],
      },
    });
    await waitFor(() => db().listScheduledSends().length === 1, 10_000);
    const found = await waitFor(async () => {
      const res = (await (await fetch('http://localhost:8025/api/v1/messages')).json()) as {
        messages: { Subject: string }[];
      };
      return res.messages?.some((m) => m.Subject === marker) ? true : null;
    }, 30_000);
    expect(found).toBe(true);
    await waitFor(() => db().listScheduledSends().length === 0, 10_000);
  }, 45_000);

  it('save-draft stores the draft on the server; delete-draft removes it there', async () => {
    const marker = `Draft to delete ${Date.now()}`;
    enqueue({
      type: 'save-draft',
      draft: {
        accountId,
        to: [{ email: 'aline@ext.example' }],
        cc: [],
        bcc: [],
        subject: marker,
        html: '<p>hi</p>',
        text: 'hi',
        attachments: [],
      },
    });
    const draftMsg = await waitFor(() => {
      const t = db()
        .listThreads({ view: 'drafts', limit: 50, offset: 0 })
        .find((x) => x.subject === marker);
      if (!t) return null;
      expect(t.hasDraft).toBe(true);
      return db().getMessagesByThread(t.id).find((m) => m.draft) ?? null;
    }, 30_000);

    enqueue({ type: 'delete-draft', accountId, messageId: draftMsg.id });
    await waitFor(
      () =>
        !db()
          .listThreads({ view: 'drafts', limit: 50, offset: 0 })
          .some((x) => x.subject === marker),
      20_000,
    );
    // wait for the queue to drain so the server-side move has happened
    await waitFor(
      () =>
        (db().raw.prepare(`SELECT count(*) AS n FROM tasks WHERE status IN ('pending','running')`).get() as { n: number })
          .n === 0,
      20_000,
    );

    // the draft must be gone from the server's Drafts folder, not just locally
    const draftsFolder = db().listFolders(accountId).find((f) => f.role === 'drafts')!;
    const client = new ImapFlow({
      host: HOST,
      port: IMAP_PORT,
      secure: false,
      auth: { user: USER, pass: 'pass' },
      tls: { rejectUnauthorized: false },
      logger: false,
    });
    await client.connect();
    const subjects: string[] = [];
    const lock = await client.getMailboxLock(draftsFolder.path);
    try {
      const status = await client.status(draftsFolder.path, { messages: true });
      if ((status.messages ?? 0) > 0) {
        for await (const m of client.fetch('1:*', { envelope: true })) {
          subjects.push(m.envelope?.subject ?? '');
        }
      }
    } finally {
      lock.release();
    }
    await client.logout();
    expect(subjects).not.toContain(marker);
  }, 60_000);

  it('delete + undo round-trips a thread with a draft: draft returns to Drafts, mail to inbox', async () => {
    const subject = `Undo target ${Date.now()}`;
    await appendMail(subject, `<undo-${Date.now()}@x>`);
    const thread = await waitFor(() => inbox().find((t) => t.subject === subject), 30_000);
    const orig = db().getMessagesByThread(thread.id)[0]!;

    // a draft reply on the same conversation
    enqueue({
      type: 'save-draft',
      draft: {
        accountId,
        to: [{ email: 'ext@ext.example' }],
        cc: [],
        bcc: [],
        subject: `Re: ${subject}`,
        html: '<p>wip</p>',
        text: 'wip',
        inReplyToMessageId: orig.id,
        attachments: [],
      },
    });
    const inDrafts = () => db().listThreads({ view: 'drafts', limit: 50, offset: 0 });
    await waitFor(() => inDrafts().some((t) => t.id === thread.id), 30_000);

    // delete the thread: mail AND draft go to trash
    enqueue({ type: 'move-thread', accountId, threadId: thread.id, toRole: 'trash' });
    await waitFor(() => !inDrafts().some((t) => t.id === thread.id), 20_000);
    await waitFor(
      () => db().listThreads({ view: 'trash', limit: 50, offset: 0 }).some((t) => t.id === thread.id),
      20_000,
    );
    expect(inbox().some((t) => t.id === thread.id)).toBe(false);

    // undo: mail back to the inbox, draft back to the Drafts folder
    enqueue({ type: 'move-thread', accountId, threadId: thread.id, toRole: 'inbox' });
    await waitFor(() => inbox().some((t) => t.id === thread.id), 20_000);
    await waitFor(() => inDrafts().some((t) => t.id === thread.id && t.hasDraft), 20_000);
    await waitFor(
      () => !db().listThreads({ view: 'trash', limit: 50, offset: 0 }).some((t) => t.id === thread.id),
      20_000,
    );
  }, 90_000);

  it('purge-drafts removes drafts older than the 30-day retention window', async () => {
    const stale = `Stale draft ${Date.now()}`;
    const fresh = `Fresh draft ${Date.now()}`;
    for (const subject of [stale, fresh]) {
      enqueue({
        type: 'save-draft',
        draft: { accountId, to: [], cc: [], bcc: [], subject, html: '<p>wip</p>', text: 'wip', attachments: [] },
      });
    }
    const inDrafts = () => db().listThreads({ view: 'drafts', limit: 50, offset: 0 });
    await waitFor(() => inDrafts().some((t) => t.subject === stale) && inDrafts().some((t) => t.subject === fresh), 30_000);

    // age one of them past the retention window
    db().raw
      .prepare(`UPDATE messages SET date = ? WHERE subject = ?`)
      .run(Date.now() - 31 * 24 * 60 * 60 * 1000, stale);

    enqueue({ type: 'purge-drafts' });
    await waitFor(() => !inDrafts().some((t) => t.subject === stale), 20_000);
    expect(inDrafts().some((t) => t.subject === fresh)).toBe(true);
  }, 60_000);

  it('gatekeeper block sweeps existing inbox threads to archive', async () => {
    const thread = inbox().find((t) => t.subject === 'Block target');
    expect(thread).toBeDefined();
    enqueue({ type: 'gatekeeper-decide', accountId, key: 'ext@ext.example', kind: 'address', decision: 'blocked' });
    await waitFor(() => !inbox().some((t) => t.subject === 'Block target'), 30_000);
    expect(db().getReputation(accountId, 'ext@ext.example', 'ext.example')).toBe('blocked');
  }, 45_000);
});

describe.skipIf(up)('SyncService integration (skipped)', () => {
  it('dev servers not running — start them with: pnpm mail:up', () => {
    expect(up).toBe(false);
  });
});
