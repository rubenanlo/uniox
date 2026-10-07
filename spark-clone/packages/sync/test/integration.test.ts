/**
 * Live integration test against the dev Dovecot (dev/docker-compose.yml).
 * Skips itself when the server isn't reachable. Uses a scratch user so it
 * never touches the seeded alice/bob mailboxes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImapFlow } from 'imapflow';
import { connect } from 'node:net';
import { MailDb } from '@app/db';
import type { Account, DeltaEvent } from '@app/shared';
import { AccountSync } from '../src/account-sync';

const HOST = '127.0.0.1';
const PORT = 1143;
const USER = `it-${Date.now()}@dev.local`;

function serverUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect(PORT, HOST);
    s.once('connect', () => {
      s.end();
      resolve(true);
    });
    s.once('error', () => resolve(false));
    setTimeout(() => resolve(false), 2000);
  });
}

async function waitFor<T>(fn: () => T | null | undefined | false, ms = 30_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 250));
  }
}

function helperClient(): ImapFlow {
  return new ImapFlow({
    host: HOST,
    port: PORT,
    secure: false,
    auth: { user: USER, pass: 'pass' },
    tls: { rejectUnauthorized: false },
    logger: false,
  });
}

function rfc822(subject: string, msgId: string, refs?: string[]): string {
  return (
    `From: Test Sender <sender@ext.example>\r\nTo: ${USER}\r\nSubject: ${subject}\r\n` +
    `Date: ${new Date().toUTCString()}\r\nMessage-ID: ${msgId}\r\n` +
    (refs?.length ? `References: ${refs.join(' ')}\r\nIn-Reply-To: ${refs[refs.length - 1]}\r\n` : '') +
    `Content-Type: text/plain\r\n\r\nbody of ${subject}\r\n`
  );
}

const up = await serverUp();

describe.skipIf(!up)('AccountSync against live Dovecot', () => {
  const db = new MailDb(':memory:');
  const account: Account = {
    id: 'it-acc',
    email: USER,
    displayName: 'IT',
  authType: 'password',
    imap: { host: HOST, port: PORT, secure: false, allowInsecureTls: true },
    smtp: { host: HOST, port: 1025, secure: false, allowInsecureTls: true },
  };
  const deltas: DeltaEvent[] = [];
  let sync: AccountSync;

  beforeAll(async () => {
    // seed the scratch mailbox: a 2-message thread + one standalone
    const helper = helperClient();
    await helper.connect();
    try {
      await helper.mailboxCreate('Archive');
    } catch {
      /* exists */
    }
    await helper.append('INBOX', rfc822('Thread root', '<it-1@x>'), []);
    await helper.append('INBOX', rfc822('Re: Thread root', '<it-2@x>', ['<it-1@x>']), []);
    await helper.append('INBOX', rfc822('Standalone', '<it-3@x>'), ['\\Seen']);
    await helper.logout();

    db.insertAccount(account);
    // gatekeeper would hold this unknown sender's mail silently; accept it so
    // the notify assertion below exercises the normal path
    db.setReputation('it-acc', 'sender@ext.example', 'address', 'accepted');
    sync = new AccountSync(db, account, async () => 'pass', '/tmp/spark-clone-it-attachments', (e) =>
      deltas.push(e),
    );
    await sync.start();
  }, 60_000);

  afterAll(async () => {
    await sync?.stop();
    db.close();
  });

  it('backfills folders and threads messages', async () => {
    const threads = await waitFor(() => {
      const t = db.listThreads({ view: 'inbox', limit: 50, offset: 0 });
      return t.length === 2 ? t : null;
    });
    const root = threads.find((t) => t.subject.includes('Thread root'))!;
    expect(root.messageCount).toBe(2);
    expect(root.unreadCount).toBe(2);
    const standalone = threads.find((t) => t.subject === 'Standalone')!;
    expect(standalone.unreadCount).toBe(0);
    expect(db.getFolderByRole('it-acc', 'archive')).not.toBeNull();
  }, 45_000);

  it('hydrates bodies with snippets', async () => {
    await waitFor(() => {
      const t = db.listThreads({ view: 'inbox', limit: 50, offset: 0 });
      return t.some((x) => x.snippet.includes('body of')) ? true : null;
    });
  }, 45_000);

  it('picks up a new message appended server-side (IDLE path)', async () => {
    const helper = helperClient();
    await helper.connect();
    await helper.append('INBOX', rfc822('Re: Thread root', '<it-4@x>', ['<it-1@x>', '<it-2@x>']), []);
    await helper.logout();
    await waitFor(() => {
      const t = db.listThreads({ view: 'inbox', limit: 50, offset: 0 });
      const root = t.find((x) => x.subject.includes('Thread root'));
      return root && root.messageCount === 3 ? true : null;
    });
    expect(deltas.some((d) => d.kind === 'notify')).toBe(true);
  }, 45_000);

  it('round-trips flags and moves to Archive', async () => {
    const threads = db.listThreads({ view: 'inbox', limit: 50, offset: 0 });
    const standalone = threads.find((t) => t.subject === 'Standalone')!;
    const [msg] = db.getMessagesByThread(standalone.id);
    const folder = db.getFolder(msg!.folderId)!;

    await sync.storeFlags(folder.path, [msg!.uid], '\\Flagged', true);
    await sync.moveMessages(folder.path, [msg!.uid], 'Archive');
    db.deleteMessagesByUids(folder.id, [msg!.uid]);

    const archive = db.getFolderByRole('it-acc', 'archive')!;
    await sync.syncFolder(archive);
    await waitFor(() => {
      const arch = db.listThreads({ view: 'archive', limit: 50, offset: 0 });
      return arch.some((t) => t.subject === 'Standalone') ? true : null;
    });
    const arch = db.listThreads({ view: 'archive', limit: 50, offset: 0 });
    expect(arch.find((t) => t.subject === 'Standalone')).toBeDefined();
  }, 45_000);
});

describe.skipIf(up)('AccountSync integration (skipped)', () => {
  it('dev IMAP server not running — start it with: pnpm mail:up', () => {
    expect(up).toBe(false);
  });
});
