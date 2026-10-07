import type { MailDb, MessageInsert } from '@app/db';
import type { Address, Category, FolderRole } from '@app/shared';
import { categorize, domainOf, sameOrgDomain } from './categorize';
import { categoryLabelName } from './folders';
import { makeSnippet, newId, threadReferenceIds } from './util';

export interface EnvelopeAddress {
  name?: string;
  address?: string;
}

export interface FetchedEnvelope {
  uid: number;
  envelope?: {
    messageId?: string;
    inReplyTo?: string;
    subject?: string;
    from?: EnvelopeAddress[];
    to?: EnvelopeAddress[];
    cc?: EnvelopeAddress[];
    date?: Date;
  };
  flags?: Set<string>;
  internalDate?: Date;
  size?: number;
  bodyStructure?: BodyStructureNode;
  /** Raw header block when fetched with headers: ['references'] */
  headers?: Buffer;
}

export interface BodyStructureNode {
  type?: string;
  disposition?: string;
  childNodes?: BodyStructureNode[];
}

/** Detect a text/calendar (or .ics) part — the signal for meeting invites. */
export function structureHasCalendar(node: BodyStructureNode | undefined): boolean {
  if (!node) return false;
  const t = (node.type ?? '').toLowerCase();
  if (t === 'text/calendar' || t === 'application/ics') return true;
  return (node.childNodes ?? []).some(structureHasCalendar);
}

export function structureHasAttachments(node: BodyStructureNode | undefined): boolean {
  if (!node) return false;
  if (node.disposition === 'attachment') return true;
  const t = node.type ?? '';
  if (!node.childNodes && t && !t.startsWith('text/') && !t.startsWith('multipart/')) {
    // a lone non-text body (e.g. image/pdf) counts
    return t !== 'text/plain' && t !== 'text/html';
  }
  return (node.childNodes ?? []).some(structureHasAttachments);
}

/** Parse the fetched header block into a lowercased name → value map. */
export function parseHeaderMap(headers: Buffer | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!headers) return map;
  const unfolded = headers.toString('utf8').replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    if (!map.has(name)) map.set(name, line.slice(idx + 1).trim());
  }
  return map;
}

export function parseReferencesHeader(headers: Buffer | undefined): string[] {
  const refs = parseHeaderMap(headers).get('references');
  if (!refs) return [];
  return refs.split(/\s+/).map((s) => s.trim()).filter(Boolean);
}

const toAddress = (a: EnvelopeAddress | undefined): Address | null =>
  a?.address ? { name: a.name || undefined, email: a.address } : null;

const toAddresses = (list: EnvelopeAddress[] | undefined): Address[] =>
  (list ?? []).map(toAddress).filter((a): a is Address => !!a);

export interface IngestResult {
  messageId: string;
  threadId: string;
  threadWasNew: boolean;
}

/**
 * Insert a fetched envelope: resolve its thread via References/In-Reply-To,
 * create the thread if needed, insert the message row. Caller refreshes
 * aggregates and runs hooks (batched per sync pass).
 */
export function ingestEnvelope(
  db: MailDb,
  accountId: string,
  folderId: string,
  env: FetchedEnvelope,
): IngestResult | null {
  const e = env.envelope ?? {};
  if (db.hasMessage(folderId, env.uid)) return null;

  const references = parseReferencesHeader(env.headers);
  const refIds = threadReferenceIds({
    messageId: e.messageId,
    inReplyTo: e.inReplyTo,
    references,
  });
  // Another copy of the same message (Sent vs INBOX) must join the same thread.
  const lookup = e.messageId ? [...refIds, e.messageId] : refIds;

  const existing = db.findThreadByMessageIds(accountId, lookup);
  const threadWasNew = !existing;
  const threadId = existing ?? newId();

  const flags = env.flags ?? new Set<string>();
  // A malformed Date header parses to an Invalid Date, whose getTime() is NaN.
  // NaN binds as NULL and trips messages.date NOT NULL, which used to throw out
  // of the whole folder sync on every pass. Fall back instead of failing.
  const date = firstFiniteTime(e.date, env.internalDate) ?? Date.now();
  const m: MessageInsert = {
    id: newId(),
    accountId,
    threadId,
    folderId,
    uid: env.uid,
    messageIdHdr: e.messageId ?? null,
    inReplyTo: e.inReplyTo ?? null,
    references,
    subject: e.subject ?? '',
    from: toAddress(e.from?.[0]),
    to: toAddresses(e.to),
    cc: toAddresses(e.cc),
    date,
    snippet: '',
    seen: flags.has('\\Seen'),
    flagged: flags.has('\\Flagged'),
    answered: flags.has('\\Answered'),
    draft: flags.has('\\Draft'),
    hasAttachments: structureHasAttachments(env.bodyStructure),
    size: env.size ?? 0,
  };
  // The thread row and its first message must land together: a failed insert
  // that left the thread behind leaked an unreferenced row on every retry.
  db.transaction(() => {
    if (threadWasNew) db.createThread(threadId, accountId, e.subject ?? '');
    db.insertMessage(m);
  });
  return { messageId: m.id, threadId, threadWasNew };
}

/** First of the candidates that is a real, finite timestamp. */
function firstFiniteTime(...candidates: (Date | undefined)[]): number | null {
  for (const d of candidates) {
    const t = d?.getTime();
    if (t !== undefined && Number.isFinite(t)) return t;
  }
  return null;
}

export interface HookOutcome {
  cancelledSnooze: boolean;
  cancelledReminder: boolean;
  category: Category;
  gatekeeper: 'ok' | 'pending' | 'blocked';
  notify: boolean;
}

export interface HookInput {
  accountId: string;
  threadId: string;
  messageId: string;
  folderRole: FolderRole;
  seen: boolean;
  isBackfill: boolean;
  fromAddress: string | null;
  subject: string;
  hasCalendar: boolean;
  headers: Map<string, string>;
  /** distinct visible To + Cc addresses (see countRecipients) */
  recipientCount?: number;
}

/** Distinct visible To + Cc addresses — the categorizer's bulk-vs-discussion signal. */
export function countRecipients(envelope?: FetchedEnvelope['envelope']): number {
  const seen = new Set<string>();
  for (const a of [...(envelope?.to ?? []), ...(envelope?.cc ?? [])]) {
    if (a.address) seen.add(a.address.toLowerCase());
  }
  return seen.size;
}

/**
 * The new-message-on-thread hook (report §6.2): one code path that
 * (a) cancels a snooze (messages return via an unsnooze task since snooze is
 * IMAP-encoded), (b) cancels pending reminders, (c) runs Gatekeeper,
 * (d) runs the Smart Inbox categorizer, (e) decides notification.
 */
export function runNewMessageHook(db: MailDb, opts: HookInput): HookOutcome {
  const out: HookOutcome = {
    cancelledSnooze: false,
    cancelledReminder: false,
    category: 'personal',
    gatekeeper: 'ok',
    notify: false,
  };

  // Cancellation rules only trigger on genuinely incoming mail (inbox), never
  // on observing our own moved messages (snoozed folder) or sent copies.
  const incoming = opts.folderRole === 'inbox';

  // (a) "The snooze automatically turns off when you receive a new message."
  if (incoming && db.getSnooze(opts.threadId)) {
    db.deleteSnooze(opts.threadId);
    db.setPlacement(opts.threadId, 'inbox');
    // Server-side, the old messages sit in the Snoozed folder; bring them home.
    db.enqueueTask({
      type: 'unsnooze-thread',
      accountId: opts.accountId,
      threadId: opts.threadId,
      markUnread: false,
      notify: false,
    });
    out.cancelledSnooze = true;
  }

  // (b) a reply arriving suppresses the follow-up reminder
  if (incoming && db.raw.prepare(`SELECT 1 FROM reminders WHERE thread_id = ?`).get(opts.threadId)) {
    db.deleteReminder(opts.threadId);
    out.cancelledReminder = true;
  }

  // Gatekeeper + categorizer only judge incoming inbox mail.
  if (opts.folderRole === 'inbox' && opts.fromAddress) {
    const address = opts.fromAddress.toLowerCase();
    const domain = domainOf(address);

    // (c) Gatekeeper first-contact screening
    const rep = db.getReputation(opts.accountId, address, domain);
    if (rep === 'blocked') {
      out.gatekeeper = 'blocked';
      db.enqueueTask({
        type: 'move-thread',
        accountId: opts.accountId,
        threadId: opts.threadId,
        toRole: 'archive',
      });
    } else if (rep === 'pending') {
      out.gatekeeper = 'pending';
    } else if (rep === 'unknown') {
      if (db.isKnownRecipient(opts.accountId, address)) {
        db.setReputation(opts.accountId, address, 'address', 'accepted');
      } else {
        db.setReputation(opts.accountId, address, 'address', 'pending');
        out.gatekeeper = 'pending';
      }
    }

    // (d) Smart Inbox category: sticky override first, then rules. Heuristic
    // rules are revisable: mail from a sender we correspond with outranks a
    // stale bulk guess (team aliases stamp List-Id on ordinary human mail),
    // so the stale row is dropped and the rules re-run. User rows still win.
    const knownCorrespondent = db.isKnownRecipient(opts.accountId, address);
    const accountEmail = db.getAccount(opts.accountId)?.email ?? '';
    const sameOrgSender = sameOrgDomain(address, accountEmail);
    const userOverride = db.getUserCategoryOverride(opts.accountId, address, domain);
    let override = userOverride ?? db.getCategoryOverride(opts.accountId, address, domain);
    if (
      !userOverride &&
      override &&
      override !== 'personal' &&
      (knownCorrespondent || sameOrgSender)
    ) {
      db.deleteHeuristicSenderCategory(opts.accountId, address);
      override = null;
    }
    out.category =
      override ??
      categorize({
        headers: opts.headers,
        fromAddress: address,
        subject: opts.subject,
        hasCalendar: opts.hasCalendar,
        threadHasOurReply: threadHasSentMessage(db, opts.threadId),
        knownCorrespondent,
        sameOrgSender,
        recipientCount: opts.recipientCount,
      });
    db.setThreadCategory(opts.threadId, out.category);
    // Invites are per-message (a colleague sends both invites and plain
    // mail), so they never write a sticky sender rule.
    if (!override && out.category !== 'personal' && out.category !== 'invites') {
      db.setSenderCategory(opts.accountId, address, 'address', out.category, 'heuristic');
    }
  }

  // (d2) Priority senders: new mail from a priority sender joins the
  // Uniox/Priority label so every client sees the same grouping. The executor
  // is Gmail-gated (a COPY on plain IMAP would duplicate the message).
  if (
    incoming &&
    opts.fromAddress &&
    out.gatekeeper !== 'blocked' &&
    db.isPrioritySender(opts.accountId, opts.fromAddress)
  ) {
    db.enqueueTask({
      type: 'apply-label',
      accountId: opts.accountId,
      messageId: opts.messageId,
      label: 'Priority',
    });
  }

  // (d3) User category overrides mirror to Uniox/<Category> labels the same
  // way. Heuristic classifications intentionally do not (label spam).
  if (incoming && opts.fromAddress && out.gatekeeper !== 'blocked') {
    const address = opts.fromAddress.toLowerCase();
    const userCat = db.getUserCategoryOverride(opts.accountId, address, domainOf(address));
    const labelName = userCat ? categoryLabelName(userCat) : null;
    if (labelName) {
      db.enqueueTask({
        type: 'apply-label',
        accountId: opts.accountId,
        messageId: opts.messageId,
        label: labelName,
      });
    }
  }

  // (e) notifications. 'all' (default) notifies for every fresh unseen inbox
  // message except blocked senders — like any mail app. 'smart' keeps the
  // report §6 gate: human-relevant categories from accepted senders only.
  const mode = (db.getSetting('notifications') as string | null) ?? 'all';
  const fresh =
    opts.folderRole === 'inbox' && !opts.seen && !opts.isBackfill && out.gatekeeper !== 'blocked';
  out.notify =
    mode === 'off'
      ? false
      : mode === 'smart'
        ? fresh &&
          (out.category === 'personal' || out.category === 'invites') &&
          out.gatekeeper === 'ok'
        : fresh;
  return out;
}

function threadHasSentMessage(db: MailDb, threadId: string): boolean {
  return !!db.raw
    .prepare(
      `SELECT 1 FROM messages m JOIN folders f ON m.folder_id = f.id
       WHERE m.thread_id = ? AND f.role = 'sent' LIMIT 1`,
    )
    .get(threadId);
}

export function updateSnippetFromBody(db: MailDb, messageId: string, text: string | null) {
  const snippet = makeSnippet(text);
  if (!snippet) return;
  db.raw.prepare(`UPDATE messages SET snippet = ? WHERE id = ?`).run(snippet, messageId);
}
