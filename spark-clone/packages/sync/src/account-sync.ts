import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MailDb } from '@app/db';
import type { Account, DeltaEvent, Folder, FolderRole, MessageMeta } from '@app/shared';
import {
  appFolderPath,
  CATEGORY_LABELS,
  categoryLabelName,
  isAppFolder,
  isAppNamespacePath,
  isGmailAccount,
  isMirrorFolder,
  LEGACY_APP_NAMESPACE,
  mapFolderRole,
} from './folders';
import {
  countRecipients,
  ingestEnvelope,
  parseHeaderMap,
  runNewMessageHook,
  structureHasCalendar,
  updateSnippetFromBody,
  type FetchedEnvelope,
} from './ingest';
import { shouldSkipFolderSync, type FolderStatusSnapshot } from './poll-policy';
import { newId } from './util';

const BACKFILL_MONTHS = 3;
const FETCH_CHUNK = 100;
const HYDRATE_RECENT = 60;
// IDLE pushes INBOX changes; the poll is the safety net for the other folders,
// and unchanged folders skip their pass entirely (see poll-policy.ts).
const POLL_INTERVAL_MS = 5 * 60_000;
const RECONNECT_BASE_MS = 2_000;

export interface SyncEmitter {
  (event: DeltaEvent): void;
}

function backfillSince(): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - BACKFILL_MONTHS);
  return d;
}

function safeFilename(name: string): string {
  const cleaned = name.replace(/[/\\:\0]/g, '_').slice(0, 120);
  return cleaned || 'attachment';
}

export class AccountSync {
  private client: ImapFlow | null = null;
  private stopped = false;
  private backfilled = false;
  private reconnectAttempts = 0;
  private pollTimer: NodeJS.Timeout | null = null;
  private inboxSyncQueued = false;
  private syncingAll = false;
  /** Last STATUS-equivalent snapshot per folder — the poll skip fast-path. */
  private readonly folderStatus = new Map<string, FolderStatusSnapshot>();
  private readonly folderFullSyncAt = new Map<string, number>();
  private connected = false;
  private connectedWaiters: Array<(ok: boolean) => void> = [];

  constructor(
    private readonly db: MailDb,
    readonly account: Account,
    /** Returns the password, or a fresh access token for OAuth accounts. */
    private readonly getSecret: () => Promise<string>,
    private readonly attachmentsDir: string,
    private readonly emit: SyncEmitter,
  ) {}

  private status(state: 'connecting' | 'backfilling' | 'idle' | 'syncing' | 'error', detail?: string) {
    this.emit({ kind: 'sync-status', status: { accountId: this.account.id, state, detail } });
  }

  async start(): Promise<void> {
    this.stopped = false;
    void this.runLoop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.connected = false;
    const waiters = this.connectedWaiters;
    this.connectedWaiters = [];
    for (const w of waiters) w(false);
    if (this.pollTimer) clearTimeout(this.pollTimer);
    try {
      await this.client?.logout();
    } catch {
      /* closing */
    }
    this.client = null;
  }

  private async runLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        this.status('connecting');
        // Operations hung on the previous (dead) client can leave these
        // guards stuck true forever — imapflow mailbox-lock waiters don't
        // always reject when the socket dies — which would silently disable
        // sync and IDLE reparking on the fresh connection.
        this.syncingAll = false;
        this.reparking = false;
        await this.connect();
        this.reconnectAttempts = 0;
        // One-time server-side namespace migration (SparkClone/* → Uniox/*,
        // Gmail "Archive" label → Uniox/Archive). Idempotent no-op afterwards.
        await this.migrateLegacyAppFolders();
        // The client is usable and the folder list is synced; release any
        // work (e.g. on-demand body fetches) that was waiting to connect.
        this.setConnected(true);
        await this.syncAllFolders();
        this.schedulePoll();
        // Park on INBOX so IDLE notifies us of new mail / flag changes.
        this.repark();
        this.status('idle');
        await this.waitForDisconnect();
      } catch (err) {
        if (this.stopped) return;
        const message = err instanceof Error ? err.message : String(err);
        // stdio is inherited from the main process: surface loop failures in
        // the dev terminal, not just as a sidebar status blip.
        console.error(`[sync] ${this.account.email} loop error:`, message);
        this.status('error', message);
      } finally {
        this.setConnected(false);
        // Tear the client down on every exit path. An abandoned-but-open
        // connection leaks a server session per reconnect attempt until the
        // per-user cap kills live sync entirely; closing also settles any
        // commands still queued on the dead socket.
        try {
          this.client?.close();
        } catch {
          /* already gone */
        }
        this.client = null;
      }
      if (this.stopped) return;
      this.reconnectAttempts += 1;
      const delay = Math.min(60_000, RECONNECT_BASE_MS * 2 ** Math.min(this.reconnectAttempts, 5));
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  /**
   * On-demand fetches (a body the reader is waiting on) can be requested
   * before the account has finished connecting. Rather than failing — which
   * left the message stuck on "Loading message…" — callers await this gate so
   * the fetch runs the moment the connection is live. Resolves false on
   * timeout / shutdown so the caller can retry.
   */
  whenConnected(timeoutMs = 25_000): Promise<boolean> {
    if (this.connected && this.client?.usable) return Promise.resolve(true);
    if (this.stopped) return Promise.resolve(false);
    return new Promise((resolve) => {
      const waiter = (ok: boolean) => {
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => {
        this.connectedWaiters = this.connectedWaiters.filter((w) => w !== waiter);
        resolve(false);
      }, timeoutMs);
      this.connectedWaiters.push(waiter);
    });
  }

  private setConnected(value: boolean): void {
    this.connected = value;
    if (!value) return;
    const waiters = this.connectedWaiters;
    this.connectedWaiters = [];
    for (const w of waiters) w(true);
  }

  private waitForDisconnect(): Promise<void> {
    const client = this.client;
    // If the socket already died mid-sync, 'close' has fired and a new
    // listener would wait forever — the account would never reconnect.
    if (!client || !client.usable) return Promise.resolve();
    return new Promise((resolve) => {
      client.once('close', () => resolve());
    });
  }

  private async connect(): Promise<void> {
    const { imap } = this.account;
    const secret = await this.getSecret();
    const client = new ImapFlow({
      host: imap.host,
      port: imap.port,
      secure: imap.secure,
      auth:
        this.account.authType === 'oauth-google'
          ? { user: this.account.email, accessToken: secret }
          : { user: this.account.email, pass: secret },
      tls: imap.allowInsecureTls ? { rejectUnauthorized: false } : undefined,
      logger: false,
    });
    client.on('error', () => {
      /* surfaces via close */
    });
    client.on('exists', () => this.queueInboxSync());
    client.on('expunge', () => this.queueInboxSync());
    client.on('flags', () => this.queueInboxSync());
    await client.connect();
    if (this.stopped) {
      // stop() ran while we were logging in: it had no client to close.
      client.close();
      throw new Error('stopped');
    }
    this.client = client;
    await this.syncFolderList();
  }

  /**
   * Move app-managed folders to the current namespace: `SparkClone/<x>` →
   * `Uniox/<x>` (pre-rebrand labels) and, on Gmail, the legacy top-level
   * `Archive` label → `Uniox/Archive`. RENAME preserves messages server-side
   * (RFC 3501 creates missing parents); the DB row keeps its id so local
   * message rows survive. Falls back to create+move+delete when a rename is
   * refused (e.g. target already exists from an interrupted earlier run).
   * Runs on every connect; with no legacy folders present it is a no-op.
   */
  private async migrateLegacyAppFolders(): Promise<void> {
    const client = this.client;
    if (!client) return;
    const folders = this.db.listFolders(this.account.id);
    const delimiter = folders.find((f) => f.delimiter)?.delimiter ?? '/';
    const legacyPrefix = `${LEGACY_APP_NAMESPACE}${delimiter}`;
    const renames: { folder: Folder; to: string }[] = [];
    for (const f of folders) {
      if (f.path.startsWith(legacyPrefix)) {
        renames.push({ folder: f, to: appFolderPath(f.path.slice(legacyPrefix.length), delimiter) });
      } else if (f.path === 'Archive' && f.role === 'archive' && isGmailAccount(this.account)) {
        renames.push({ folder: f, to: appFolderPath('Archive', delimiter) });
      }
    }
    if (!renames.length) return;
    for (const { folder, to } of renames) {
      try {
        await client.mailboxRename(folder.path, to);
        this.db.renameFolderPath(folder.id, to);
      } catch {
        // Rename refused — e.g. the target exists from a partial migration.
        // Move the messages across and drop the stale source instead.
        try {
          try {
            await client.mailboxCreate(to);
          } catch {
            /* exists */
          }
          const lock = await client.getMailboxLock(folder.path);
          try {
            const mailbox = client.mailbox;
            if (mailbox && typeof mailbox !== 'boolean' && mailbox.exists > 0) {
              await client.messageMove('1:*', to);
            }
          } finally {
            lock.release();
          }
          await client.mailboxDelete(folder.path);
          // Local rows for the source folder are stale (moved server-side with
          // unknown new uids); drop them — the target folder re-syncs them in.
          const target = this.db.getFolderByPath(this.account.id, to);
          for (const tid of this.db.deleteFolder(folder.id)) this.db.refreshThreadAggregates(tid);
          if (!target) {
            this.db.upsertFolder({
              id: newId(),
              accountId: this.account.id,
              path: to,
              role: folder.role,
              delimiter,
            });
          }
        } catch {
          // Leave the legacy folder in place; isAppNamespacePath still
          // recognizes it, so features keep working until the next attempt.
          this.status('error', `could not migrate folder ${folder.path}`);
        }
      }
    }
    // A bare legacy parent left behind ("SparkClone") serves no purpose.
    const parent = this.db.getFolderByPath(this.account.id, LEGACY_APP_NAMESPACE);
    if (parent) {
      try {
        await client.mailboxDelete(parent.path);
        this.db.deleteFolder(parent.id);
      } catch {
        /* non-empty or refused — harmless */
      }
    }
    this.repark();
  }

  /** Set across system sleep: no poll re-arm, no IDLE-triggered syncs. */
  private paused = false;

  /** Sleep: stop the poll timer (the IMAP socket dies on its own; the run loop reconnects). */
  pause(): void {
    this.paused = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (this.client?.usable) {
      void this.syncAllFolders().catch(() => this.status('error', 'resume sync failed'));
      this.schedulePoll();
    }
    // Not connected: the reconnect loop is already driving recovery.
  }

  /** Manual refresh: a full folder pass now (a pass already running wins). */
  refreshNow(): void {
    if (this.paused || this.stopped || !this.client?.usable) return;
    void this.syncAllFolders().catch(() => this.status('error', 'refresh failed'));
  }

  private queueInboxSync(): void {
    if (this.inboxSyncQueued || this.stopped || this.paused) return;
    this.inboxSyncQueued = true;
    setTimeout(() => {
      this.inboxSyncQueued = false;
      const inbox = this.db.getFolderByRole(this.account.id, 'inbox');
      if (inbox) {
        void this.syncFolder(inbox)
          .then(() => this.repark())
          .catch(() => this.status('error', 'inbox sync failed'));
      }
    }, 400);
  }

  private schedulePoll(): void {
    if (this.paused) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => {
      if (this.stopped || !this.client) return;
      void this.syncAllFolders()
        .then(() => {
          this.schedulePoll();
          this.repark();
        })
        .catch(() => this.schedulePoll());
    }, POLL_INTERVAL_MS);
  }

  private async syncFolderList(): Promise<void> {
    const listed = await this.client!.list();
    const purgedThreads = new Set<string>();
    // Folder rows the server no longer has (deleted by another client, or a
    // half-finished namespace migration) must go: SELECTing a nonexistent
    // mailbox throws and aborts the whole sync loop, every reconnect, forever.
    const listedPaths = new Set(listed.map((b) => b.path));
    for (const f of this.db.listFolders(this.account.id)) {
      if (!listedPaths.has(f.path)) {
        for (const tid of this.db.deleteFolder(f.id)) purgedThreads.add(tid);
      }
    }
    for (const box of listed) {
      if (box.flags?.has('\\Noselect')) continue;
      // Gmail virtual folders duplicate every message (All Mail) or mirror
      // flags (Important/Starred) — never sync them (report §5.2). If a prior
      // run stored one (the old check missed \Important/\Starred), purge it and
      // its duplicate message rows now.
      if (isMirrorFolder(box)) {
        const stale = this.db.getFolderByPath(this.account.id, box.path);
        if (stale) for (const tid of this.db.deleteFolder(stale.id)) purgedThreads.add(tid);
        continue;
      }
      const existing = this.db.getFolderByPath(this.account.id, box.path);
      this.db.upsertFolder({
        id: existing?.id ?? newId(),
        accountId: this.account.id,
        path: box.path,
        role: mapFolderRole(box),
        delimiter: box.delimiter ?? null,
      });
    }
    if (purgedThreads.size) {
      this.db.transaction(() => {
        for (const tid of purgedThreads) this.db.refreshThreadAggregates(tid);
      });
      this.emit({ kind: 'threads-changed', accountIds: [this.account.id] });
    }
  }

  async syncAllFolders(): Promise<void> {
    if (this.syncingAll || !this.client) return;
    this.syncingAll = true;
    try {
      this.status(this.backfilled ? 'syncing' : 'backfilling');
      const folders = this.db.listFolders(this.account.id);
      folders.sort((a, b) => (a.role === 'inbox' ? -1 : b.role === 'inbox' ? 1 : 0));
      let anyChanged = !this.backfilled;
      for (const folder of folders) {
        if (this.stopped) return;
        // One bad folder must not strand the folders queued behind it, nor
        // skip the hydrate/reconcile tail below.
        try {
          if (await this.syncFolder(folder)) anyChanged = true;
        } catch (err) {
          console.error(`[sync] folder ${folder.path} failed:`, err);
        }
      }
      this.backfilled = true;
      // Snippet hydration and label read-back only find work after a folder
      // actually changed; quiet ticks skip both scans (with a slow heartbeat
      // in case a change slipped past the fast-path).
      const overdue = Date.now() - this.lastReconcileAt > AccountSync.RECONCILE_HEARTBEAT_MS;
      if (anyChanged || overdue) {
        await this.hydrateRecentBodies();
        this.reconcileServerState();
        this.lastReconcileAt = Date.now();
      }
      this.status('idle');
    } finally {
      this.syncingAll = false;
    }
  }

  /** Local changes newer than this are trusted over server label membership —
   *  their push tasks may simply not have landed yet. */
  private static readonly RECONCILE_GRACE_MS = 10 * 60_000;
  private lastReconcileAt = 0;
  private static readonly RECONCILE_HEARTBEAT_MS = 30 * 60_000;

  /**
   * Bidirectional read-back (Gmail only): Uniox/* label membership is the
   * source of truth for priority senders, user category overrides, and
   * archive placement. After every full sync, fold what the server says back
   * into the local tables so changes made in Gmail web / another client
   * appear here. Pure DB work — no IMAP calls.
   */
  private reconcileServerState(): void {
    if (!isGmailAccount(this.account)) return;
    const accountId = this.account.id;
    const now = Date.now();
    const grace = AccountSync.RECONCILE_GRACE_MS;
    const folders = this.db.listFolders(accountId);
    const byName = (name: string) => folders.find((f) => isAppFolder(f.path, name));
    let changed = false;

    // Priority senders ⇄ Uniox/Priority membership.
    const priority = byName('Priority');
    if (priority) {
      const labeled = new Set(this.db.senderEmailsInFolder(priority.id));
      for (const email of labeled) {
        if (!this.db.isPrioritySender(accountId, email)) {
          this.db.setPrioritySender(accountId, email, true);
          changed = true;
        }
      }
      for (const row of this.db.listPrioritySenders(accountId)) {
        if (labeled.has(row.email)) continue;
        if (now - row.updatedAt < grace) continue; // our push may still be in flight
        // A sender with no synced mail has no membership to read — leave them.
        if (!this.db.senderHasMessages(accountId, row.email)) continue;
        this.db.setPrioritySender(accountId, row.email, false);
        changed = true;
      }
    }

    // User category overrides ⇄ Uniox/<Category> membership (address kind —
    // domain-wide overrides cannot be inferred from per-message labels).
    for (const [cat, name] of Object.entries(CATEGORY_LABELS) as [
      keyof typeof CATEGORY_LABELS,
      string,
    ][]) {
      const folder = byName(name);
      if (!folder) continue;
      for (const email of this.db.senderEmailsInFolder(folder.id)) {
        const row = this.db.getUserCategoryOverrideRow(accountId, email);
        if (row?.category === cat) continue;
        if (row && now - row.updatedAt < grace) continue; // fresh local change wins
        this.db.setSenderCategory(accountId, email, 'address', cat, 'user');
        this.db.reclassifyThreadsForSender(accountId, email, 'address', cat);
        changed = true;
      }
    }
    for (const row of this.db.listUserCategoryOverrides(accountId)) {
      if (row.kind !== 'address') continue;
      const labelName = categoryLabelName(row.category);
      if (!labelName) continue; // 'personal' has no label to read back
      const folder = byName(labelName);
      if (!folder) continue;
      if (now - row.updatedAt < grace) continue;
      if (this.db.senderHasMessagesInFolder(folder.id, row.key)) continue;
      if (!this.db.senderHasMessages(accountId, row.key)) continue;
      // Label gone server-side: the override was withdrawn on another client.
      this.db.deleteSenderCategory(accountId, row.key, 'address');
      changed = true;
    }

    // Gatekeeper blocks ⇄ Uniox/Blocked membership (address kind — a domain
    // block labels its messages, but per-message labels only read back as
    // per-address blocks, same limitation as domain category overrides).
    const blockedFolder = byName('Blocked');
    if (blockedFolder) {
      const labeled = new Set(this.db.senderEmailsInFolder(blockedFolder.id));
      for (const email of labeled) {
        const domain = email.split('@')[1] ?? '';
        if (this.db.getReputation(accountId, email, domain) !== 'blocked') {
          this.db.setReputation(accountId, email, 'address', 'blocked');
          changed = true;
        }
      }
      for (const row of this.db.listBlockedReputations(accountId)) {
        if (row.kind !== 'address') continue;
        if (labeled.has(row.key)) continue;
        if (now - row.updatedAt < grace) continue; // our push may still be in flight
        if (!this.db.senderHasMessages(accountId, row.key)) continue;
        // Label gone server-side: the sender was unblocked on another client.
        this.db.setReputation(accountId, row.key, 'address', 'accepted');
        changed = true;
      }
    }

    // Archive placement ⇄ inbox/archive folder membership.
    if (this.db.reconcilePlacements(accountId)) changed = true;

    if (changed) this.emit({ kind: 'threads-changed', accountIds: [accountId] });
  }

  /** Returns true when a full pass ran and touched something. */
  async syncFolder(folder: Folder): Promise<boolean> {
    const client = this.client;
    if (!client) return false;
    const lock = await client.getMailboxLock(folder.path);
    const touchedThreads = new Set<string>();
    const notifications: { threadId: string; messageId: string }[] = [];
    try {
      const mailbox = client.mailbox;
      if (!mailbox || typeof mailbox === 'boolean') return false;
      const cursor = this.db.getFolderCursor(folder.id);
      const uidValidity = Number(mailbox.uidValidity ?? 0);
      if (cursor.uidvalidity !== null && cursor.uidvalidity !== uidValidity) {
        for (const tid of this.db.clearFolderMessages(folder.id)) this.db.refreshThreadAggregates(tid);
        this.folderStatus.delete(folder.id);
        this.folderFullSyncAt.delete(folder.id);
      }

      const status: FolderStatusSnapshot = {
        uidValidity,
        uidNext: Number(mailbox.uidNext ?? 0),
        exists: mailbox.exists ?? 0,
        modseq: mailbox.highestModseq ? String(mailbox.highestModseq) : null,
      };
      const hasCondstore = !!client.capabilities?.has('CONDSTORE');
      if (
        shouldSkipFolderSync({
          cursorUidValidity: cursor.uidvalidity,
          prev: this.folderStatus.get(folder.id) ?? null,
          now: status,
          hasCondstore,
          msSinceFullSync: Date.now() - (this.folderFullSyncAt.get(folder.id) ?? 0),
        })
      ) {
        return false;
      }

      const serverUids = new Set(await client.search({ since: backfillSince() }, { uid: true }) || []);
      const localUids = new Set(this.db.messageUidsInFolder(folder.id));

      // Deletions (or fell out of the window)
      const gone = [...localUids].filter((u) => !serverUids.has(u));
      if (gone.length) {
        for (const tid of this.db.deleteMessagesByUids(folder.id, gone)) touchedThreads.add(tid);
      }

      // New messages, newest first
      const fresh = [...serverUids].filter((u) => !localUids.has(u)).sort((a, b) => b - a);
      for (let i = 0; i < fresh.length; i += FETCH_CHUNK) {
        const chunk = fresh.slice(i, i + FETCH_CHUNK);
        for await (const msg of client.fetch(
          chunk.join(','),
          {
            uid: true,
            envelope: true,
            flags: true,
            internalDate: true,
            size: true,
            bodyStructure: true,
            headers: ['references', 'list-id', 'list-unsubscribe', 'auto-submitted', 'precedence'],
          },
          { uid: true },
        )) {
          const env = msg as unknown as FetchedEnvelope;
          // A single undigestible envelope (bad Date, missing uid, oversized
          // field) used to throw out of the whole folder pass, so the cursor
          // never advanced and the folder refetched its window forever.
          let result: ReturnType<typeof ingestEnvelope>;
          try {
            result = ingestEnvelope(this.db, this.account.id, folder.id, env);
          } catch (err) {
            console.error(`[sync] dropping unstorable message uid=${String(msg.uid)} in ${folder.path}:`, err);
            continue;
          }
          if (!result) continue;
          touchedThreads.add(result.threadId);
          const seen = (msg.flags ?? new Set<string>()).has('\\Seen');
          const hook = runNewMessageHook(this.db, {
            accountId: this.account.id,
            threadId: result.threadId,
            messageId: result.messageId,
            folderRole: folder.role,
            seen,
            isBackfill: !this.backfilled,
            fromAddress: env.envelope?.from?.[0]?.address ?? null,
            subject: env.envelope?.subject ?? '',
            hasCalendar: structureHasCalendar(env.bodyStructure),
            headers: parseHeaderMap(env.headers),
            recipientCount: countRecipients(env.envelope),
          });
          if (hook.notify) notifications.push({ threadId: result.threadId, messageId: result.messageId });
        }
      }

      // Flag changes on messages we already have
      const known = [...serverUids].filter((u) => localUids.has(u));
      const modseq = status.modseq;
      const modseqChanged = !cursor.highestmodseq || cursor.highestmodseq !== modseq;
      if (known.length && (!hasCondstore || modseqChanged)) {
        const fetchOpts: { uid: boolean; changedSince?: bigint } = { uid: true };
        if (hasCondstore && cursor.highestmodseq) fetchOpts.changedSince = BigInt(cursor.highestmodseq);
        for (let i = 0; i < known.length; i += FETCH_CHUNK * 5) {
          const chunk = known.slice(i, i + FETCH_CHUNK * 5);
          for await (const msg of client.fetch(chunk.join(','), { uid: true, flags: true }, fetchOpts)) {
            const flags = msg.flags ?? new Set<string>();
            this.db.updateFlagsByUid(folder.id, msg.uid, {
              seen: flags.has('\\Seen'),
              flagged: flags.has('\\Flagged'),
              answered: flags.has('\\Answered'),
            });
            const row = this.db.raw
              .prepare(`SELECT thread_id FROM messages WHERE folder_id = ? AND uid = ?`)
              .get(folder.id, msg.uid) as { thread_id: string } | undefined;
            if (row) touchedThreads.add(row.thread_id);
          }
        }
      }

      this.db.setFolderCursor(folder.id, {
        uidvalidity: uidValidity,
        highestmodseq: modseq,
        lastSeenUid: Math.max(0, ...serverUids),
      });
      this.folderStatus.set(folder.id, status);
      this.folderFullSyncAt.set(folder.id, Date.now());
    } finally {
      lock.release();
      if (folder.role !== 'inbox') this.repark();
    }

    if (touchedThreads.size) {
      this.db.transaction(() => {
        for (const tid of touchedThreads) this.db.refreshThreadAggregates(tid);
      });
      this.emit({ kind: 'threads-changed', accountIds: [this.account.id] });
    }
    for (const n of notifications.slice(0, 3)) {
      const msg = this.db.getMessage(n.messageId);
      if (msg) {
        this.emit({
          kind: 'notify',
          title: msg.from?.name || msg.from?.email || 'New mail',
          body: msg.subject || '(no subject)',
          threadId: n.threadId,
        });
      }
    }
    return touchedThreads.size > 0;
  }

  /**
   * Fetch bodies for recent messages so list snippets fill in. Batched one
   * IMAP round trip per folder: doing it per message cost a mailbox lock, a
   * FETCH and an IDLE repark each, so a single pass spent 180 round trips on
   * 60 messages.
   */
  private async hydrateRecentBodies(): Promise<void> {
    const rows = this.db.raw
      .prepare(
        `SELECT m.id, m.folder_id AS folderId, m.uid FROM messages m
         LEFT JOIN message_bodies b ON b.message_id = m.id
         WHERE m.account_id = ? AND b.message_id IS NULL
         ORDER BY m.date DESC LIMIT ?`,
      )
      .all(this.account.id, HYDRATE_RECENT) as { id: string; folderId: string; uid: number }[];
    if (!rows.length) return;
    if (!(await this.whenConnected())) return;
    const client = this.client;
    if (!client?.usable) return;

    const byFolder = new Map<string, typeof rows>();
    for (const r of rows) {
      const group = byFolder.get(r.folderId);
      if (group) group.push(r);
      else byFolder.set(r.folderId, [r]);
    }

    for (const [folderId, group] of byFolder) {
      if (this.stopped) return;
      const folder = this.db.getFolder(folderId);
      if (!folder) continue;
      const idByUid = new Map(group.map((r) => [r.uid, r.id]));
      // Collect under the lock, parse after releasing it: simpleParser on a
      // large message is slow and would otherwise block the mailbox.
      const fetched: { msg: MessageMeta; source: Buffer }[] = [];
      const lock = await client.getMailboxLock(folder.path);
      try {
        for await (const m of client.fetch(
          group.map((r) => r.uid).join(','),
          { uid: true, source: true },
          { uid: true },
        )) {
          const id = idByUid.get(m.uid);
          const source = m.source as Buffer | undefined;
          if (!id || !source) continue;
          const meta = this.db.getMessage(id);
          if (meta) fetched.push({ msg: meta, source });
        }
      } catch (err) {
        console.error(`[sync] body hydration failed for ${folder.path}:`, err);
      } finally {
        lock.release();
        this.repark();
      }
      for (const { msg, source } of fetched) {
        if (this.stopped) return;
        try {
          await this.storeBody(msg, source);
        } catch (err) {
          console.error(`[sync] could not store body for ${msg.id}:`, err);
        }
      }
    }
  }

  async fetchBody(msg: MessageMeta): Promise<void> {
    // The reader may request a body before the account is connected. Wait for
    // the live connection instead of returning silently (which stranded the
    // message on "Loading message…" with no retry).
    await this.whenConnected();
    const client = this.client;
    const folder = this.db.getFolder(msg.folderId);
    if (!folder) return;
    // Still not connected after waiting: throw so the task retries rather than
    // silently dropping the fetch and leaving the reader stuck.
    if (!client?.usable) throw new Error('account not connected');
    let source: Buffer | undefined;
    const lock = await client.getMailboxLock(folder.path);
    try {
      const res = await client.fetchOne(String(msg.uid), { source: true }, { uid: true });
      source = res && typeof res !== 'boolean' ? (res.source as Buffer) : undefined;
    } finally {
      lock.release();
      this.repark();
    }
    if (!source) return;
    await this.storeBody(msg, source);
  }

  /** Parse a fetched RFC822 source and persist body, snippet and attachments. */
  private async storeBody(msg: MessageMeta, source: Buffer): Promise<void> {
    const parsed = await simpleParser(source);
    const html = typeof parsed.html === 'string' ? parsed.html : null;
    const text = parsed.text ?? null;
    this.db.upsertBody(msg.id, html, text);
    updateSnippetFromBody(this.db, msg.id, text);

    this.db.clearAttachments(msg.id);
    const usedNames = new Set<string>();
    for (const att of parsed.attachments ?? []) {
      const dir = join(this.attachmentsDir, msg.id);
      mkdirSync(dir, { recursive: true });
      const filename = safeFilename(att.filename ?? 'attachment');
      // Two parts named image.png must not overwrite each other on disk.
      let diskName = filename;
      for (let n = 1; usedNames.has(diskName); n++) diskName = `${n}-${filename}`;
      usedNames.add(diskName);
      const rel = join(msg.id, diskName);
      writeFileSync(join(this.attachmentsDir, rel), att.content);
      this.db.insertAttachment({
        id: newId(),
        messageId: msg.id,
        filename,
        contentType: att.contentType ?? 'application/octet-stream',
        size: att.size ?? att.content.length,
        cid: att.cid ?? null,
        localPath: rel,
      });
    }
    this.db.refreshThreadAggregates(msg.threadId);
    this.emit({ kind: 'message-body', messageIds: [msg.id], threadIds: [msg.threadId] });
  }

  // ---- operations used by the task executor --------------------------------

  /**
   * IDLE only watches the currently open mailbox. Every operation that
   * selects another folder must hand the connection back to INBOX, or new
   * mail goes unnoticed until the next poll. Must go through the mailbox
   * lock: a naked mailboxOpen races queued operations and can flip the
   * selected mailbox mid-command.
   */
  private reparking = false;
  private repark(): void {
    if (this.stopped || !this.client?.usable || this.reparking) return;
    this.reparking = true;
    void (async () => {
      try {
        const lock = await this.client!.getMailboxLock('INBOX');
        lock.release(); // INBOX stays selected; IDLE resumes on it
      } catch {
        /* reconnect loop will recover */
      } finally {
        this.reparking = false;
      }
    })();
  }

  async storeFlags(folderPath: string, uids: number[], flag: string, add: boolean): Promise<void> {
    const client = this.client;
    if (!uids.length) return;
    // Throw like moveMessages: returning quietly marks the task done and the
    // flag change never reaches the server.
    if (!client) throw new Error('not connected');
    const lock = await client.getMailboxLock(folderPath);
    try {
      if (add) await client.messageFlagsAdd(uids.join(','), [flag], { uid: true });
      else await client.messageFlagsRemove(uids.join(','), [flag], { uid: true });
    } finally {
      lock.release();
      this.repark();
    }
  }

  /** Returns the source-uid → dest-uid map when the server reports COPYUID. */
  async moveMessages(fromPath: string, uids: number[], toPath: string): Promise<Map<number, number> | null> {
    const client = this.client;
    if (!uids.length) return null;
    // null means "moved, but no COPYUID" — a missing connection must throw so
    // the task retries instead of the caller deleting rows locally only.
    if (!client) throw new Error('not connected');
    const lock = await client.getMailboxLock(fromPath);
    try {
      const res = await client.messageMove(uids.join(','), toPath, { uid: true });
      const uidMap = res && typeof res === 'object' ? res.uidMap : undefined;
      return uidMap && uidMap.size ? uidMap : null;
    } finally {
      lock.release();
      this.repark();
    }
  }

  /**
   * COPY messages into another folder. On Gmail this *adds a label* — the
   * message stays where it is and gains membership in `toPath`. That is the
   * primitive behind label-based state (priority, category overrides).
   */
  async copyMessages(fromPath: string, uids: number[], toPath: string): Promise<void> {
    const client = this.client;
    if (!uids.length) return;
    if (!client) throw new Error('not connected');
    const lock = await client.getMailboxLock(fromPath);
    try {
      await client.messageCopy(uids.join(','), toPath, { uid: true });
    } finally {
      lock.release();
      this.repark();
    }
  }

  /**
   * Delete messages from one folder. On Gmail this *removes that label only*
   * (the message survives under its other labels / All Mail); on plain IMAP it
   * is a real delete, so callers must only target app-managed folders.
   */
  async deleteMessages(folderPath: string, uids: number[]): Promise<void> {
    const client = this.client;
    if (!uids.length) return;
    if (!client) throw new Error('not connected');
    const lock = await client.getMailboxLock(folderPath);
    try {
      await client.messageDelete(uids.join(','), { uid: true });
    } finally {
      lock.release();
      this.repark();
    }
  }

  /** Create a missing role folder (e.g. servers with no Archive) and register it. */
  async ensureRoleFolder(role: FolderRole, name: string): Promise<Folder> {
    const existing = this.db.getFolderByRole(this.account.id, role);
    if (existing) return existing;
    // Gmail has no native Archive folder — a top-level "Archive" is just a
    // custom label. Keep the app's archive pile under the app namespace so any
    // client (desktop, mobile, Gmail web) can enumerate archived mail.
    if (role === 'archive' && isGmailAccount(this.account)) {
      return this.ensureAppFolder('Archive', 'archive');
    }
    const client = this.client;
    if (!client) throw new Error('not connected');
    try {
      await client.mailboxCreate(name);
    } catch {
      /* exists */
    }
    this.repark();
    this.db.upsertFolder({
      id: newId(),
      accountId: this.account.id,
      path: name,
      role,
      delimiter: this.db.listFolders(this.account.id).find((f) => f.delimiter)?.delimiter ?? '/',
    });
    return this.db.getFolderByPath(this.account.id, name)!;
  }

  /** Create (if needed) and register an app-managed folder like Uniox/Snoozed. */
  async ensureAppFolder(name: string, role: FolderRole): Promise<Folder> {
    const existingByPath = this.db
      .listFolders(this.account.id)
      .find((f) => f.path.endsWith(name) && isAppNamespacePath(f.path));
    if (existingByPath) return existingByPath;
    const client = this.client;
    if (!client) throw new Error('not connected');
    const delimiter = this.db.listFolders(this.account.id).find((f) => f.delimiter)?.delimiter ?? '/';
    const path = appFolderPath(name, delimiter);
    try {
      await client.mailboxCreate(path);
    } catch {
      /* exists */
    }
    const folder: Folder = {
      id: newId(),
      accountId: this.account.id,
      path,
      role,
      delimiter,
    };
    this.db.upsertFolder(folder);
    return this.db.getFolderByPath(this.account.id, path)!;
  }

  async appendMessage(folderPath: string, raw: string | Buffer, flags: string[]): Promise<void> {
    const client = this.client;
    if (!client) throw new Error('not connected');
    await client.append(folderPath, raw, flags);
    this.repark();
  }
}
