import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { MIGRATIONS, JS_BACKFILL_VERSION, THREAD_DENORM_VERSION } from './schema';
import { sameOrgDomain } from '@app/shared';
import type {
  Account,
  Address,
  AttachmentMeta,
  Calendar,
  CalendarEvent,
  CalendarEventInput,
  Category,
  Folder,
  FolderRole,
  GatekeeperPending,
  GatekeeperStatus,
  MessageBodyPayload,
  MessageMeta,
  OutgoingDraft,
  Placement,
  ScheduledSend,
  Signature,
  Task,
  TaskRow,
  TaskStatus,
  Template,
  ThreadQuery,
  ThreadSummary,
} from '@app/shared';

export interface MessageInsert {
  id: string;
  accountId: string;
  threadId: string;
  folderId: string;
  uid: number;
  messageIdHdr: string | null;
  inReplyTo: string | null;
  references: string[];
  subject: string;
  from: Address | null;
  to: Address[];
  cc: Address[];
  date: number;
  snippet: string;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  draft: boolean;
  hasAttachments: boolean;
  size: number;
}

const j = (v: unknown) => JSON.stringify(v);
const p = <T>(s: string | null, fallback: T): T => {
  if (s == null) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

function rowToEvent(r: Row): CalendarEvent {
  return {
    id: r.id,
    calendarId: r.calendar_id,
    source: r.source,
    title: r.title,
    description: r.description || undefined,
    location: r.location || undefined,
    startMs: r.start_ms,
    endMs: r.end_ms,
    allDay: !!r.all_day,
    eventType: (r.event_type as 'default' | 'outOfOffice') ?? 'default',
    rrule: (r.rrule as string) || undefined,
    color: r.color || undefined,
    meetingUrl: r.meeting_url || undefined,
    readOnly: r.source !== 'local',
    transparency: r.transparency === 'transparent' ? 'transparent' : undefined,
  };
}

function rowToAccount(r: Row): Account {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    imap: p(r.imap_json, { host: '', port: 0, secure: false }),
    smtp: p(r.smtp_json, { host: '', port: 0, secure: false }),
    authType: r.auth_type ?? 'password',
  };
}

function rowToFolder(r: Row): Folder {
  return {
    id: r.id,
    accountId: r.account_id,
    path: r.path,
    role: r.role as FolderRole,
    delimiter: r.delimiter,
  };
}

function rowToThreadSummary(r: Row): ThreadSummary {
  const senders = p<Address[]>(r.senders_json, []).filter((s) => !!s?.email);
  return {
    id: r.id,
    accountId: r.account_id,
    subject: r.subject,
    participants: p<Address[]>(r.participants_json, []),
    lastMessageDate: r.last_message_date,
    snippet: r.snippet,
    messageCount: r.message_count,
    unreadCount: r.unread_count,
    hasAttachments: !!r.has_attachments,
    hasDraft: !!r.has_draft,
    senders,
    // Kept as the plain-address view of `senders`, same most-recent-first order.
    fromEmails: senders.map((s) => s.email),
    lastInboundDate: r.last_inbound_date ?? 0,
    lastInboundFrom: p<Address | null>(r.last_inbound_from_json ?? null, null),
    pinned: !!r.pinned,
    category: (r.category ?? 'personal') as Category,
    snoozeWakeAt: r.snooze_wake_at === undefined ? undefined : r.snooze_wake_at,
  };
}

function rowToMessageMeta(r: Row): MessageMeta {
  return {
    id: r.id,
    threadId: r.thread_id,
    accountId: r.account_id,
    folderId: r.folder_id,
    uid: r.uid,
    subject: r.subject,
    from: p<Address | null>(r.from_json, null),
    to: p<Address[]>(r.to_json, []),
    cc: p<Address[]>(r.cc_json, []),
    date: r.date,
    snippet: r.snippet,
    seen: !!r.seen,
    flagged: !!r.flagged,
    answered: !!r.answered,
    draft: !!r.draft,
    hasAttachments: !!r.has_attachments,
  };
}

function flagSets(flags: { seen?: boolean; flagged?: boolean; answered?: boolean }): {
  sets: string[];
  vals: number[];
} {
  const sets: string[] = [];
  const vals: number[] = [];
  for (const key of ['seen', 'flagged', 'answered'] as const) {
    const v = flags[key];
    if (v !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(v ? 1 : 0);
    }
  }
  return { sets, vals };
}

const VIEW_ROLE: Record<string, string> = {
  inbox: 'inbox',
  sent: 'sent',
  drafts: 'drafts',
  archive: 'archive',
  trash: 'trash',
  spam: 'spam',
};

/** Threads with a not-yet-executed server move; reconcilePlacements leaves them alone. */
const PENDING_THREAD_MOVES = `SELECT json_extract(payload_json, '$.threadId') FROM tasks
  WHERE status IN ('pending', 'running')
    AND type IN ('move-thread', 'snooze-thread', 'unsnooze-thread', 'set-aside-thread')`;

export class MailDb {
  readonly raw: Database.Database;

  constructor(path: string) {
    this.raw = new Database(path);
    this.raw.pragma('journal_mode = WAL');
    // WAL + NORMAL skips the per-commit fsync (durability moves to
    // checkpoints); safe for a local cache that can re-sync from the server.
    this.raw.pragma('synchronous = NORMAL');
    this.raw.pragma('busy_timeout = 5000');
    this.raw.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate() {
    const current = this.raw.pragma('user_version', { simple: true }) as number;
    for (let i = current; i < MIGRATIONS.length; i++) {
      this.raw.transaction(() => {
        this.raw.exec(MIGRATIONS[i]!);
        this.raw.pragma(`user_version = ${i + 1}`);
      })();
    }
    // JS-computed backfills SQL migrations can't express (see schema.ts).
    if (current > 0 && current < JS_BACKFILL_VERSION) {
      this.raw.transaction(() => {
        // Heuristic bulk rules for people we've written to are stale Google
        // Groups artifacts: drop them and return their threads to Personal.
        const rules = this.stmt(
            `SELECT account_id, key FROM sender_categories
             WHERE source = 'heuristic' AND kind = 'address'
               AND category IN ('newsletters', 'notifications', 'promotions')`,
          )
          .all() as Row[];
        for (const r of rules) {
          const accountId = r.account_id as string;
          const key = r.key as string;
          const accountEmail = this.getAccount(accountId)?.email ?? '';
          if (!this.isKnownRecipient(accountId, key) && !sameOrgDomain(key, accountEmail)) {
            continue;
          }
          this.deleteHeuristicSenderCategory(accountId, key);
          this.reclassifyThreadsForSender(accountId, key, 'address', 'personal');
        }
        // participants_json ordering changed to newest-first; recompute.
        const threads = this.stmt(`SELECT id FROM threads`).all() as Row[];
        for (const t of threads) this.refreshThreadAggregates(t.id as string);
      })();
    }
    // The denormalized has_draft / from_emails_json columns start empty on an
    // upgraded database; fill them once from the rows that survived the purge.
    if (current > 0 && current < THREAD_DENORM_VERSION) {
      this.raw.transaction(() => {
        const threads = this.stmt(`SELECT id FROM threads`).all() as Row[];
        for (const t of threads) this.refreshThreadAggregates(t.id as string);
      })();
    }
    // Statistics are what let the planner pick threads_placement_date over a
    // scan, and a database that has never been analyzed has none. ANALYZE
    // walks every index, so only pay for it when there is nothing there;
    // the periodic storage sweep refreshes it from then on.
    if (!this.hasPlannerStats()) this.analyze();
  }

  private hasPlannerStats(): boolean {
    const t = this.raw
      .prepare(`SELECT count(*) AS c FROM sqlite_master WHERE name = 'sqlite_stat1'`)
      .get() as Row;
    if (!t.c) return false;
    return !!(this.raw.prepare(`SELECT count(*) AS c FROM sqlite_stat1`).get() as Row).c;
  }

  close() {
    this.raw.close();
  }

  transaction<T>(fn: () => T): T {
    return this.raw.transaction(fn)();
  }

  /**
   * Prepared-statement cache. Every query here used to re-parse its SQL on
   * each call, which is pure overhead in the per-message sync loops. SQLite
   * re-plans a cached statement itself when the schema changes, so migrations
   * stay safe. A handful of call sites build their placeholder list from an
   * array length, so the cache is capped rather than unbounded.
   */
  private readonly stmtCache = new Map<string, Database.Statement>();

  private stmt(sql: string): Database.Statement {
    const hit = this.stmtCache.get(sql);
    if (hit) return hit;
    if (this.stmtCache.size >= 500) this.stmtCache.clear();
    const prepared = this.raw.prepare(sql);
    this.stmtCache.set(sql, prepared);
    return prepared;
  }

  // ---- accounts -----------------------------------------------------------

  insertAccount(a: Account) {
    this.stmt(
        `INSERT INTO accounts (id, email, display_name, imap_json, smtp_json, auth_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(a.id, a.email, a.displayName, j(a.imap), j(a.smtp), a.authType, Date.now());
  }

  /** Flip an account's auth scheme (app-password → OAuth upgrade). */
  updateAccountAuthType(id: string, authType: Account['authType']) {
    this.stmt(`UPDATE accounts SET auth_type = ? WHERE id = ?`).run(authType, id);
  }

  /** Backfill the sender name (e.g. from Google's send-as/profile). */
  updateAccountDisplayName(id: string, displayName: string) {
    this.stmt(`UPDATE accounts SET display_name = ? WHERE id = ?`).run(displayName, id);
  }

  /**
   * Newest display name this account's provider stamped on its outgoing mail —
   * a sender-name source that needs no extra OAuth scopes. Skips bare
   * local-part names (what the app itself used to write before the backfill).
   */
  lastSentDisplayName(accountId: string, email: string): string | null {
    const lower = email.toLowerCase();
    const local = lower.split('@')[0]!;
    const rows = this.stmt(
        `SELECT m.from_json FROM messages m
           JOIN folders f ON f.id = m.folder_id
         WHERE f.role = 'sent' AND m.account_id = ?
         ORDER BY m.date DESC LIMIT 50`,
      )
      .all(accountId) as { from_json: string | null }[];
    for (const r of rows) {
      const from = p<{ name?: string; email?: string } | null>(r.from_json, null);
      if (from?.email?.toLowerCase() !== lower) continue;
      const name = from.name?.trim();
      if (name && name.toLowerCase() !== local && name.toLowerCase() !== lower) return name;
    }
    return null;
  }

  /**
   * The account's most recent sent messages, newest first, with their cached
   * bodies (`hasBody` false when not fetched yet) — raw material for the
   * writing-style profile.
   */
  recentSentWithBodies(
    accountId: string,
    limit: number,
  ): { messageId: string; html: string | null; text: string | null; hasBody: boolean }[] {
    const rows = this.stmt(
        `SELECT m.id, b.html, b.text, b.message_id IS NOT NULL AS has_body
           FROM messages m
           JOIN folders f ON f.id = m.folder_id
           LEFT JOIN message_bodies b ON b.message_id = m.id
         WHERE f.role = 'sent' AND m.account_id = ? AND m.draft = 0
         ORDER BY m.date DESC LIMIT ?`,
      )
      .all(accountId, limit) as { id: string; html: string | null; text: string | null; has_body: number }[];
    return rows.map((r) => ({ messageId: r.id, html: r.html, text: r.text, hasBody: !!r.has_body }));
  }

  /**
   * Remove an account and everything under it. Folders, threads, messages,
   * bodies, attachments, scheduled sends, and sender data cascade from the
   * account row; calendars carry no FK to accounts (the local calendar has a
   * null account_id), so delete this account's calendars explicitly — their
   * events cascade via calendar_id.
   */
  deleteAccount(id: string) {
    this.transaction(() => {
      this.stmt(`DELETE FROM calendars WHERE account_id = ?`).run(id);
      this.stmt(`DELETE FROM accounts WHERE id = ?`).run(id);
    });
  }

  listAccounts(): Account[] {
    return (this.stmt(`SELECT * FROM accounts ORDER BY created_at`).all() as Row[]).map(
      rowToAccount,
    );
  }

  getAccount(id: string): Account | null {
    const r = this.stmt(`SELECT * FROM accounts WHERE id = ?`).get(id) as Row | undefined;
    return r ? rowToAccount(r) : null;
  }

  // ---- folders ------------------------------------------------------------

  upsertFolder(f: Folder): void {
    this.stmt(
        `INSERT INTO folders (id, account_id, path, role, delimiter)
         VALUES (@id, @accountId, @path, @role, @delimiter)
         ON CONFLICT(account_id, path) DO UPDATE SET role = @role, delimiter = @delimiter`,
      )
      .run({ ...f });
  }

  listFolders(accountId?: string): Folder[] {
    const rows = accountId
      ? this.stmt(`SELECT * FROM folders WHERE account_id = ?`).all(accountId)
      : this.stmt(`SELECT * FROM folders`).all();
    return (rows as Row[]).map(rowToFolder);
  }

  getFolder(id: string): Folder | null {
    const r = this.stmt(`SELECT * FROM folders WHERE id = ?`).get(id) as Row | undefined;
    return r ? rowToFolder(r) : null;
  }

  getFolderByPath(accountId: string, path: string): Folder | null {
    const r = this.stmt(`SELECT * FROM folders WHERE account_id = ? AND path = ?`)
      .get(accountId, path) as Row | undefined;
    return r ? rowToFolder(r) : null;
  }

  getFolderByRole(accountId: string, role: FolderRole): Folder | null {
    const r = this.stmt(`SELECT * FROM folders WHERE account_id = ? AND role = ? LIMIT 1`)
      .get(accountId, role) as Row | undefined;
    return r ? rowToFolder(r) : null;
  }

  getFolderCursor(folderId: string): {
    uidvalidity: number | null;
    highestmodseq: string | null;
    lastSeenUid: number;
  } {
    const r = this.stmt(`SELECT uidvalidity, highestmodseq, last_seen_uid FROM folders WHERE id = ?`)
      .get(folderId) as Row;
    return {
      uidvalidity: r?.uidvalidity ?? null,
      highestmodseq: r?.highestmodseq ?? null,
      lastSeenUid: r?.last_seen_uid ?? 0,
    };
  }

  setFolderCursor(
    folderId: string,
    cursor: { uidvalidity?: number; highestmodseq?: string | null; lastSeenUid?: number },
  ) {
    if (cursor.uidvalidity !== undefined)
      this.stmt(`UPDATE folders SET uidvalidity = ? WHERE id = ?`).run(cursor.uidvalidity, folderId);
    if (cursor.highestmodseq !== undefined)
      this.stmt(`UPDATE folders SET highestmodseq = ? WHERE id = ?`)
        .run(cursor.highestmodseq, folderId);
    if (cursor.lastSeenUid !== undefined)
      this.stmt(`UPDATE folders SET last_seen_uid = ? WHERE id = ?`).run(cursor.lastSeenUid, folderId);
  }

  /** Server-side folder rename: keep the row (and its messages) under the new path. */
  renameFolderPath(folderId: string, newPath: string): void {
    this.stmt(`UPDATE folders SET path = ? WHERE id = ?`).run(newPath, folderId);
  }

  /**
   * Remove a folder and all its messages (e.g. a Gmail mirror folder we no
   * longer sync). Returns the distinct thread ids that lost messages so the
   * caller can refresh their aggregates.
   */
  deleteFolder(folderId: string): string[] {
    const threadIds = (
      this.stmt(`SELECT DISTINCT thread_id FROM messages WHERE folder_id = ?`)
        .all(folderId) as Row[]
    ).map((r) => r.thread_id as string);
    this.stmt(`DELETE FROM messages WHERE folder_id = ?`).run(folderId);
    this.stmt(`DELETE FROM folders WHERE id = ?`).run(folderId);
    return threadIds;
  }

  /**
   * UIDVALIDITY changed: wipe the folder's messages so backfill starts over.
   * Returns the affected thread ids so the caller can refresh their aggregates.
   */
  clearFolderMessages(folderId: string): string[] {
    return this.raw.transaction(() => {
      const threadIds = (
        this.stmt(`SELECT DISTINCT thread_id FROM messages WHERE folder_id = ?`).all(folderId) as Row[]
      ).map((r) => r.thread_id as string);
      this.stmt(`DELETE FROM messages WHERE folder_id = ?`).run(folderId);
      this.stmt(`UPDATE folders SET last_seen_uid = 0, highestmodseq = NULL WHERE id = ?`)
        .run(folderId);
      return threadIds;
    })();
  }

  // ---- threads / messages ---------------------------------------------------

  createThread(id: string, accountId: string, subject: string) {
    this.stmt(`INSERT INTO threads (id, account_id, subject) VALUES (?, ?, ?)`)
      .run(id, accountId, subject);
  }

  /** Find the thread that a References/In-Reply-To chain points at. */
  findThreadByMessageIds(accountId: string, messageIdHdrs: string[]): string | null {
    if (messageIdHdrs.length === 0) return null;
    // json_each keeps one cached statement for any chain length (a per-length
    // SQL string churned the statement cache and evicted the hot sync queries).
    const r = this.stmt(
        `SELECT thread_id FROM messages
         WHERE account_id = ? AND message_id_hdr IN (SELECT value FROM json_each(?)) LIMIT 1`,
      )
      .get(accountId, JSON.stringify(messageIdHdrs)) as Row | undefined;
    return r?.thread_id ?? null;
  }

  messageUidsInFolder(folderId: string): number[] {
    return (this.stmt(`SELECT uid FROM messages WHERE folder_id = ?`).all(folderId) as Row[]).map(
      (r) => r.uid,
    );
  }

  hasMessage(folderId: string, uid: number): boolean {
    return !!this.stmt(`SELECT 1 FROM messages WHERE folder_id = ? AND uid = ?`)
      .get(folderId, uid);
  }

  insertMessage(m: MessageInsert) {
    this.stmt(
        `INSERT INTO messages (
           id, account_id, thread_id, folder_id, uid, message_id_hdr, in_reply_to, refs_json,
           subject, from_json, to_json, cc_json, date, snippet,
           seen, flagged, answered, draft, has_attachments, size
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        m.id,
        m.accountId,
        m.threadId,
        m.folderId,
        m.uid,
        m.messageIdHdr,
        m.inReplyTo,
        j(m.references),
        m.subject,
        m.from ? j(m.from) : null,
        j(m.to),
        j(m.cc),
        m.date,
        m.snippet,
        m.seen ? 1 : 0,
        m.flagged ? 1 : 0,
        m.answered ? 1 : 0,
        m.draft ? 1 : 0,
        m.hasAttachments ? 1 : 0,
        m.size,
      );
  }

  getMessage(id: string): MessageMeta | null {
    const r = this.stmt(`SELECT * FROM messages WHERE id = ?`).get(id) as Row | undefined;
    return r ? rowToMessageMeta(r) : null;
  }

  /** All rows for a thread, including multi-homed (Gmail label) copies. Used by
   *  server-side operations that must act on every folder copy (relocate, flag). */
  getMessagesByThread(threadId: string): MessageMeta[] {
    return (
      this.stmt(`SELECT * FROM messages WHERE thread_id = ? ORDER BY date ASC`).all(threadId) as Row[]
    ).map(rowToMessageMeta);
  }

  /**
   * One row per distinct Message-ID, collapsing Gmail label duplicates (the same
   * message multi-homed across INBOX + a label folder). Prefers the most
   * canonical folder copy so operations target a real location. Rows with no
   * Message-ID header can't be deduped and are each kept. For the reading pane.
   */
  private canonicalRows(threadId: string): Row[] {
    return this.stmt(
        `SELECT m.* FROM (
           SELECT m.*, ROW_NUMBER() OVER (
             PARTITION BY CASE WHEN m.message_id_hdr IS NULL OR m.message_id_hdr = ''
                               THEN m.id ELSE m.message_id_hdr END
             ORDER BY (CASE f.role
                         WHEN 'inbox' THEN 0 WHEN 'sent' THEN 1 WHEN 'drafts' THEN 2
                         WHEN 'archive' THEN 3 WHEN 'snoozed' THEN 4
                         WHEN 'spam' THEN 6 WHEN 'trash' THEN 7 ELSE 5 END), m.uid
           ) AS rn
           FROM messages m JOIN folders f ON f.id = m.folder_id
           WHERE m.thread_id = ?
         ) m WHERE m.rn = 1
         ORDER BY m.date ASC`,
      )
      .all(threadId) as Row[];
  }

  getThreadMessagesForDisplay(threadId: string): MessageMeta[] {
    return this.canonicalRows(threadId).map(rowToMessageMeta);
  }

  updateFlagsByUid(folderId: string, uid: number, flags: { seen?: boolean; flagged?: boolean; answered?: boolean }) {
    const { sets, vals } = flagSets(flags);
    if (!sets.length) return;
    this.stmt(`UPDATE messages SET ${sets.join(', ')} WHERE folder_id = ? AND uid = ?`)
      .run(...vals, folderId, uid);
  }

  setFlagsById(messageId: string, flags: { seen?: boolean; flagged?: boolean; answered?: boolean }) {
    const { sets, vals } = flagSets(flags);
    if (!sets.length) return;
    this.stmt(`UPDATE messages SET ${sets.join(', ')} WHERE id = ?`).run(...vals, messageId);
  }

  deleteMessagesByUids(folderId: string, uids: number[]): string[] {
    if (!uids.length) return [];
    // json_each instead of ?,?,… : no 32k bound-parameter limit (a folder that
    // lost that many UIDs made every sync throw) and one cached statement.
    const list = JSON.stringify(uids);
    const threadIds = (
      this.stmt(
        `SELECT DISTINCT thread_id FROM messages
         WHERE folder_id = ? AND uid IN (SELECT value FROM json_each(?))`,
      ).all(folderId, list) as Row[]
    ).map((r) => r.thread_id as string);
    this.stmt(`DELETE FROM messages WHERE folder_id = ? AND uid IN (SELECT value FROM json_each(?))`)
      .run(folderId, list);
    return threadIds;
  }

  /** Drafts not touched since the cutoff — candidates for the retention purge. */
  listStaleDraftMessages(olderThan: number): { id: string; accountId: string }[] {
    return this.stmt(
        `SELECT m.id, m.account_id AS accountId FROM messages m
         JOIN folders f ON f.id = m.folder_id
         WHERE f.role = 'drafts' AND m.draft = 1 AND m.date < ?`,
      )
      .all(olderThan) as { id: string; accountId: string }[];
  }

  /** Move a message row to another folder (after a server-side MOVE). */
  moveMessage(messageId: string, toFolderId: string, newUid: number) {
    this.stmt(`UPDATE messages SET folder_id = ?, uid = ? WHERE id = ?`)
      .run(toFolderId, newUid, messageId);
  }

  /** Recompute a thread's denormalized aggregates from its messages. Counts the
   *  deduped canonical set so Gmail label copies don't inflate message/unread
   *  counts (they'd otherwise disagree with the deduped reading pane). */
  refreshThreadAggregates(threadId: string) {
    const rows = this.canonicalRows(threadId);
    if (rows.length === 0) {
      this.stmt(`DELETE FROM threads WHERE id = ?`).run(threadId);
      return;
    }
    const n = rows.length;
    const unread = rows.reduce((acc, r) => acc + (r.seen ? 0 : 1), 0);
    const lastDate = rows.reduce((acc, r) => Math.max(acc, (r.date as number) ?? 0), 0);
    const hasAtt = rows.some((r) => r.has_attachments) ? 1 : 0;
    // rows are date ASC; latest is the last one.
    const latest = rows[rows.length - 1]!;
    // The list shows participants[0], which must be the *other* party. Drafts
    // and our own sent messages contribute their recipient, not the author
    // (Spark behavior: a sent-only thread reads "To: <recipient>"); everything
    // else contributes its author.
    const ownEmail = (
      (
        this.stmt(`SELECT a.email FROM threads t JOIN accounts a ON a.id = t.account_id WHERE t.id = ?`)
          .get(threadId) as Row | undefined
      )?.email as string | undefined
    )?.toLowerCase();
    const isOurs = (r: Row) => {
      const from = p<Address | null>(r.from_json, null);
      return !!r.draft || (!!ownEmail && !!from && from.email.toLowerCase() === ownEmail);
    };
    // The snippet pairs with the shown correspondent: preview the latest
    // message from the other party, not our own reply. Sent-only threads
    // (no other-party message) fall back to our newest message.
    const inboundRow = [...rows].reverse().find((r) => !isOurs(r));
    const snippetRow = inboundRow ?? latest;
    // Dated by the other party's newest message, so our own draft or reply
    // does not make an old thread look like it just arrived.
    const lastInboundDate = (inboundRow?.date as number | undefined) ?? 0;
    const lastInboundFrom = inboundRow ? (inboundRow.from_json as string | null) : null;
    // Newest first: the list shows participants[0], and that should be the
    // most recent correspondent (Spark behavior), not whoever started the thread.
    const froms = rows
      .slice(-8)
      .reverse()
      .map((r) => {
        const from = p<Address | null>(r.from_json, null);
        return isOurs(r) ? (p<Address[]>(r.to_json, [])[0] ?? from) : from;
      })
      .filter((a): a is Address => !!a);
    // Belt and suspenders: if our address still slipped in (e.g. we were in
    // the recipients), prefer the others; keep ourselves only when alone.
    const othersFirst = ownEmail ? froms.filter((a) => a.email.toLowerCase() !== ownEmail) : froms;
    const pool = othersFirst.length ? othersFirst : froms;
    const seen = new Set<string>();
    const participants = pool.filter((a) => {
      if (seen.has(a.email)) return false;
      seen.add(a.email);
      return true;
    });
    // has_draft and from_emails span every copy of the thread's messages, not
    // the deduped canonical set, so they are computed off the full rows (this
    // is what the old per-row subqueries in listThreads did).
    // Senders come out most-recent-first: "the priority person on this thread"
    // and the from: search label both mean whoever wrote last, not whichever
    // row a DISTINCT aggregate happened to emit first. max(date) makes the
    // bare name/email columns come from that sender's newest message.
    const spanning = this.stmt(
        `SELECT
           (SELECT max(draft) FROM messages WHERE thread_id = ?) AS has_draft,
           (SELECT json_group_array(json_object('name', name, 'email', email))
              FROM (SELECT lower(json_extract(from_json, '$.email')) AS email,
                           coalesce(json_extract(from_json, '$.name'), '') AS name,
                           max(date) AS newest
                      FROM messages
                     WHERE thread_id = ? AND from_json IS NOT NULL
                     GROUP BY email
                     ORDER BY newest DESC)) AS senders_json`,
      )
      .get(threadId, threadId) as Row | undefined;
    this.stmt(
        `UPDATE threads SET
           message_count = ?, unread_count = ?, last_message_date = ?, has_attachments = ?,
           snippet = ?, participants_json = ?, has_draft = ?, senders_json = ?,
           last_inbound_date = ?, last_inbound_from_json = ?,
           subject = CASE WHEN subject = '' THEN ? ELSE subject END
         WHERE id = ?`,
      )
      .run(
        n,
        unread,
        lastDate,
        hasAtt,
        snippetRow.snippet ?? '',
        j(participants),
        spanning?.has_draft ? 1 : 0,
        (spanning?.senders_json as string | undefined) ?? '[]',
        lastInboundDate,
        lastInboundFrom,
        latest.subject ?? '',
        threadId,
      );
  }

  /**
   * Delete thread rows left with no messages. refreshThreadAggregates only
   * visits threads a sync pass touched, so rows stranded by an aborted pass
   * were never revisited and accumulated without bound.
   */
  purgeOrphanThreads(): number {
    return this.stmt(`DELETE FROM threads WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = threads.id)`)
      .run().changes;
  }

  /** Refresh query-planner statistics. Without these SQLite plans blind. */
  analyze() {
    this.raw.exec(`ANALYZE`);
  }

  listThreads(q: ThreadQuery): ThreadSummary[] {
    const params: unknown[] = [];
    let where: string;
    if (q.view === 'pinned') {
      where = `t.pinned = 1`;
    } else if (q.view === 'snoozed') {
      where = `t.placement = 'snoozed'`;
    } else if (q.view === 'set_aside') {
      where = `t.placement = 'set_aside'`;
    } else {
      const role = VIEW_ROLE[q.view] ?? 'inbox';
      where = `EXISTS (
        SELECT 1 FROM messages m JOIN folders f ON m.folder_id = f.id
        WHERE m.thread_id = t.id AND f.role = ?
      )`;
      params.push(role);
      if (q.view === 'inbox') {
        where += ` AND t.placement = 'inbox'`;
        // Gatekeeper: mail from a sender still awaiting a decision waits in the
        // Gatekeeper strip and stays out of the list until accepted. Matched
        // against the denormalized senders, so this costs no message scan.
        where += ` AND NOT EXISTS (
          SELECT 1 FROM json_each(t.senders_json) je
          JOIN sender_reputation sr
            ON sr.account_id = t.account_id AND sr.status = 'pending'
           AND ((sr.kind = 'address' AND sr.key = lower(json_extract(je.value, '$.email')))
             OR (sr.kind = 'domain'
                 AND lower(json_extract(je.value, '$.email')) LIKE '%@' || sr.key))
          -- Marking someone Priority is the user vouching for them, which
          -- outranks a stale "awaiting a decision" record. Without this a
          -- sender can be both, and their mail silently leaves the inbox.
          WHERE NOT EXISTS (
            SELECT 1 FROM priority_senders ps
             WHERE ps.account_id = t.account_id
               AND lower(ps.email) = lower(json_extract(je.value, '$.email'))
          )
        )`;
      }
    }
    if (q.accountId) {
      where += ` AND t.account_id = ?`;
      params.push(q.accountId);
    }
    params.push(q.limit, q.offset);
    const rows = this.stmt(
        // has_draft / from_emails_json are denormalized columns maintained by
        // refreshThreadAggregates; they used to be correlated subqueries run
        // once per returned row.
        `SELECT t.*, s.wake_at AS snooze_wake_at
         FROM threads t
         LEFT JOIN snoozes s ON s.thread_id = t.id
         WHERE ${where}
         ORDER BY t.last_message_date DESC LIMIT ? OFFSET ?`,
      )
      .all(...params) as Row[];
    return rows.map(rowToThreadSummary);
  }

  /**
   * One thread by id, regardless of any view filter. The reading pane needs
   * this for threads the list deliberately hides (a Gatekeeper card opens the
   * sender's latest mail before the sender has been accepted).
   */
  getThreadSummary(threadId: string): ThreadSummary | null {
    const r = this.stmt(
        `SELECT t.*, s.wake_at AS snooze_wake_at
           FROM threads t
           LEFT JOIN snoozes s ON s.thread_id = t.id
          WHERE t.id = ?`,
      )
      .get(threadId) as Row | undefined;
    return r ? rowToThreadSummary(r) : null;
  }

  // ---- placement / snooze / reminders ---------------------------------------

  setPlacement(threadId: string, placement: Placement) {
    this.stmt(`UPDATE threads SET placement = ? WHERE id = ?`).run(placement, threadId);
  }

  getPlacement(threadId: string): Placement | null {
    const r = this.stmt(`SELECT placement FROM threads WHERE id = ?`).get(threadId) as
      | Row
      | undefined;
    return (r?.placement as Placement) ?? null;
  }

  upsertSnooze(threadId: string, wakeAt: number | null, alert: boolean) {
    this.stmt(
        `INSERT INTO snoozes (thread_id, wake_at, alert, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET wake_at = excluded.wake_at, alert = excluded.alert`,
      )
      .run(threadId, wakeAt, alert ? 1 : 0, Date.now());
  }

  getSnooze(threadId: string): { wakeAt: number | null; alert: boolean } | null {
    const r = this.stmt(`SELECT wake_at, alert FROM snoozes WHERE thread_id = ?`).get(threadId) as
      | Row
      | undefined;
    return r ? { wakeAt: r.wake_at, alert: !!r.alert } : null;
  }

  deleteSnooze(threadId: string) {
    this.stmt(`DELETE FROM snoozes WHERE thread_id = ?`).run(threadId);
  }

  upsertReminder(threadId: string, remindAt: number, createdFrom = 'thread') {
    this.stmt(
        `INSERT INTO reminders (thread_id, remind_at, created_from, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET remind_at = excluded.remind_at`,
      )
      .run(threadId, remindAt, createdFrom, Date.now());
  }

  deleteReminder(threadId: string) {
    this.stmt(`DELETE FROM reminders WHERE thread_id = ?`).run(threadId);
  }

  // ---- scheduled sends (Outbox) ----------------------------------------------

  insertScheduledSend(row: {
    id: string;
    accountId: string;
    sendAt: number;
    rawMime: string;
    draft: OutgoingDraft;
  }) {
    this.stmt(
        `INSERT INTO scheduled_sends (id, account_id, send_at, status, raw_mime, draft_json, created_at)
         VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
      )
      .run(row.id, row.accountId, row.sendAt, row.rawMime, j(row.draft), Date.now());
  }

  listScheduledSends(): ScheduledSend[] {
    const rows = this.stmt(`SELECT * FROM scheduled_sends WHERE status != 'sent' ORDER BY send_at`)
      .all() as Row[];
    return rows.map((r) => {
      const draft = p<OutgoingDraft>(r.draft_json, {} as OutgoingDraft);
      return {
        id: r.id,
        accountId: r.account_id,
        sendAt: r.send_at,
        status: r.status,
        subject: draft.subject ?? '',
        toLabel: (draft.to ?? []).map((a) => a.name || a.email).join(', '),
      };
    });
  }

  getScheduledSend(id: string): { raw: string; draft: OutgoingDraft; status: string; accountId: string } | null {
    const r = this.stmt(`SELECT * FROM scheduled_sends WHERE id = ?`).get(id) as Row | undefined;
    if (!r) return null;
    return {
      raw: r.raw_mime,
      draft: p<OutgoingDraft>(r.draft_json, {} as OutgoingDraft),
      status: r.status,
      accountId: r.account_id,
    };
  }

  setScheduledStatus(id: string, status: 'pending' | 'sending' | 'sent' | 'overdue') {
    this.stmt(`UPDATE scheduled_sends SET status = ? WHERE id = ?`).run(status, id);
  }

  deleteScheduledSend(id: string) {
    this.stmt(`DELETE FROM scheduled_sends WHERE id = ?`).run(id);
  }

  /** Launch catch-up: anything pending whose time passed while the app was closed. */
  markOverdueScheduledSends(now = Date.now()): number {
    return this.stmt(`UPDATE scheduled_sends SET status = 'overdue' WHERE status = 'pending' AND send_at < ?`)
      .run(now - 60_000).changes;
  }

  // ---- Smart Inbox categories -------------------------------------------------

  getCategoryOverride(accountId: string, address: string, domain: string): Category | null {
    const r = this.stmt(
        `SELECT category FROM sender_categories
         WHERE account_id = ? AND ((key = ? AND kind = 'address') OR (key = ? AND kind = 'domain'))
         ORDER BY CASE source WHEN 'user' THEN 0 ELSE 1 END, CASE kind WHEN 'address' THEN 0 ELSE 1 END
         LIMIT 1`,
      )
      .get(accountId, address, domain) as Row | undefined;
    return (r?.category as Category) ?? null;
  }

  /** Only explicit user overrides — heuristic guesses never drive label sync. */
  getUserCategoryOverride(accountId: string, address: string, domain: string): Category | null {
    const r = this.stmt(
        `SELECT category FROM sender_categories
         WHERE account_id = ? AND source = 'user'
           AND ((key = ? AND kind = 'address') OR (key = ? AND kind = 'domain'))
         ORDER BY CASE kind WHEN 'address' THEN 0 ELSE 1 END
         LIMIT 1`,
      )
      .get(accountId, address, domain) as Row | undefined;
    return (r?.category as Category) ?? null;
  }

  setSenderCategory(
    accountId: string,
    key: string,
    kind: 'address' | 'domain',
    category: Category,
    source: 'user' | 'heuristic',
  ) {
    // user rows always beat heuristics: a heuristic write never downgrades a user row
    this.stmt(
        `INSERT INTO sender_categories (account_id, key, kind, category, source, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, key, kind) DO UPDATE SET
           category = CASE WHEN sender_categories.source = 'user' AND excluded.source = 'heuristic'
                           THEN sender_categories.category ELSE excluded.category END,
           source = CASE WHEN sender_categories.source = 'user' THEN 'user' ELSE excluded.source END,
           updated_at = excluded.updated_at`,
      )
      .run(accountId, key, kind, category, source, Date.now());
  }

  /** Heuristic guesses are revisable; user rows are never touched. */
  deleteHeuristicSenderCategory(accountId: string, key: string, kind: 'address' | 'domain' = 'address') {
    this.stmt(
        `DELETE FROM sender_categories
         WHERE account_id = ? AND key = ? AND kind = ? AND source = 'heuristic'`,
      )
      .run(accountId, key, kind);
  }

  setThreadCategory(threadId: string, category: Category) {
    this.stmt(`UPDATE threads SET category = ? WHERE id = ?`).run(category, threadId);
  }

  /** The sticky-override learning loop: re-route existing threads from this sender. */
  reclassifyThreadsForSender(accountId: string, key: string, kind: 'address' | 'domain', category: Category): number {
    const pattern = kind === 'address' ? `%"${key}"%` : `%@${key}"%`;
    return this.stmt(
        `UPDATE threads SET category = ? WHERE account_id = ? AND id IN (
           SELECT DISTINCT thread_id FROM messages
           WHERE account_id = ? AND from_json LIKE ?
         )`,
      )
      .run(category, accountId, accountId, pattern).changes;
  }

  // ---- Priority senders ---------------------------------------------------------

  listPrioritySenders(accountId?: string): { accountId: string; email: string; updatedAt: number }[] {
    const rows = accountId
      ? this.stmt(`SELECT * FROM priority_senders WHERE account_id = ?`).all(accountId)
      : this.stmt(`SELECT * FROM priority_senders`).all();
    return (rows as Row[]).map((r) => ({
      accountId: r.account_id as string,
      email: r.email as string,
      updatedAt: r.updated_at as number,
    }));
  }

  /** Returns true when the row actually changed (insert or delete happened). */
  setPrioritySender(accountId: string, email: string, priority: boolean): boolean {
    const key = email.trim().toLowerCase();
    if (!key) return false;
    if (priority) {
      return (
        this.stmt(
            `INSERT INTO priority_senders (account_id, email, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(account_id, email) DO NOTHING`,
          )
          .run(accountId, key, Date.now()).changes > 0
      );
    }
    return (
      this.stmt(`DELETE FROM priority_senders WHERE account_id = ? AND email = ?`).run(accountId, key)
        .changes > 0
    );
  }

  isPrioritySender(accountId: string, email: string): boolean {
    return !!this.stmt(`SELECT 1 FROM priority_senders WHERE account_id = ? AND email = ?`)
      .get(accountId, email.trim().toLowerCase());
  }

  // ---- Label read-back helpers ---------------------------------------------------

  /** Distinct sender addresses (lowercased) of the messages in one folder. */
  senderEmailsInFolder(folderId: string): string[] {
    return (
      this.stmt(
          `SELECT DISTINCT lower(json_extract(from_json, '$.email')) AS email
           FROM messages WHERE folder_id = ? AND from_json IS NOT NULL`,
        )
        .all(folderId) as Row[]
    )
      .map((r) => r.email as string | null)
      .filter((e): e is string => !!e);
  }

  senderHasMessages(accountId: string, email: string): boolean {
    return !!this.stmt(
        `SELECT 1 FROM messages
         WHERE account_id = ? AND lower(json_extract(from_json, '$.email')) = ? LIMIT 1`,
      )
      .get(accountId, email.toLowerCase());
  }

  senderHasMessagesInFolder(folderId: string, email: string): boolean {
    return !!this.stmt(
        `SELECT 1 FROM messages
         WHERE folder_id = ? AND lower(json_extract(from_json, '$.email')) = ? LIMIT 1`,
      )
      .get(folderId, email.toLowerCase());
  }

  listUserCategoryOverrides(
    accountId: string,
  ): { key: string; kind: 'address' | 'domain'; category: Category; updatedAt: number }[] {
    return (
      this.stmt(`SELECT * FROM sender_categories WHERE account_id = ? AND source = 'user'`)
        .all(accountId) as Row[]
    ).map((r) => ({
      key: r.key as string,
      kind: r.kind as 'address' | 'domain',
      category: r.category as Category,
      updatedAt: r.updated_at as number,
    }));
  }

  getUserCategoryOverrideRow(
    accountId: string,
    address: string,
  ): { category: Category; updatedAt: number } | null {
    const r = this.stmt(
        `SELECT category, updated_at FROM sender_categories
         WHERE account_id = ? AND key = ? AND kind = 'address' AND source = 'user'`,
      )
      .get(accountId, address.toLowerCase()) as Row | undefined;
    return r ? { category: r.category as Category, updatedAt: r.updated_at as number } : null;
  }

  deleteSenderCategory(accountId: string, key: string, kind: 'address' | 'domain'): boolean {
    return (
      this.stmt(`DELETE FROM sender_categories WHERE account_id = ? AND key = ? AND kind = ?`)
        .run(accountId, key, kind).changes > 0
    );
  }

  /**
   * Reconcile thread placement with server-side folder membership (another
   * client archived / un-archived): a 'done' thread with mail back in an
   * inbox-role folder returns to 'inbox'; an 'inbox' thread whose mail now
   * lives only in archive-role folders becomes 'done'. Snoozed / set-aside
   * placements are never touched. Returns true when anything changed.
   */
  // A queued archive/snooze has already set placement locally but the server
  // copy hasn't moved yet; don't let a sync in between flip it back.
  reconcilePlacements(accountId: string): boolean {
    const toInbox = this.stmt(
        `UPDATE threads SET placement = 'inbox'
         WHERE account_id = ? AND placement = 'done' AND id IN (
           SELECT DISTINCT m.thread_id FROM messages m
           JOIN folders f ON f.id = m.folder_id
           WHERE m.account_id = ? AND f.role = 'inbox' AND m.draft = 0
         )
           AND id NOT IN (${PENDING_THREAD_MOVES})`,
      )
      .run(accountId, accountId).changes;
    const toDone = this.stmt(
        `UPDATE threads SET placement = 'done'
         WHERE account_id = ? AND placement = 'inbox'
           AND id NOT IN (
             SELECT DISTINCT m.thread_id FROM messages m
             JOIN folders f ON f.id = m.folder_id
             WHERE m.account_id = ? AND f.role = 'inbox'
           )
           AND id IN (
             SELECT DISTINCT m.thread_id FROM messages m
             JOIN folders f ON f.id = m.folder_id
             WHERE m.account_id = ? AND f.role = 'archive'
           )
           AND id NOT IN (${PENDING_THREAD_MOVES})`,
      )
      .run(accountId, accountId, accountId).changes;
    return toInbox > 0 || toDone > 0;
  }

  // ---- Gatekeeper ---------------------------------------------------------------

  getReputation(accountId: string, address: string, domain: string): GatekeeperStatus {
    const r = this.stmt(
        `SELECT status FROM sender_reputation
         WHERE account_id = ? AND ((key = ? AND kind = 'address') OR (key = ? AND kind = 'domain'))
         ORDER BY CASE status WHEN 'blocked' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END
         LIMIT 1`,
      )
      .get(accountId, address, domain) as Row | undefined;
    return (r?.status as GatekeeperStatus) ?? 'unknown';
  }

  setReputation(accountId: string, key: string, kind: 'address' | 'domain', status: GatekeeperStatus) {
    this.stmt(
        `INSERT INTO sender_reputation (account_id, key, kind, status, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(account_id, key, kind) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
      )
      .run(accountId, key, kind, status, Date.now());
  }

  listBlockedReputations(
    accountId: string,
  ): { key: string; kind: 'address' | 'domain'; updatedAt: number }[] {
    const rows = this.stmt(`SELECT key, kind, updated_at FROM sender_reputation WHERE account_id = ? AND status = 'blocked'`)
      .all(accountId) as Row[];
    return rows.map((r) => ({
      key: r.key as string,
      kind: r.kind as 'address' | 'domain',
      updatedAt: r.updated_at as number,
    }));
  }

  /** "Known" = we have ever sent mail to this address. */
  isKnownRecipient(accountId: string, email: string): boolean {
    return !!this.stmt(
        `SELECT 1 FROM messages m JOIN folders f ON m.folder_id = f.id
         WHERE m.account_id = ? AND f.role = 'sent' AND m.to_json LIKE ? LIMIT 1`,
      )
      .get(accountId, `%"${email}"%`);
  }

  listGatekeeperPending(): GatekeeperPending[] {
    const rows = this.stmt(`SELECT account_id, key, kind FROM sender_reputation WHERE status = 'pending' ORDER BY updated_at DESC`)
      .all() as Row[];
    const out: GatekeeperPending[] = [];
    for (const r of rows) {
      const threads = this.stmt(
          `SELECT DISTINCT m.thread_id, m.from_json, m.subject, m.snippet, m.date FROM messages m
           WHERE m.account_id = ? AND m.from_json LIKE ? ORDER BY m.date DESC LIMIT 20`,
        )
        .all(r.account_id, `%"${r.key}"%`) as Row[];
      if (!threads.length) continue;
      const latest = threads[0]!;
      const from = p<Address | null>(latest.from_json, null);
      out.push({
        key: r.key,
        kind: r.kind,
        accountId: r.account_id,
        senderName: from?.name || r.key,
        threadCount: threads.length,
        latestThreadId: latest.thread_id,
        latestSubject: latest.subject ?? '',
        latestSnippet: latest.snippet ?? '',
        latestDate: latest.date ?? 0,
      });
    }
    return out;
  }

  // ---- templates / signatures ------------------------------------------------

  listTemplates(): Template[] {
    return (this.stmt(`SELECT * FROM templates ORDER BY name`).all() as Row[]).map((r) => ({
      id: r.id,
      name: r.name,
      subject: r.subject,
      bodyHtml: r.body_html,
      to: p<Address[]>(r.to_json, []),
      cc: p<Address[]>(r.cc_json, []),
      bcc: p<Address[]>(r.bcc_json, []),
    }));
  }

  saveTemplate(t: Template) {
    this.stmt(
        `INSERT INTO templates (id, name, subject, body_html, to_json, cc_json, bcc_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, subject = excluded.subject,
           body_html = excluded.body_html, to_json = excluded.to_json, cc_json = excluded.cc_json,
           bcc_json = excluded.bcc_json, updated_at = excluded.updated_at`,
      )
      .run(t.id, t.name, t.subject, t.bodyHtml, j(t.to), j(t.cc), j(t.bcc), Date.now());
  }

  deleteTemplate(id: string) {
    this.stmt(`DELETE FROM templates WHERE id = ?`).run(id);
  }

  /** Stored events (local + synced) overlapping [startMs, endMs), plus any
   *  recurring series that began before endMs — the renderer expands those.
   *  Events on hidden calendars are excluded. */
  listEvents(startMs: number, endMs: number): CalendarEvent[] {
    const rows = this.stmt(
        `SELECT e.*, c.account_id AS cal_account_id FROM events e
           JOIN calendars c ON c.id = e.calendar_id
         WHERE c.visible = 1
           AND ((e.start_ms < ? AND e.end_ms > ?) OR (e.rrule IS NOT NULL AND e.start_ms < ?))
         ORDER BY e.start_ms`,
      )
      .all(endMs, startMs, endMs) as Row[];
    return rows.map((r) => ({
      ...rowToEvent(r),
      accountId: (r.cal_account_id as string) || undefined,
    }));
  }

  /** Create (no id) or update a local event; returns the row id. */
  upsertEvent(input: CalendarEventInput): string {
    const id = input.id ?? randomUUID();
    this.stmt(
        `INSERT INTO events
           (id, calendar_id, source, title, description, location, start_ms, end_ms,
            all_day, color, status, meeting_url, event_type, rrule, transparency, updated_at)
         VALUES (?, ?, 'local', ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title, description = excluded.description,
           location = excluded.location, start_ms = excluded.start_ms,
           end_ms = excluded.end_ms, all_day = excluded.all_day, color = excluded.color,
           meeting_url = excluded.meeting_url, event_type = excluded.event_type,
           rrule = excluded.rrule, transparency = excluded.transparency,
           updated_at = excluded.updated_at`,
      )
      .run(
        id,
        input.calendarId ?? 'local-default',
        input.title,
        input.description ?? '',
        input.location ?? '',
        input.startMs,
        input.endMs,
        input.allDay ? 1 : 0,
        input.color ?? null,
        input.meetingUrl ?? null,
        input.eventType ?? 'default',
        input.rrule ?? null,
        input.transparency === 'transparent' ? 'transparent' : null,
        Date.now(),
      );
    return id;
  }

  /** Delete a local event (Google/Notion sources are not user-deletable here). */
  deleteEvent(id: string) {
    this.stmt(`DELETE FROM events WHERE id = ? AND source = 'local'`).run(id);
  }

  /** Sync coordinates of one stored event, for the Google write-back path. */
  getEventSync(id: string): { source: string; remoteId?: string; calendarId: string } | null {
    const r = this.stmt(`SELECT source, remote_id, calendar_id FROM events WHERE id = ?`)
      .get(id) as Row | undefined;
    if (!r) return null;
    return {
      source: r.source as string,
      remoteId: (r.remote_id as string) || undefined,
      calendarId: r.calendar_id as string,
    };
  }

  /**
   * Partial in-place update (drag reschedule / Google edit): times always,
   * text fields and transparency only when provided. Unlike upsertEvent this
   * never touches `source`, so Google rows stay Google rows.
   */
  patchEvent(
    id: string,
    p: {
      startMs: number;
      endMs: number;
      allDay: boolean;
      title?: string;
      location?: string;
      description?: string;
      transparency?: 'opaque' | 'transparent';
    },
  ) {
    this.stmt(
        `UPDATE events SET
           start_ms = ?, end_ms = ?, all_day = ?,
           title = COALESCE(?, title),
           location = COALESCE(?, location),
           description = COALESCE(?, description),
           transparency = CASE WHEN ? = 1 THEN ? ELSE transparency END,
           updated_at = ?
         WHERE id = ?`,
      )
      .run(
        p.startMs,
        p.endMs,
        p.allDay ? 1 : 0,
        p.title ?? null,
        p.location ?? null,
        p.description ?? null,
        p.transparency !== undefined ? 1 : 0,
        p.transparency === 'transparent' ? 'transparent' : null,
        Date.now(),
        id,
      );
  }

  listCalendars(): Calendar[] {
    return (this.stmt(`SELECT * FROM calendars ORDER BY name`).all() as Row[]).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      color: r.color as string,
      source: r.source as 'local' | 'google',
      visible: !!r.visible,
      accountId: (r.account_id as string) || undefined,
    }));
  }

  setCalendarVisible(id: string, visible: boolean) {
    this.stmt(`UPDATE calendars SET visible = ?, updated_at = ? WHERE id = ?`)
      .run(visible ? 1 : 0, Date.now(), id);
  }

  /** Row fields the sync worker needs to reach a calendar's Google counterpart. */
  getCalendarSync(id: string): { accountId?: string; remoteId?: string; source: string } | null {
    const r = this.stmt(`SELECT account_id, remote_id, source FROM calendars WHERE id = ?`)
      .get(id) as Row | undefined;
    if (!r) return null;
    return {
      accountId: (r.account_id as string) || undefined,
      remoteId: (r.remote_id as string) || undefined,
      source: r.source as string,
    };
  }

  /** Remove a calendar and its events (events cascade via calendar_id). */
  deleteCalendar(id: string) {
    this.stmt(`DELETE FROM calendars WHERE id = ?`).run(id);
  }

  /**
   * Reconcile one Google calendar into `calendars`. The primary calendar rides
   * the account's `acct:` row (name kept — it's the account label); other
   * calendars take Google's name/color. `visible` is only set on first insert
   * so the sidebar eye toggles survive re-syncs.
   */
  upsertGoogleCalendar(c: {
    id: string;
    accountId: string;
    remoteId: string;
    name: string;
    color: string;
    visible: boolean;
    primary: boolean;
  }) {
    this.stmt(
        `INSERT INTO calendars (id, account_id, remote_id, name, color, source, visible, updated_at)
         VALUES (?, ?, ?, ?, ?, 'google', ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           remote_id = excluded.remote_id,
           color = excluded.color,
           name = CASE WHEN ? THEN calendars.name ELSE excluded.name END,
           updated_at = excluded.updated_at`,
      )
      .run(c.id, c.accountId, c.remoteId, c.name, c.color, c.visible ? 1 : 0, Date.now(), c.primary ? 1 : 0);
  }

  /** Upsert one synced Google event instance (id 'gev:<calendarId>:<remoteId>'). */
  upsertGoogleEvent(e: {
    id: string;
    calendarId: string;
    remoteId: string;
    title: string;
    description: string;
    location: string;
    startMs: number;
    endMs: number;
    allDay: boolean;
    eventType: 'default' | 'outOfOffice';
    meetingUrl?: string;
    color?: string;
    transparency?: 'opaque' | 'transparent';
  }) {
    this.stmt(
        `INSERT INTO events
           (id, calendar_id, source, remote_id, title, description, location, start_ms, end_ms,
            all_day, color, status, meeting_url, updated_at, event_type, transparency)
         VALUES (?, ?, 'google', ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title, description = excluded.description,
           location = excluded.location, start_ms = excluded.start_ms,
           end_ms = excluded.end_ms, all_day = excluded.all_day, color = excluded.color,
           meeting_url = excluded.meeting_url, event_type = excluded.event_type,
           transparency = excluded.transparency, updated_at = excluded.updated_at`,
      )
      .run(
        e.id,
        e.calendarId,
        e.remoteId,
        e.title,
        e.description,
        e.location,
        e.startMs,
        e.endMs,
        e.allDay ? 1 : 0,
        e.color ?? null,
        e.meetingUrl ?? null,
        Date.now(),
        e.eventType,
        e.transparency === 'transparent' ? 'transparent' : null,
      );
  }

  /**
   * Drop Google rows in the sync window that the latest fetch didn't return —
   * that's how deletions and de-shares propagate. Local events are untouched.
   */
  pruneGoogleEvents(calendarId: string, windowStart: number, windowEnd: number, seenRemoteIds: string[]) {
    this.stmt(
        `DELETE FROM events
         WHERE calendar_id = ? AND source = 'google'
           AND start_ms < ? AND end_ms > ?
           AND remote_id NOT IN (SELECT value FROM json_each(?))`,
      )
      .run(calendarId, windowEnd, windowStart, JSON.stringify(seenRemoteIds));
  }

  /** Google incremental-sync cursor, stored with its mint time so stale windows can be re-based. */
  getCalendarSyncToken(id: string): { token: string; at: number } | null {
    const r = this.stmt(`SELECT sync_token FROM calendars WHERE id = ?`).get(id) as
      | { sync_token: string | null }
      | undefined;
    if (!r?.sync_token) return null;
    try {
      const parsed = JSON.parse(r.sync_token) as { t?: string; at?: number };
      return parsed.t ? { token: parsed.t, at: parsed.at ?? 0 } : null;
    } catch {
      return null;
    }
  }

  setCalendarSyncToken(id: string, token: string | null) {
    this.stmt(`UPDATE calendars SET sync_token = ? WHERE id = ?`)
      .run(token ? JSON.stringify({ t: token, at: Date.now() }) : null, id);
  }

  deleteGoogleEventByRemoteId(calendarId: string, remoteId: string) {
    this.stmt(`DELETE FROM events WHERE calendar_id = ? AND source = 'google' AND remote_id = ?`)
      .run(calendarId, remoteId);
  }

  /** Lazily give a mail account its own local calendar (id 'acct:<accountId>'). */
  ensureAccountCalendar(accountId: string, name: string) {
    this.stmt(
        `INSERT OR IGNORE INTO calendars (id, account_id, name, color, source, visible, updated_at)
         VALUES (?, ?, ?, '#2f63e7', 'local', 1, ?)`,
      )
      .run(`acct:${accountId}`, accountId, name, Date.now());
  }

  listSignatures(): Signature[] {
    return (this.stmt(`SELECT * FROM signatures ORDER BY name`).all() as Row[]).map((r) => ({
      id: r.id,
      name: r.name,
      bodyHtml: r.body_html,
    }));
  }

  saveSignature(s: Signature) {
    this.stmt(
        `INSERT INTO signatures (id, name, body_html, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, body_html = excluded.body_html,
           updated_at = excluded.updated_at`,
      )
      .run(s.id, s.name, s.bodyHtml, Date.now());
  }

  searchThreads(q: {
    /** FTS5 match expression (subject/from_text/body); null = filters only. */
    fts: string | null;
    /** Substring filter over recipients (the To field isn't FTS-indexed). */
    toLike?: string | null;
    hasAttachment?: boolean;
    /** Restrict to one account, matching the sidebar's account focus. */
    accountId?: string;
    limit?: number;
  }): ThreadSummary[] {
    const conds: string[] = [];
    const condParams: unknown[] = [];
    if (q.hasAttachment) conds.push(`t.has_attachments = 1`);
    if (q.accountId) {
      conds.push(`t.account_id = ?`);
      condParams.push(q.accountId);
    }
    if (q.toLike) {
      conds.push(
        `EXISTS (SELECT 1 FROM messages mt WHERE mt.thread_id = t.id AND lower(mt.to_json) LIKE ?)`,
      );
      condParams.push(`%${q.toLike}%`);
    }
    const rows = q.fts
      ? (this.stmt(
            `SELECT t.*, min(rank) AS best_rank FROM messages_fts
             JOIN messages m ON m.rowid = messages_fts.rowid
             JOIN threads t ON t.id = m.thread_id
             WHERE messages_fts MATCH ?${conds.map((c) => ` AND ${c}`).join('')}
             GROUP BY t.id
             ORDER BY best_rank
             LIMIT ?`,
          )
          .all(q.fts, ...condParams, q.limit ?? 50) as Row[])
      : conds.length
        ? (this.stmt(
              `SELECT t.* FROM threads t
               WHERE ${conds.join(' AND ')}
               ORDER BY t.last_message_date DESC
               LIMIT ?`,
            )
            .all(...condParams, q.limit ?? 50) as Row[])
        : [];
    return rows.map(rowToThreadSummary);
  }

  /**
   * Address autocomplete: every address seen in mail (senders + recipients),
   * matched on email or name, ranked by how often and how recently it appears.
   */
  suggestContacts(q: string, limit = 8): Address[] {
    const like = `%${q}%`;
    const rows = this.stmt(
        `WITH addrs AS (
           SELECT lower(json_extract(m.from_json, '$.email')) AS email,
                  json_extract(m.from_json, '$.name') AS name, m.date AS date
             FROM messages m WHERE m.from_json IS NOT NULL
           UNION ALL
           SELECT lower(json_extract(j.value, '$.email')), json_extract(j.value, '$.name'), m.date
             FROM messages m, json_each(m.to_json) j
           UNION ALL
           SELECT lower(json_extract(j.value, '$.email')), json_extract(j.value, '$.name'), m.date
             FROM messages m, json_each(m.cc_json) j
         )
         SELECT email,
                coalesce(max(CASE WHEN name IS NOT NULL AND name != '' THEN name END), '') AS name,
                count(*) AS uses, max(date) AS last
           FROM addrs
          WHERE email IS NOT NULL AND email LIKE '%@%'
          GROUP BY email
         HAVING email LIKE ? OR lower(name) LIKE ?
          ORDER BY uses DESC, last DESC
          LIMIT ?`,
      )
      .all(like, like, limit) as Row[];
    return rows.map((r) => ({
      email: r.email as string,
      name: (r.name as string) || undefined,
    }));
  }

  // ---- bodies / attachments -------------------------------------------------

  upsertBody(messageId: string, html: string | null, text: string | null) {
    this.stmt(
        `INSERT INTO message_bodies (message_id, html, text, fetched_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(message_id) DO UPDATE SET html = excluded.html, text = excluded.text,
                                               fetched_at = excluded.fetched_at`,
      )
      .run(messageId, html, text, Date.now());
  }

  hasBody(messageId: string): boolean {
    return !!this.stmt(`SELECT 1 FROM message_bodies WHERE message_id = ?`).get(messageId);
  }

  getBody(messageId: string): MessageBodyPayload | null {
    const r = this.stmt(`SELECT * FROM message_bodies WHERE message_id = ?`).get(messageId) as
      | Row
      | undefined;
    if (!r) return null;
    return {
      messageId,
      html: r.html,
      text: r.text,
      attachments: this.listAttachments(messageId),
    };
  }

  insertAttachment(a: AttachmentMeta) {
    this.stmt(
        `INSERT INTO attachments (id, message_id, filename, content_type, size, cid, local_path)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(a.id, a.messageId, a.filename, a.contentType, a.size, a.cid, a.localPath);
  }

  listAttachments(messageId: string): AttachmentMeta[] {
    return (
      this.stmt(`SELECT * FROM attachments WHERE message_id = ?`).all(messageId) as Row[]
    ).map((r) => ({
      id: r.id,
      messageId: r.message_id,
      filename: r.filename,
      contentType: r.content_type,
      size: r.size,
      cid: r.cid,
      localPath: r.local_path,
    }));
  }

  clearAttachments(messageId: string) {
    this.stmt(`DELETE FROM attachments WHERE message_id = ?`).run(messageId);
  }

  // ---- task queue -----------------------------------------------------------

  enqueueTask(task: Task): number {
    const now = Date.now();
    const info = this.stmt(
        `INSERT INTO tasks (type, payload_json, status, created_at, updated_at)
         VALUES (?, ?, 'pending', ?, ?)`,
      )
      .run(task.type, j(task), now, now);
    return Number(info.lastInsertRowid);
  }

  claimNextTask(): TaskRow | null {
    const r = this.stmt(`SELECT * FROM tasks WHERE status = 'pending' ORDER BY id LIMIT 1`)
      .get() as Row | undefined;
    if (!r) return null;
    this.stmt(`UPDATE tasks SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?`)
      .run(Date.now(), r.id);
    return {
      id: r.id,
      type: r.type,
      payload: p<Task>(r.payload_json, { type: 'sync-now' }),
      status: 'running',
      attempts: r.attempts + 1,
      lastError: r.last_error,
      createdAt: r.created_at,
    };
  }

  finishTask(id: number, status: Extract<TaskStatus, 'done' | 'failed' | 'pending'>, error?: string) {
    this.stmt(`UPDATE tasks SET status = ?, last_error = ?, updated_at = ? WHERE id = ?`)
      .run(status, error ?? null, Date.now(), id);
  }

  /** Crash recovery: anything left 'running' from a previous run goes back to pending. */
  resetRunningTasks() {
    this.stmt(`UPDATE tasks SET status = 'pending' WHERE status = 'running'`).run();
  }

  /**
   * Drop settled tasks older than the cutoff. Send tasks carry their whole raw
   * MIME in payload_json, so a queue that is never trimmed becomes the largest
   * table in the database.
   */
  purgeSettledTasks(olderThan: number): number {
    return this.stmt(`DELETE FROM tasks WHERE status IN ('done', 'failed') AND updated_at < ?`)
      .run(olderThan).changes;
  }

  // ---- settings ---------------------------------------------------------------

  getSetting(key: string): unknown {
    const r = this.stmt(`SELECT value_json FROM settings WHERE key = ?`).get(key) as
      | Row
      | undefined;
    return r ? p(r.value_json, null) : null;
  }

  setSetting(key: string, value: unknown) {
    this.stmt(
        `INSERT INTO settings (key, value_json) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
      )
      .run(key, j(value));
  }
}

export function openDatabase(path: string): MailDb {
  return new MailDb(path);
}
