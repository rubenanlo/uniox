/**
 * Custom labels against the live dev Dovecot, with the account treated as
 * Gmail (labels are only offered there): COPY into the label folder adds it,
 * deleting that copy removes it. Skips itself when the servers aren't up.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ImapFlow } from 'imapflow';
import { connect } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MailDb } from '@app/db';
import type { ThreadSummary } from '@app/shared';
import type * as Folders from '../src/folders';

vi.mock('../src/folders', async (importOriginal) => ({
  ...(await importOriginal<typeof Folders>()),
  isGmailAccount: () => true,
}));

const { SyncService } = await import('../src/service');

const HOST = '127.0.0.1';
const IMAP_PORT = 1143;
const USER = `labels-${Date.now()}@dev.local`;

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

async function waitFor<T>(fn: () => T | Promise<T>, ms = 30_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function withClient<T>(fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const client = new ImapFlow({
    host: HOST,
    port: IMAP_PORT,
    secure: false,
    auth: { user: USER, pass: 'pass' },
    tls: { rejectUnauthorized: false },
    logger: false,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout();
  }
}

/** Messages in a server folder (0 when it doesn't exist). */
const serverCount = (path: string) =>
  withClient(async (c) => {
    const st = await c.status(path, { messages: true }).catch(() => null);
    return st?.messages ?? 0;
  });

const up = await serverUp(IMAP_PORT);

describe.skipIf(!up)('custom labels against a live server', () => {
  let service: InstanceType<typeof SyncService>;
  let accountId: string;
  const db = () => (service as unknown as { db: MailDb }).db;
  const inbox = (): ThreadSummary[] => db().listThreads({ view: 'inbox', limit: 100, offset: 0 });

  beforeAll(async () => {
    await withClient((c) =>
      c.append(
        'INBOX',
        `From: Sender <lab@ext.example>\r\nTo: ${USER}\r\nSubject: Label target\r\n` +
          `Date: ${new Date().toUTCString()}\r\nMessage-ID: <lab-1@x>\r\n` +
          `Content-Type: text/plain\r\n\r\nbody\r\n`,
      ),
    );
    service = new SyncService(() => {});
    service.init(':memory:', mkdtempSync(join(tmpdir(), 'lab-att-')));
    const result = (await service.handleQuery('account:add', {
      config: {
        email: USER,
        displayName: 'Lab',
        imap: { host: HOST, port: IMAP_PORT, secure: false, allowInsecureTls: true },
        smtp: { host: HOST, port: 1025, secure: false, allowInsecureTls: true },
      },
      password: 'pass',
    })) as { ok: boolean; accountId: string };
    expect(result.ok).toBe(true);
    accountId = result.accountId;
    db().setReputation(accountId, 'lab@ext.example', 'address', 'accepted');
    await waitFor(() => inbox().length === 1, 45_000);
  }, 60_000);

  afterAll(async () => {
    await service?.shutdown();
  });

  it('adds a new label (created on the server) and removes it again', async () => {
    const thread = inbox()[0]!;
    service.enqueue({
      type: 'set-label',
      accountId,
      threadId: thread.id,
      label: 'Travel',
      add: true,
    });
    // shown at once, before the IMAP copy lands
    expect(db().getThreadSummary(thread.id)?.labels).toEqual(['Travel']);
    await waitFor(async () => (await serverCount('Travel')) === 1, 20_000);
    await waitFor(() => db().listUserLabels(accountId).includes('Travel'), 20_000);
    expect(db().getThreadSummary(thread.id)?.labels).toEqual(['Travel']);
    // labelling twice does not copy twice
    service.enqueue({
      type: 'set-label',
      accountId,
      threadId: thread.id,
      label: 'Travel',
      add: true,
    });
    service.enqueue({
      type: 'set-label',
      accountId,
      threadId: thread.id,
      label: 'Travel',
      add: false,
    });
    expect(db().getThreadSummary(thread.id)?.labels).toEqual([]);
    await waitFor(async () => (await serverCount('Travel')) === 0, 20_000);
    // the email itself stays in the inbox
    expect(await serverCount('INBOX')).toBe(1);
    expect(inbox().some((t) => t.id === thread.id)).toBe(true);
    expect(db().getThreadSummary(thread.id)?.labels).toEqual([]);
  }, 60_000);
});
