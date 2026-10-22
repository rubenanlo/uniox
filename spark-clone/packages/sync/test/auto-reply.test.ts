import { describe, expect, it } from 'vitest';
import { MailDb } from '@app/db';
import { EMPTY_AUTO_REPLY, type AutoReply } from '@app/shared';
import {
  AUTO_REPLY_RESEND_MS,
  autoReplyToVacation,
  htmlToText,
  queueLocalAutoReply,
  saveLocalAutoReply,
  shouldAutoReply,
  vacationToAutoReply,
  type AutoReplyCandidate,
} from '../src/auto-reply';
import { composeRaw } from '../src/send';
import { ingestEnvelope, type FetchedEnvelope } from '../src/ingest';

const NOW = Date.UTC(2026, 9, 22, 12);
const DAY = 86_400_000;

const on: AutoReply = {
  ...EMPTY_AUTO_REPLY,
  enabled: true,
  subject: 'Out of office',
  message: 'Back on Monday.\nUrgent: ask Bob.',
};

function candidate(over: Partial<AutoReplyCandidate> = {}): AutoReplyCandidate {
  return {
    reply: { ...on, savedAt: NOW - DAY },
    now: NOW,
    messageDate: NOW - 60_000,
    fromAddress: 'carol@partner.example',
    accountEmail: 'alice@dev.local',
    headers: new Map(),
    knownCorrespondent: false,
    lastRepliedAt: undefined,
    ...over,
  };
}

describe('shouldAutoReply', () => {
  it('answers ordinary mail while switched on', () => {
    expect(shouldAutoReply(candidate())).toBe(true);
  });

  it('respects the on switch, the period, and an empty reply', () => {
    expect(shouldAutoReply(candidate({ reply: { ...on, enabled: false, savedAt: 0 } }))).toBe(
      false,
    );
    expect(shouldAutoReply(candidate({ reply: { ...on, startMs: NOW + DAY, savedAt: 0 } }))).toBe(
      false,
    );
    expect(shouldAutoReply(candidate({ reply: { ...on, endMs: NOW, savedAt: 0 } }))).toBe(false);
    expect(
      shouldAutoReply(candidate({ reply: { ...on, subject: ' ', message: '', savedAt: 0 } })),
    ).toBe(false);
  });

  it('skips mail from before it was switched on, or long-delayed mail', () => {
    expect(shouldAutoReply(candidate({ messageDate: NOW - 2 * DAY }))).toBe(false);
    expect(
      shouldAutoReply(candidate({ reply: { ...on, savedAt: 0 }, messageDate: NOW - 5 * DAY })),
    ).toBe(false);
  });

  it('never answers lists, bulk, automated mail, or itself', () => {
    const h = (k: string, v: string) => new Map([[k, v]]);
    expect(shouldAutoReply(candidate({ headers: h('list-id', '<team.x>') }))).toBe(false);
    expect(shouldAutoReply(candidate({ headers: h('list-unsubscribe', '<mailto:u@x>') }))).toBe(
      false,
    );
    expect(shouldAutoReply(candidate({ headers: h('precedence', 'bulk') }))).toBe(false);
    expect(shouldAutoReply(candidate({ headers: h('auto-submitted', 'auto-replied') }))).toBe(
      false,
    );
    expect(shouldAutoReply(candidate({ headers: h('auto-submitted', 'no') }))).toBe(true);
    expect(shouldAutoReply(candidate({ fromAddress: 'no-reply@shop.example' }))).toBe(false);
    expect(shouldAutoReply(candidate({ fromAddress: 'MAILER-DAEMON@mx.example' }))).toBe(false);
    expect(shouldAutoReply(candidate({ fromAddress: 'alice@dev.local' }))).toBe(false);
  });

  it('honours contacts-only and the once-per-4-days rule', () => {
    const contacts = { reply: { ...on, contactsOnly: true, savedAt: NOW - DAY } };
    expect(shouldAutoReply(candidate(contacts))).toBe(false);
    expect(shouldAutoReply(candidate({ ...contacts, knownCorrespondent: true }))).toBe(true);
    expect(shouldAutoReply(candidate({ lastRepliedAt: NOW - DAY }))).toBe(false);
    expect(shouldAutoReply(candidate({ lastRepliedAt: NOW - AUTO_REPLY_RESEND_MS }))).toBe(true);
  });
});

describe('Gmail vacation mapping', () => {
  it('round-trips through the Gmail shape, sending HTML so a stale web-UI body loses', () => {
    const reply: AutoReply = { ...on, startMs: NOW, endMs: NOW + 3 * DAY, contactsOnly: true };
    const v = autoReplyToVacation(reply);
    expect(v.startTime).toBe(String(NOW));
    expect(v.responseBodyHtml).toBe('Back on Monday.<br>Urgent: ask Bob.');
    expect(vacationToAutoReply(v)).toEqual(reply);
  });

  it('reads HTML-only bodies as text and open-ended periods as null', () => {
    const r = vacationToAutoReply({
      enableAutoReply: true,
      responseBodyHtml: '<div>Away &amp; offline<br>Back soon</div>',
    });
    expect(r.message).toBe('Away & offline\nBack soon');
    expect(r.startMs).toBeNull();
    expect(r.endMs).toBeNull();
    expect(htmlToText('<p>a</p><p>b</p>')).toBe('a\nb');
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
  db.upsertFolder({
    id: 'f-inbox',
    accountId: 'acc1',
    path: 'INBOX',
    role: 'inbox',
    delimiter: '/',
  });
  return db;
}

function env(uid: number, date: number): FetchedEnvelope {
  return {
    uid,
    envelope: {
      messageId: `<m${uid}@x>`,
      subject: 'Lunch?',
      from: [{ name: 'Carol', address: 'carol@partner.example' }],
      to: [{ address: 'alice@dev.local' }],
      date: new Date(date),
    },
    flags: new Set<string>(),
  };
}

describe('local responder', () => {
  const hook = (messageId: string) => ({
    accountId: 'acc1',
    messageId,
    fromAddress: 'Carol@partner.example',
    subject: 'Lunch?',
    headers: new Map<string, string>(),
  });

  it('queues one threaded, Auto-Submitted reply per sender', async () => {
    const db = setupDb();
    saveLocalAutoReply(db, 'acc1', { ...on, subject: '' }, NOW - DAY);
    const a = ingestEnvelope(db, 'acc1', 'f-inbox', env(1, NOW - 60_000))!;
    const b = ingestEnvelope(db, 'acc1', 'f-inbox', env(2, NOW - 30_000))!;

    expect(queueLocalAutoReply(db, hook(a.messageId), NOW)).toBe(true);
    expect(queueLocalAutoReply(db, hook(b.messageId), NOW)).toBe(false);

    const task = db.claimNextTask();
    expect(task?.payload.type).toBe('send-draft');
    if (task?.payload.type !== 'send-draft') return;
    const { draft } = task.payload;
    expect(draft.to).toEqual([{ email: 'carol@partner.example' }]);
    expect(draft.subject).toBe('Re: Lunch?');
    expect(draft.inReplyToMessageId).toBe(a.messageId);

    const raw = (await composeRaw(db, db.getAccount('acc1')!, draft)).toString();
    expect(raw).toMatch(/^Auto-Submitted: auto-replied/m);
    expect(raw).toMatch(/^In-Reply-To: <m1@x>/m);
  });

  it('saving again starts a fresh period', () => {
    const db = setupDb();
    saveLocalAutoReply(db, 'acc1', on, NOW - DAY);
    const a = ingestEnvelope(db, 'acc1', 'f-inbox', env(1, NOW - 60_000))!;
    expect(queueLocalAutoReply(db, hook(a.messageId), NOW)).toBe(true);
    saveLocalAutoReply(db, 'acc1', on, NOW - 120_000);
    expect(queueLocalAutoReply(db, hook(a.messageId), NOW)).toBe(true);
  });

  it('leaves Gmail OAuth accounts to Gmail', () => {
    const db = setupDb();
    db.updateAccountAuthType('acc1', 'oauth-google');
    saveLocalAutoReply(db, 'acc1', on, NOW - DAY);
    const a = ingestEnvelope(db, 'acc1', 'f-inbox', env(1, NOW - 60_000))!;
    expect(queueLocalAutoReply(db, hook(a.messageId), NOW)).toBe(false);
  });
});
