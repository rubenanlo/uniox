import { ImapFlow } from 'imapflow';
import { mkdirSync } from 'node:fs';
import { openDatabase, type MailDb } from '@app/db';
import type {
  Account,
  AccountConfig,
  CalendarEventInput,
  Commands,
  DeltaEvent,
  Folder,
  FolderRole,
  MessageMeta,
  OutgoingDraft,
  Signature,
  SyncToMain,
  Task,
  TaskRow,
  Template,
  ThreadQuery,
} from '@app/shared';
import { parseSearchQuery } from '@app/shared';
import { AccountSync } from './account-sync';
import { dueAlerts, nextAlertDeadline, START_GRACE_MS } from './event-alerts';
import {
  categoryLabelName,
  CATEGORY_LABELS,
  isAppFolder,
  isAppNamespacePath,
  isGmailAccount,
} from './folders';
import {
  calendarRowId,
  listGoogleCalendars,
  listGoogleEvents,
  listGoogleEventsChanged,
  mapGoogleEvent,
  patchGoogleEvent,
  subscribeGoogleCalendar,
  SyncTokenExpiredError,
  unsubscribeGoogleCalendar,
  SYNC_FUTURE_MS,
  SYNC_PAST_MS,
} from './google-calendar';
import { fetchGoogleSenderName } from './google-profile';
import { Scheduler } from './scheduler';
import { composeRaw, smtpSend } from './send';
import { newId, withTimeout } from './util';

const MAX_TASK_ATTEMPTS = 3;
const TASK_TIMEOUT_MS = 120_000;

/** Draft retention: drafts untouched for this long are purged (moved to Trash). */
const DRAFT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** How often to look for stale drafts (also runs shortly after launch). */
const DRAFT_PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STORAGE_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Settled tasks stay around a week so a failure is still inspectable. */
const TASK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export class SyncService {
  private db!: MailDb;
  private attachmentsDir = '';
  private readonly accounts = new Map<string, AccountSync>();
  private readonly passwords = new Map<string, string>();
  private readonly pendingCreds = new Map<string, ((secret: string) => void)[]>();
  private readonly accountWaiters = new Map<string, ((sync: AccountSync) => void)[]>();
  private scheduler: Scheduler | null = null;
  private taskLoopRunning = false;
  private taskLoopKick = false;
  private purgeTimers: NodeJS.Timeout[] = [];
  private powerPaused = false;
  private eventAlertTimer: NodeJS.Timeout | null = null;
  /** alertKey → event startMs, for pruning entries once long past. */
  private readonly firedEventAlerts = new Map<string, number>();

  constructor(private readonly post: (msg: SyncToMain) => void) {}

  private delta(event: DeltaEvent) {
    this.post({ kind: 'delta', event });
    // Calendar changes move meeting-alert deadlines (created/edited/deleted).
    if (event.kind === 'calendar-changed') this.scheduleEventAlerts();
    // hooks and the scheduler enqueue tasks as side effects; keep draining
    void this.runTaskLoop();
  }

  init(dbPath: string, attachmentsDir: string) {
    mkdirSync(attachmentsDir, { recursive: true });
    this.attachmentsDir = attachmentsDir;
    this.db = openDatabase(dbPath);
    this.db.resetRunningTasks();

    // One-time: participants used to include our own sent copies, so threads
    // we started displayed our name instead of the other party. Recompute the
    // denormalized aggregates once under the corrected rule.
    if (!this.db.getSetting('participants-exclude-self-v2')) {
      const ids = this.db.raw.prepare(`SELECT id FROM threads`).all() as { id: string }[];
      this.db.transaction(() => {
        for (const { id } of ids) this.db.refreshThreadAggregates(id);
      });
      this.db.setSetting('participants-exclude-self-v2', true);
    }

    // Launch catch-up (report §5.4): sends that came due while closed become
    // 'overdue' and wait for an explicit Send now / Cancel in the Outbox;
    // interrupted 'sending' rows count as overdue too.
    this.db.raw.exec(`UPDATE scheduled_sends SET status = 'overdue' WHERE status = 'sending'`);
    this.db.markOverdueScheduledSends();

    this.scheduler = new Scheduler(this.db, (fire) => {
      switch (fire.kind) {
        case 'snooze': {
          const notify =
            fire.alert && ((this.db.getSetting('scheduling') as { notify?: boolean } | null)?.notify ?? true);
          this.enqueue({
            type: 'unsnooze-thread',
            accountId: fire.accountId,
            threadId: fire.threadId,
            markUnread: true,
            notify,
          });
          break;
        }
        case 'send':
          this.enqueue({ type: 'send-scheduled-now', scheduledId: fire.scheduledId });
          break;
        case 'reminder':
          this.enqueue({ type: 'fire-reminder', accountId: fire.accountId, threadId: fire.threadId });
          break;
      }
    });
    // overdue snoozes/reminders fire immediately on launch
    this.scheduler.fireDue();

    // Meeting alerts: 10-minute heads-up + at start, off a next-deadline timer.
    this.scheduleEventAlerts();

    // Draft retention: sweep shortly after launch (once accounts connect) and
    // periodically from then on.
    this.purgeTimers = [
      setTimeout(() => this.enqueue({ type: 'purge-drafts' }), 60_000),
      setInterval(() => this.enqueue({ type: 'purge-drafts' }), DRAFT_PURGE_INTERVAL_MS),
      // Storage retention: settled tasks and threads stranded without messages.
      setTimeout(() => this.sweepStorage(), 90_000),
      setInterval(() => this.sweepStorage(), STORAGE_SWEEP_INTERVAL_MS),
      // Google Calendar polling (no push channels without a public endpoint).
      setInterval(() => {
        if (!this.powerPaused) void this.syncAllCalendars();
      }, 5 * 60_000),
    ];

    // Accounts exist but credentials live in the main process; it sends them.
    for (const account of this.db.listAccounts()) {
      this.post({ kind: 'need-credentials', accountId: account.id });
    }
    this.post({ kind: 'ready' });
  }

  /**
   * Reclaim storage the normal write paths never revisit: settled tasks (send
   * tasks carry their whole raw MIME) and thread rows whose messages are gone.
   * Refreshes planner statistics afterwards, since both change table sizes.
   */
  sweepStorage(): void {
    const tasks = this.db.purgeSettledTasks(Date.now() - TASK_RETENTION_MS);
    const threads = this.db.purgeOrphanThreads();
    if (tasks || threads) {
      console.log(`[sync] storage sweep: ${tasks} tasks, ${threads} orphan threads`);
      this.db.analyze();
    }
    if (threads) this.delta({ kind: 'threads-changed', accountIds: [] });
  }

  async shutdown(): Promise<void> {
    for (const t of this.purgeTimers) clearTimeout(t);
    this.purgeTimers = [];
    if (this.eventAlertTimer) clearTimeout(this.eventAlertTimer);
    this.eventAlertTimer = null;
    this.scheduler?.stop();
    for (const sync of this.accounts.values()) await sync.stop();
    this.accounts.clear();
  }

  provideCredentials(accountId: string, secret: string) {
    this.passwords.set(accountId, secret);
    for (const resolve of this.pendingCreds.get(accountId) ?? []) resolve(secret);
    this.pendingCreds.delete(accountId);
    const account = this.db.getAccount(accountId);
    if (account && !this.accounts.has(accountId)) {
      const sync = new AccountSync(
        this.db,
        account,
        () => this.freshSecret(accountId),
        this.attachmentsDir,
        (e) => this.delta(e),
      );
      this.accounts.set(accountId, sync);
      void sync.start();
      const waiters = this.accountWaiters.get(accountId);
      if (waiters) {
        this.accountWaiters.delete(accountId);
        for (const resolve of waiters) resolve(sync);
      }
      // First calendar pull shortly after the account comes online.
      if (account.authType === 'oauth-google') {
        setTimeout(() => void this.syncAccountCalendars(accountId), 5_000);
      }
    }
  }

  private async syncAllCalendars(): Promise<void> {
    for (const a of this.db.listAccounts()) {
      if (a.authType === 'oauth-google') await this.syncAccountCalendars(a.id);
    }
  }

  /** System sleep: stop the timers; wake: catch up immediately. */
  setPower(state: 'suspend' | 'resume') {
    this.powerPaused = state === 'suspend';
    for (const sync of this.accounts.values()) {
      if (state === 'suspend') sync.pause();
      else sync.resume();
    }
    if (state === 'resume') {
      void this.syncAllCalendars();
      // A timer that slept through its deadline fires late; re-derive now so
      // an alert still inside its window lands right after wake.
      this.scheduleEventAlerts();
    }
  }

  /**
   * Fire due meeting alerts and re-arm for the next boundary. Runs on boot,
   * on every calendar change, at each deadline, and on wake — never on a
   * polling cadence.
   */
  private scheduleEventAlerts(): void {
    if (this.eventAlertTimer) clearTimeout(this.eventAlertTimer);
    this.eventAlertTimer = null;
    const now = Date.now();
    // Visible calendars only; the horizon just bounds the query — the timer
    // re-arms well before it runs out.
    const events = this.db.listEvents(now - START_GRACE_MS, now + 24 * 60 * 60_000);

    for (const [key, startMs] of this.firedEventAlerts) {
      if (startMs < now - 24 * 60 * 60_000) this.firedEventAlerts.delete(key);
    }

    for (const due of dueAlerts(events, now, this.firedEventAlerts)) {
      this.firedEventAlerts.set(due.key, due.event.startMs);
      const at = new Date(due.event.startMs).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      const where = due.event.location ? ` · ${due.event.location}` : '';
      const minutes = Math.max(1, Math.round((due.event.startMs - now) / 60_000));
      this.delta({
        kind: 'notify',
        category: 'event',
        title: due.event.title || '(untitled event)',
        body:
          due.stage === 'lead'
            ? `Starts in ${minutes} min · ${at}${where}`
            : `Starting now · ${at}${where}`,
      });
    }

    const next = nextAlertDeadline(events, Date.now(), this.firedEventAlerts);
    // No pending alert still re-arms (capped): events beyond the horizon and
    // clock drift both get picked up.
    const delay = Math.min(next === null ? Infinity : Math.max(0, next - Date.now()), 6 * 60 * 60_000);
    this.eventAlertTimer = setTimeout(() => this.scheduleEventAlerts(), delay);
  }

  /** Re-base the sync window monthly so it doesn't age out from under the token. */
  private static readonly SYNC_TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60_000;

  /** Accounts whose sender name was already checked this run. */
  private namedAccounts = new Set<string>();

  /**
   * Backfill the account's outgoing display name so sent mail shows
   * "Ruben Andino", not "ruben.andino": Google send-as/profile name when the
   * token can reach it, else the name the provider stamped on the account's
   * own recent sent mail. Fire-and-forget, once per account per service run.
   */
  private refreshSenderName(accountId: string, current: string, token: string): void {
    if (this.namedAccounts.has(accountId)) return;
    this.namedAccounts.add(accountId);
    void fetchGoogleSenderName(token).then((fetched) => {
      const account = this.db.getAccount(accountId);
      if (!account) return;
      const name = fetched ?? this.db.lastSentDisplayName(accountId, account.email);
      if (name && name !== current) {
        this.db.updateAccountDisplayName(accountId, name);
        this.delta({ kind: 'accounts-changed' });
      }
    });
  }

  /**
   * Reconcile of one account's Google calendars: calendarList → calendar
   * rows, then per calendar an incremental changes fetch when a syncToken is
   * stored, else the full windowed singleEvents fetch (recurring events
   * arrive pre-expanded) with a prune for deletions.
   */
  private async syncAccountCalendars(accountId: string): Promise<void> {
    try {
      const account = this.db.getAccount(accountId);
      if (!account) return;
      this.db.ensureAccountCalendar(accountId, account.displayName || account.email);
      const token = await this.freshSecret(accountId);
      this.refreshSenderName(accountId, account.displayName, token);
      for (const cal of await listGoogleCalendars(token)) {
        const rowId = calendarRowId(accountId, cal);
        this.db.upsertGoogleCalendar({
          id: rowId,
          accountId,
          remoteId: cal.id,
          name: cal.summary ?? cal.id,
          color: cal.backgroundColor ?? '#2f63e7',
          visible: cal.selected !== false,
          primary: !!cal.primary,
        });
        await this.syncCalendarEvents(token, rowId, cal.id);
      }
      this.delta({ kind: 'calendar-changed' });
    } catch (err) {
      console.error(`[sync] calendar sync for ${accountId}:`, err);
    }
  }

  private async syncCalendarEvents(
    token: string,
    rowId: string,
    remoteCalendarId: string,
  ): Promise<void> {
    const stored = this.db.getCalendarSyncToken(rowId);
    if (stored && Date.now() - stored.at < SyncService.SYNC_TOKEN_MAX_AGE_MS) {
      try {
        const { items, nextSyncToken } = await listGoogleEventsChanged(
          token,
          remoteCalendarId,
          stored.token,
        );
        for (const item of items) {
          if (item.status === 'cancelled') {
            this.db.deleteGoogleEventByRemoteId(rowId, item.id);
            continue;
          }
          const mapped = mapGoogleEvent(item, rowId);
          if (mapped) this.db.upsertGoogleEvent(mapped);
        }
        if (nextSyncToken) this.db.setCalendarSyncToken(rowId, nextSyncToken);
        return;
      } catch (err) {
        if (!(err instanceof SyncTokenExpiredError)) throw err;
        this.db.setCalendarSyncToken(rowId, null); // fall through to a full window fetch
      }
    }
    const windowStart = Date.now() - SYNC_PAST_MS;
    const windowEnd = Date.now() + SYNC_FUTURE_MS;
    const { items, nextSyncToken } = await listGoogleEvents(
      token,
      remoteCalendarId,
      new Date(windowStart).toISOString(),
      new Date(windowEnd).toISOString(),
    );
    const seen: string[] = [];
    for (const item of items) {
      const mapped = mapGoogleEvent(item, rowId);
      if (!mapped) continue;
      seen.push(mapped.remoteId);
      this.db.upsertGoogleEvent(mapped);
    }
    this.db.pruneGoogleEvents(rowId, windowStart, windowEnd, seen);
    this.db.setCalendarSyncToken(rowId, nextSyncToken);
  }

  /**
   * Resolve an account's sync engine, waiting for it to register if credentials
   * are still in flight (the launch race: a body fetch can be requested before
   * the main process has handed back credentials). Re-requests credentials and
   * waits rather than throwing "no sync engine", which used to permanently fail
   * the task and strand the message on "Loading message…".
   */
  private waitForAccount(accountId: string, timeoutMs = 25_000): Promise<AccountSync> {
    const existing = this.accounts.get(accountId);
    if (existing) return Promise.resolve(existing);
    this.post({ kind: 'need-credentials', accountId });
    return new Promise((resolve, reject) => {
      const waiter = (sync: AccountSync) => {
        clearTimeout(timer);
        resolve(sync);
      };
      const timer = setTimeout(() => {
        const arr = (this.accountWaiters.get(accountId) ?? []).filter((w) => w !== waiter);
        if (arr.length) this.accountWaiters.set(accountId, arr);
        else this.accountWaiters.delete(accountId);
        reject(new Error(`no sync engine for account ${accountId}`));
      }, timeoutMs);
      const arr = this.accountWaiters.get(accountId) ?? [];
      arr.push(waiter);
      this.accountWaiters.set(accountId, arr);
    });
  }

  /**
   * Password accounts: the stored secret. OAuth accounts: ask the main
   * process for a fresh access token (it refreshes via Google as needed).
   */
  private freshSecret(accountId: string): Promise<string> {
    const account = this.db.getAccount(accountId);
    if (account?.authType !== 'oauth-google') {
      const p = this.passwords.get(accountId);
      return p ? Promise.resolve(p) : Promise.reject(new Error('no credentials'));
    }
    return new Promise((resolve, reject) => {
      const waiter = (secret: string) => {
        clearTimeout(timer);
        resolve(secret);
      };
      const timer = setTimeout(() => {
        // Drop the stale waiter so failed refreshes don't pile closures up.
        const rest = (this.pendingCreds.get(accountId) ?? []).filter((w) => w !== waiter);
        if (rest.length) this.pendingCreds.set(accountId, rest);
        else this.pendingCreds.delete(accountId);
        reject(new Error('credential request timed out'));
      }, 30_000);
      const arr = this.pendingCreds.get(accountId) ?? [];
      arr.push(waiter);
      this.pendingCreds.set(accountId, arr);
      this.post({ kind: 'need-credentials', accountId });
    });
  }

  async handleQuery(channel: string, args: unknown): Promise<unknown> {
    switch (channel) {
      case 'accounts:list':
        return this.db.listAccounts();
      case 'folders:list':
        return this.db.listFolders((args as { accountId?: string })?.accountId);
      case 'threads:list':
        return this.db.listThreads(args as ThreadQuery);
      case 'thread:messages':
        // Deduped view: Gmail label copies of the same Message-ID collapse to one.
        return this.db.getThreadMessagesForDisplay((args as { threadId: string }).threadId);
      case 'thread:get':
        return this.db.getThreadSummary((args as { threadId: string }).threadId);
      case 'message:body': {
        const { messageId } = args as { messageId: string };
        const body = this.db.getBody(messageId);
        if (!body) {
          // Kick a fetch; the renderer re-queries on the message-body delta.
          this.enqueue({ type: 'fetch-body', accountId: '', messageId });
        }
        return body;
      }
      case 'style:samples': {
        const { accountId, limit } = args as { accountId: string; limit?: number };
        const rows = this.db.recentSentWithBodies(accountId, Math.min(limit ?? 40, 100));
        // Bodies are fetched lazily; queue the missing ones so a later rebuild
        // has more to learn from.
        for (const r of rows) {
          if (!r.hasBody) this.enqueue({ type: 'fetch-body', accountId, messageId: r.messageId });
        }
        return rows
          .filter((r) => r.hasBody)
          .map(({ messageId, html, text }) => ({ messageId, html, text }));
      }
      case 'search:threads': {
        const { query, limit, accountId } = args as {
          query: string;
          limit?: number;
          accountId?: string;
        };
        const parsed = parseSearchQuery(query);
        if (parsed.isEmpty) return [];
        try {
          return this.db.searchThreads({
            fts: parsed.fts,
            toLike: parsed.toLike,
            hasAttachment: parsed.hasAttachment,
            // Searching while the sidebar is focused on one account stays
            // inside that account, matching what the list already does.
            accountId,
            limit: limit ?? 50,
          });
        } catch {
          return [];
        }
      }
      case 'contacts:suggest': {
        const { query, limit } = args as { query: string; limit?: number };
        const q = query.trim().toLowerCase();
        if (q.length < 2) return [];
        try {
          return this.db.suggestContacts(q, limit ?? 8);
        } catch {
          return [];
        }
      }
      case 'settings:get':
        return this.db.getSetting((args as { key: string }).key);
      case 'account:test': {
        const { config, password } = args as { config: AccountConfig; password: string };
        return this.testAccount(config, password);
      }
      case 'account:add': {
        const { config, password } = args as { config: AccountConfig; password: string };
        const test = await this.testAccount(config, password);
        if (!test.ok) return { ok: false, error: test.error ?? 'connection failed' };
        const account: Account = {
          id: newId(),
          email: config.email,
          displayName: config.displayName ?? config.email,
          imap: config.imap,
          smtp: config.smtp,
          authType: config.authType ?? 'password',
        };
        this.db.insertAccount(account);
        this.provideCredentials(account.id, password);
        this.delta({ kind: 'accounts-changed' });
        return { ok: true, accountId: account.id };
      }
      case 'account:remove': {
        // Stop the live IMAP loop, drop every in-memory trace, then delete the
        // account and its cached mail/calendar from the DB. Credentials are
        // forgotten by the main process (which owns the credential store).
        const { accountId } = args as { accountId: string };
        const sync = this.accounts.get(accountId);
        if (sync) {
          this.accounts.delete(accountId);
          await sync.stop();
        }
        this.passwords.delete(accountId);
        this.pendingCreds.delete(accountId);
        this.accountWaiters.delete(accountId);
        this.db.deleteAccount(accountId);
        this.delta({ kind: 'accounts-changed' });
        this.delta({ kind: 'calendar-changed' });
        return { ok: true };
      }
      case 'settings:set': {
        const { key, value } = args as { key: string; value: unknown };
        this.db.setSetting(key, value);
        return { ok: true };
      }
      case 'sync:now': {
        // Manual refresh (⌘R): fire-and-forget; progress shows via sync-status
        // and threads/calendar deltas, like any scheduled pass.
        if (this.powerPaused) return { ok: false };
        for (const sync of this.accounts.values()) sync.refreshNow();
        void this.syncAllCalendars();
        return { ok: true };
      }
      case 'account:set-auth-type': {
        // Main-process only (reconnect flow): flip the auth scheme and restart
        // the account's sync loop so it reconnects with the new credentials.
        const { accountId, authType } = args as {
          accountId: string;
          authType: 'password' | 'oauth-google';
        };
        this.db.updateAccountAuthType(accountId, authType);
        const sync = this.accounts.get(accountId);
        if (sync) {
          this.accounts.delete(accountId);
          await sync.stop();
        }
        this.passwords.delete(accountId); // a stale app password must not linger
        this.post({ kind: 'need-credentials', accountId }); // answer restarts the loop
        this.delta({ kind: 'accounts-changed' });
        return { ok: true };
      }
      case 'calendar:event:save': {
        const { event } = args as { event: CalendarEventInput };
        const id = this.db.upsertEvent(event);
        this.delta({ kind: 'calendar-changed' });
        return { ok: true, id };
      }
      case 'calendar:setVisible': {
        const { id, visible } = args as { id: string; visible: boolean };
        this.db.setCalendarVisible(id, visible);
        this.delta({ kind: 'calendar-changed' });
        return { ok: true };
      }
      case 'calendar:subscribe': {
        // Add another calendar (a colleague's, by email) to an account's Google
        // list, then reconcile so it and its events appear.
        const { accountId, email } = args as { accountId: string; email: string };
        const account = this.db.getAccount(accountId);
        if (!account || account.authType !== 'oauth-google') {
          return { ok: false, error: 'Pick a Google account to add the calendar to.' };
        }
        try {
          const token = await this.freshSecret(accountId);
          await subscribeGoogleCalendar(token, email.trim().toLowerCase());
          await this.syncAccountCalendars(accountId);
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      case 'calendar:unsubscribe': {
        // Remove a subscribed Google calendar from the account entirely, then
        // drop its local row and events. Primary calendars can't be removed.
        const { id } = args as { id: string };
        const cal = this.db.getCalendarSync(id);
        if (!cal) return { ok: false, error: 'Calendar not found.' };
        if (cal.source !== 'google' || !cal.remoteId || !cal.accountId || id.startsWith('acct:')) {
          return { ok: false, error: 'This calendar can’t be unsubscribed.' };
        }
        try {
          const token = await this.freshSecret(cal.accountId);
          await unsubscribeGoogleCalendar(token, cal.remoteId);
          this.db.deleteCalendar(id);
          this.delta({ kind: 'calendar-changed' });
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      case 'calendar:event:delete': {
        this.db.deleteEvent((args as { id: string }).id);
        this.delta({ kind: 'calendar-changed' });
        return { ok: true };
      }
      case 'calendar:event:patch': {
        // Reschedule/edit in place. Local rows update directly; Google rows
        // push the change upstream first so a failed PATCH leaves the local
        // copy (and the UI) untouched.
        const patch = args as Commands['calendar:event:patch']['args'];
        const ev = this.db.getEventSync(patch.id);
        if (!ev) return { ok: false, error: 'Event not found.' };
        if (ev.source === 'google') {
          const cal = this.db.getCalendarSync(ev.calendarId);
          if (!cal?.accountId || !cal.remoteId || !ev.remoteId) {
            return { ok: false, error: 'This event is not linked to a Google calendar.' };
          }
          try {
            const token = await this.freshSecret(cal.accountId);
            await patchGoogleEvent(token, cal.remoteId, ev.remoteId, patch);
          } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
          }
        }
        this.db.patchEvent(patch.id, patch);
        this.delta({ kind: 'calendar-changed' });
        return { ok: true };
      }
      case 'calendar:events': {
        const { startMs, endMs } = args as { startMs: number; endMs: number };
        return this.db.listEvents(startMs, endMs);
      }
      case 'calendar:list': {
        for (const a of this.db.listAccounts()) {
          this.db.ensureAccountCalendar(a.id, a.displayName || a.email);
        }
        return this.db.listCalendars();
      }
      case 'outbox:list':
        return this.db.listScheduledSends();
      case 'gatekeeper:pending':
        return this.db.listGatekeeperPending();
      case 'templates:list':
        return this.db.listTemplates();
      case 'templates:save':
        this.db.saveTemplate(args as Template);
        return { ok: true };
      case 'templates:delete':
        this.db.deleteTemplate((args as { id: string }).id);
        return { ok: true };
      case 'signatures:list':
        return this.db.listSignatures();
      case 'priority:list':
        return this.db.listPrioritySenders();
      case 'signatures:save':
        this.db.saveSignature(args as Signature);
        return { ok: true };
      default:
        throw new Error(`unknown query channel: ${channel}`);
    }
  }

  private async testAccount(config: AccountConfig, password: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const client = new ImapFlow({
        host: config.imap.host,
        port: config.imap.port,
        secure: config.imap.secure,
        auth:
          config.authType === 'oauth-google'
            ? { user: config.email, accessToken: password }
            : { user: config.email, pass: password },
        tls: config.imap.allowInsecureTls ? { rejectUnauthorized: false } : undefined,
        logger: false,
      });
      await withTimeout(client.connect(), 15_000, 'IMAP connect');
      await client.logout();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  enqueue(task: Task): number {
    // Stamp the draft's location before the local row disappears.
    if (task.type === 'delete-draft' && (!task.folderId || !task.uid)) {
      const msg = this.db.getMessage(task.messageId);
      if (msg) task = { ...task, folderId: msg.folderId, uid: msg.uid };
    }
    const id = this.db.enqueueTask(task);
    this.applyLocalEffect(task);
    void this.runTaskLoop();
    return id;
  }

  /**
   * Local-first triage: placement is the UI's contract, the IMAP move is
   * background work. Flip it (and notify the renderer) at enqueue time so the
   * thread leaves the list instantly instead of after the server round-trip.
   */
  private applyLocalEffect(task: Task): void {
    switch (task.type) {
      case 'move-thread':
        this.db.setPlacement(task.threadId, task.toRole === 'inbox' ? 'inbox' : 'done');
        this.db.refreshThreadAggregates(task.threadId);
        this.delta({ kind: 'threads-changed', accountIds: [task.accountId] });
        break;
      case 'delete-draft':
        // The draft leaves the Drafts view instantly; the server-side move to
        // Trash follows in the background (Trash re-syncs it into that view).
        if (task.folderId && task.uid) {
          const threadIds = this.db.deleteMessagesByUids(task.folderId, [task.uid]);
          for (const tid of threadIds) this.db.refreshThreadAggregates(tid);
          this.delta({ kind: 'threads-changed', accountIds: [task.accountId] });
        }
        break;
    }
  }

  private async runTaskLoop(): Promise<void> {
    // lost-wakeup guard: an enqueue that lands while the loop is finishing
    // sets the flag and the loop takes another pass instead of exiting
    if (this.taskLoopRunning) {
      this.taskLoopKick = true;
      return;
    }
    this.taskLoopRunning = true;
    try {
      do {
        this.taskLoopKick = false;
        for (;;) {
          const task = this.db.claimNextTask();
          if (!task) break;
          try {
            // One hung IMAP op (mailbox-lock waiters can stall on a dead
            // socket) must not wedge the shared queue for every account.
            await withTimeout(this.execute(task), TASK_TIMEOUT_MS, `task ${task.payload.type}`);
            this.db.finishTask(task.id, 'done');
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (task.attempts < MAX_TASK_ATTEMPTS) {
              this.db.finishTask(task.id, 'pending', message);
              await new Promise((r) => setTimeout(r, 1_000 * task.attempts));
            } else {
              this.db.finishTask(task.id, 'failed', message);
            }
          }
        }
      } while (this.taskLoopKick);
    } finally {
      this.taskLoopRunning = false;
    }
    if (this.taskLoopKick) void this.runTaskLoop();
  }

  private sync(accountId: string): AccountSync {
    const s = this.accounts.get(accountId);
    if (!s) throw new Error(`no sync engine for account ${accountId}`);
    return s;
  }

  /**
   * Move every message of a thread whose folder matches isSource into dest.
   * Prefers COPYUID's uidMap so rows move locally (undo and placement views
   * keep working without a destination re-sync); falls back to delete+resync.
   */
  private async relocateThread(
    accountId: string,
    threadId: string,
    isSource: (f: Folder) => boolean,
    dest: Folder,
    includeMessage?: (m: MessageMeta) => boolean,
  ): Promise<void> {
    const sync = this.sync(accountId);
    const byFolder = new Map<string, { path: string; uids: number[] }>();
    for (const m of this.db.getMessagesByThread(threadId)) {
      if (m.accountId !== accountId) continue;
      if (includeMessage && !includeMessage(m)) continue;
      const folder = this.db.getFolder(m.folderId);
      if (!folder || folder.id === dest.id || !isSource(folder)) continue;
      const entry = byFolder.get(folder.id) ?? { path: folder.path, uids: [] };
      entry.uids.push(m.uid);
      byFolder.set(folder.id, entry);
    }
    let needResync = false;
    for (const [folderId, { path, uids }] of byFolder) {
      const uidMap = await sync.moveMessages(path, uids, dest.path);
      if (uidMap) {
        for (const [oldUid, newUid] of uidMap) {
          const row = this.db.raw
            .prepare(`SELECT id FROM messages WHERE folder_id = ? AND uid = ?`)
            .get(folderId, oldUid) as { id: string } | undefined;
          if (row) this.db.moveMessage(row.id, dest.id, newUid);
        }
      } else {
        this.db.deleteMessagesByUids(folderId, uids);
        needResync = true;
      }
    }
    if (needResync) await sync.syncFolder(dest);
  }

  /** Remove a draft from its Drafts folder (after sending, or Delete on the draft). */
  private async deleteDraftMessage(accountId: string, messageId: string): Promise<void> {
    const msg = this.db.getMessage(messageId);
    if (!msg) return;
    const folder = this.db.getFolder(msg.folderId);
    if (!folder) return;
    const sync = this.sync(accountId);
    const trash =
      this.db.getFolderByRole(accountId, 'trash') ?? (await sync.ensureRoleFolder('trash', 'Trash'));
    if (folder.id !== trash.id) {
      const uidMap = await sync.moveMessages(folder.path, [msg.uid], trash.path);
      const newUid = uidMap?.get(msg.uid);
      if (newUid !== undefined) this.db.moveMessage(msg.id, trash.id, newUid);
      else this.db.deleteMessagesByUids(folder.id, [msg.uid]);
    }
    this.db.refreshThreadAggregates(msg.threadId);
    this.delta({ kind: 'threads-changed', accountIds: [accountId] });
  }

  /** Reminder / snooze-wake semantics: the thread returns as unread. */
  private async markLatestUnread(accountId: string, threadId: string): Promise<void> {
    const messages = this.db.getMessagesByThread(threadId).filter((m) => m.accountId === accountId);
    const latest = messages[messages.length - 1];
    if (!latest) return;
    this.db.setFlagsById(latest.id, { seen: false });
    const folder = this.db.getFolder(latest.folderId);
    if (folder) {
      try {
        await this.sync(accountId).storeFlags(folder.path, [latest.uid], '\\Seen', false);
      } catch {
        /* local unread is the contract; server flag is best-effort */
      }
    }
  }

  /** LIKE pattern matching a sender key in from_json (same shape as reclassify). */
  private static senderPattern(key: string, kind: 'address' | 'domain'): string {
    return kind === 'address' ? `%"${key}"%` : `%@${key}"%`;
  }

  /** A sender's synced messages grouped by folder, for label COPY fan-out. */
  private senderMessagesByFolder(
    accountId: string,
    pattern: string,
    excludeFolderIds: Set<string>,
  ): Map<string, { path: string; uids: number[] }> {
    const rows = this.db.raw
      .prepare(
        `SELECT m.uid, f.id AS fid, f.path FROM messages m JOIN folders f ON f.id = m.folder_id
         WHERE m.account_id = ? AND m.from_json LIKE ?
           AND f.role NOT IN ('trash','spam','drafts')`,
      )
      .all(accountId, pattern) as { uid: number; fid: string; path: string }[];
    const byFolder = new Map<string, { path: string; uids: number[] }>();
    for (const r of rows) {
      if (excludeFolderIds.has(r.fid)) continue;
      const e = byFolder.get(r.fid) ?? { path: r.path, uids: [] };
      e.uids.push(r.uid);
      byFolder.set(r.fid, e);
    }
    return byFolder;
  }

  /** Remove a sender's copies from one app label folder (server + local rows). */
  private async unlabelSender(sync: AccountSync, labelFolder: Folder, pattern: string): Promise<void> {
    const uids = (
      this.db.raw
        .prepare(`SELECT uid FROM messages WHERE folder_id = ? AND from_json LIKE ?`)
        .all(labelFolder.id, pattern) as { uid: number }[]
    ).map((r) => r.uid);
    if (!uids.length) return;
    await sync.deleteMessages(labelFolder.path, uids);
    for (const tid of this.db.deleteMessagesByUids(labelFolder.id, uids)) {
      this.db.refreshThreadAggregates(tid);
    }
  }

  /**
   * Best-effort IMAP bookkeeping after a successful SMTP send: copy to Sent,
   * mark the original \\Answered, drop the server draft. Never throws — the
   * message is already delivered, so a retry would only send a duplicate.
   */
  private async afterSend(accountId: string, raw: Buffer, draft: OutgoingDraft): Promise<void> {
    try {
      const sync = this.sync(accountId);
      const sent = this.db.getFolderByRole(accountId, 'sent');
      if (sent) {
        await sync.appendMessage(sent.path, raw, ['\\Seen']);
        await sync.syncFolder(sent);
      }
      if (draft.inReplyToMessageId) {
        const orig = this.db.getMessage(draft.inReplyToMessageId);
        const folder = orig && this.db.getFolder(orig.folderId);
        if (orig && folder) {
          await sync.storeFlags(folder.path, [orig.uid], '\\Answered', true);
          this.db.setFlagsById(orig.id, { answered: true });
        }
      }
      if (draft.deleteDraftMessageId) {
        await this.deleteDraftMessage(accountId, draft.deleteDraftMessageId);
      }
    } catch (err) {
      console.error('[sync] post-send bookkeeping failed (mail WAS sent):', err);
    }
  }

  private async execute(task: TaskRow): Promise<void> {
    const t = task.payload;
    switch (t.type) {
      case 'send-draft': {
        const account = this.db.getAccount(t.draft.accountId);
        if (!account) throw new Error('account not ready');
        const password = await this.freshSecret(account.id);
        const raw = await composeRaw(this.db, account, t.draft);
        await smtpSend(account, password, t.draft, raw);
        // Past this point the mail is out: nothing may throw back into the
        // task retry path, or the recipient gets the message again.
        await this.afterSend(account.id, raw, t.draft);
        this.delta({ kind: 'threads-changed', accountIds: [account.id] });
        break;
      }
      case 'save-draft': {
        const account = this.db.getAccount(t.draft.accountId);
        if (!account) throw new Error('account not ready');
        const raw = await composeRaw(this.db, account, t.draft);
        const sync = this.sync(account.id);
        const drafts =
          this.db.getFolderByRole(account.id, 'drafts') ??
          (await sync.ensureRoleFolder('drafts', 'Drafts'));
        await sync.appendMessage(drafts.path, raw, ['\\Draft', '\\Seen']);
        // Re-saving an edited draft replaces the stored one.
        if (t.draft.deleteDraftMessageId) {
          await this.deleteDraftMessage(account.id, t.draft.deleteDraftMessageId);
        }
        await sync.syncFolder(drafts);
        this.delta({ kind: 'threads-changed', accountIds: [account.id] });
        break;
      }
      case 'delete-draft': {
        // The local row was removed at enqueue time; this is the server half.
        if (t.folderId && t.uid) {
          const folder = this.db.getFolder(t.folderId);
          if (!folder) break;
          const sync = this.sync(t.accountId);
          const trash =
            this.db.getFolderByRole(t.accountId, 'trash') ??
            (await sync.ensureRoleFolder('trash', 'Trash'));
          if (folder.id !== trash.id) await sync.moveMessages(folder.path, [t.uid], trash.path);
          await sync.syncFolder(trash);
          this.delta({ kind: 'threads-changed', accountIds: [t.accountId] });
        } else {
          // enqueued before the message row was known — fall back to the live-row path
          await this.deleteDraftMessage(t.accountId, t.messageId);
        }
        break;
      }
      case 'purge-drafts': {
        // Accounts without a live sync engine are skipped; the next periodic
        // sweep picks their stale drafts up.
        for (const stale of this.db.listStaleDraftMessages(Date.now() - DRAFT_RETENTION_MS)) {
          if (!this.accounts.has(stale.accountId)) continue;
          await this.deleteDraftMessage(stale.accountId, stale.id);
        }
        break;
      }
      case 'set-seen':
      case 'set-flagged': {
        const flag = t.type === 'set-seen' ? '\\Seen' : '\\Flagged';
        const value = t.type === 'set-seen' ? t.seen : t.flagged;
        const sync = this.sync(t.accountId);
        const byFolder = new Map<string, { path: string; uids: number[] }>();
        const touched = new Set<string>();
        for (const id of t.messageIds) {
          const m = this.db.getMessage(id);
          if (!m) continue;
          const folder = this.db.getFolder(m.folderId);
          if (!folder) continue;
          const entry = byFolder.get(folder.id) ?? { path: folder.path, uids: [] };
          entry.uids.push(m.uid);
          byFolder.set(folder.id, entry);
          this.db.setFlagsById(id, t.type === 'set-seen' ? { seen: value } : { flagged: value });
          touched.add(m.threadId);
        }
        for (const tid of touched) this.db.refreshThreadAggregates(tid);
        this.delta({ kind: 'threads-changed', accountIds: [t.accountId] });
        for (const { path, uids } of byFolder.values()) {
          await sync.storeFlags(path, uids, flag, value);
        }
        break;
      }
      case 'move-thread': {
        const role = t.toRole === 'inbox' ? 'inbox' : t.toRole;
        const dest =
          this.db.getFolderByRole(t.accountId, role) ??
          (await this.sync(t.accountId).ensureRoleFolder(role, t.toRole === 'trash' ? 'Trash' : 'Archive'));
        // Deleting a thread takes its drafts along; archiving leaves them alone.
        const sourceRoles: FolderRole[] =
          t.toRole === 'inbox' ? ['archive', 'trash', 'snoozed'] : t.toRole === 'trash' ? ['inbox', 'drafts'] : ['inbox'];
        const isSource = (f: Folder) => sourceRoles.includes(f.role);
        const draftsFolder =
          t.toRole === 'inbox' ? this.db.getFolderByRole(t.accountId, 'drafts') : null;
        if (draftsFolder) {
          // Undo of a delete: drafts return to the Drafts folder, the rest to the inbox.
          await this.relocateThread(t.accountId, t.threadId, isSource, draftsFolder, (m) => m.draft);
          await this.relocateThread(t.accountId, t.threadId, isSource, dest, (m) => !m.draft);
        } else {
          await this.relocateThread(t.accountId, t.threadId, isSource, dest);
        }
        this.db.setPlacement(t.threadId, t.toRole === 'inbox' ? 'inbox' : 'done');
        this.db.refreshThreadAggregates(t.threadId);
        this.delta({ kind: 'threads-changed', accountIds: [t.accountId] });
        break;
      }
      case 'snooze-thread': {
        const sync = this.sync(t.accountId);
        const dest = await sync.ensureAppFolder('Snoozed', 'snoozed');
        await this.relocateThread(t.accountId, t.threadId, (f) => f.role === 'inbox', dest);
        this.db.upsertSnooze(t.threadId, t.wakeAt, t.alert);
        this.db.setPlacement(t.threadId, 'snoozed');
        this.scheduler?.reschedule();
        this.delta({ kind: 'threads-changed', accountIds: [t.accountId] });
        break;
      }
      case 'unsnooze-thread': {
        const inbox = this.db.getFolderByRole(t.accountId, 'inbox');
        if (!inbox) throw new Error('no inbox folder');
        await this.relocateThread(
          t.accountId,
          t.threadId,
          (f) => f.role === 'snoozed' || isAppFolder(f.path, 'Snoozed'),
          inbox,
        );
        this.db.deleteSnooze(t.threadId);
        this.db.setPlacement(t.threadId, 'inbox');
        if (t.markUnread) await this.markLatestUnread(t.accountId, t.threadId);
        this.db.refreshThreadAggregates(t.threadId);
        this.scheduler?.reschedule();
        this.delta({ kind: 'threads-changed', accountIds: [t.accountId] });
        if (t.notify) {
          const thread = this.db.listThreads({ view: 'inbox', accountId: t.accountId, limit: 500, offset: 0 })
            .find((x) => x.id === t.threadId);
          this.delta({
            kind: 'notify',
            title: 'Snoozed email is back',
            body: thread?.subject || '(no subject)',
            threadId: t.threadId,
          });
        }
        break;
      }
      case 'set-aside-thread': {
        const sync = this.sync(t.accountId);
        if (t.aside) {
          const dest = await sync.ensureAppFolder('Set Aside', 'other');
          await this.relocateThread(t.accountId, t.threadId, (f) => f.role === 'inbox', dest);
          this.db.setPlacement(t.threadId, 'set_aside');
        } else {
          const inbox = this.db.getFolderByRole(t.accountId, 'inbox');
          if (!inbox) throw new Error('no inbox folder');
          await this.relocateThread(t.accountId, t.threadId, (f) => isAppFolder(f.path, 'Set Aside'), inbox);
          this.db.setPlacement(t.threadId, 'inbox');
        }
        this.db.refreshThreadAggregates(t.threadId);
        this.delta({ kind: 'threads-changed', accountIds: [t.accountId] });
        break;
      }
      case 'set-reminder': {
        this.db.upsertReminder(t.threadId, t.remindAt);
        this.scheduler?.reschedule();
        this.delta({ kind: 'threads-changed', accountIds: [t.accountId] });
        break;
      }
      case 'cancel-reminder': {
        this.db.deleteReminder(t.threadId);
        this.scheduler?.reschedule();
        this.delta({ kind: 'threads-changed', accountIds: [t.accountId] });
        break;
      }
      case 'fire-reminder': {
        await this.markLatestUnread(t.accountId, t.threadId);
        this.db.refreshThreadAggregates(t.threadId);
        const messages = this.db.getMessagesByThread(t.threadId);
        const subject = messages[messages.length - 1]?.subject || '(no subject)';
        this.delta({ kind: 'threads-changed', accountIds: [t.accountId] });
        this.delta({ kind: 'notify', title: 'Reminder', body: subject, threadId: t.threadId });
        break;
      }
      case 'schedule-send': {
        const account = this.db.getAccount(t.draft.accountId);
        if (!account) throw new Error('account not ready');
        const raw = await composeRaw(this.db, account, t.draft);
        this.db.insertScheduledSend({
          id: newId(),
          accountId: account.id,
          sendAt: t.sendAt,
          rawMime: raw.toString('utf8'),
          draft: t.draft,
        });
        this.scheduler?.reschedule();
        this.delta({ kind: 'threads-changed', accountIds: [account.id] });
        break;
      }
      case 'send-scheduled-now': {
        const row = this.db.getScheduledSend(t.scheduledId);
        if (!row) return;
        const account = this.db.getAccount(row.accountId);
        if (!account) throw new Error('account not ready');
        const password = await this.freshSecret(account.id);
        this.db.setScheduledStatus(t.scheduledId, 'sending');
        const raw = Buffer.from(row.raw, 'utf8');
        try {
          await smtpSend(account, password, row.draft, raw);
        } catch (err) {
          this.db.setScheduledStatus(t.scheduledId, 'overdue');
          throw err;
        }
        // Sent: commit before any bookkeeping so a later IMAP failure can't
        // leave the row 'overdue' (and a "Send now" that sends it twice).
        this.db.deleteScheduledSend(t.scheduledId);
        await this.afterSend(account.id, raw, row.draft);
        this.delta({ kind: 'threads-changed', accountIds: [account.id] });
        break;
      }
      case 'cancel-scheduled': {
        this.db.deleteScheduledSend(t.scheduledId);
        this.scheduler?.reschedule();
        this.delta({ kind: 'accounts-changed' });
        break;
      }
      case 'set-category': {
        this.db.setSenderCategory(t.accountId, t.key, t.kind, t.category, 'user');
        this.db.reclassifyThreadsForSender(t.accountId, t.key, t.kind, t.category);
        // User overrides (never heuristics) mirror to Uniox/<Category> labels
        // so other clients pick the classification up from the server.
        const account = this.db.getAccount(t.accountId);
        if (account && isGmailAccount(account)) {
          const sync = await this.waitForAccount(t.accountId);
          const pattern = SyncService.senderPattern(t.key, t.kind);
          const targetName = categoryLabelName(t.category);
          // Drop the sender from every other category label first…
          for (const name of Object.values(CATEGORY_LABELS)) {
            if (name === targetName) continue;
            const existing = this.db
              .listFolders(t.accountId)
              .find((f) => isAppFolder(f.path, name));
            if (existing) await this.unlabelSender(sync, existing, pattern);
          }
          // …then label them with the new category (personal = no label).
          if (targetName) {
            const label = await sync.ensureAppFolder(targetName, 'other');
            const exclude = new Set(
              this.db
                .listFolders(t.accountId)
                .filter((f) => isAppNamespacePath(f.path))
                .map((f) => f.id),
            );
            for (const { path, uids } of this.senderMessagesByFolder(t.accountId, pattern, exclude).values()) {
              await sync.copyMessages(path, uids, label.path);
            }
            await sync.syncFolder(label);
          }
        }
        this.delta({ kind: 'threads-changed', accountIds: [t.accountId] });
        break;
      }
      case 'gatekeeper-decide': {
        this.db.setReputation(t.accountId, t.key, t.kind, t.decision);
        if (t.decision === 'blocked') {
          // future mail auto-archives via the hook; sweep what's already here
          const rows = this.db.raw
            .prepare(
              `SELECT DISTINCT m.thread_id FROM messages m
               JOIN threads th ON th.id = m.thread_id
               WHERE m.account_id = ? AND m.from_json LIKE ? AND th.placement = 'inbox'`,
            )
            .all(t.accountId, t.kind === 'address' ? `%"${t.key}"%` : `%@${t.key}"%`) as {
            thread_id: string;
          }[];
          for (const r of rows) {
            this.enqueue({ type: 'move-thread', accountId: t.accountId, threadId: r.thread_id, toRole: 'archive' });
          }
        }
        // Blocks mirror to Uniox/Blocked (Gmail only, like Priority/categories)
        // so other clients pick them up; accepting withdraws the membership.
        const account = this.db.getAccount(t.accountId);
        if (account && isGmailAccount(account)) {
          const pattern = SyncService.senderPattern(t.key, t.kind);
          if (t.decision === 'blocked') {
            const sync = await this.waitForAccount(t.accountId);
            const label = await sync.ensureAppFolder('Blocked', 'other');
            const exclude = new Set(
              this.db
                .listFolders(t.accountId)
                .filter((f) => isAppNamespacePath(f.path))
                .map((f) => f.id),
            );
            for (const { path, uids } of this.senderMessagesByFolder(t.accountId, pattern, exclude).values()) {
              await sync.copyMessages(path, uids, label.path);
            }
            await sync.syncFolder(label);
          } else {
            const existing = this.db
              .listFolders(t.accountId)
              .find((f) => isAppFolder(f.path, 'Blocked'));
            if (existing) {
              const sync = await this.waitForAccount(t.accountId);
              await this.unlabelSender(sync, existing, pattern);
            }
          }
        }
        this.delta({ kind: 'threads-changed', accountIds: [t.accountId] });
        break;
      }
      case 'set-pinned': {
        this.db.raw
          .prepare(`UPDATE threads SET pinned = ? WHERE id = ?`)
          .run(t.pinned ? 1 : 0, t.threadId);
        this.delta({ kind: 'threads-changed', accountIds: [t.accountId] });
        break;
      }
      case 'set-priority-sender': {
        const email = t.email.trim().toLowerCase();
        this.db.setPrioritySender(t.accountId, email, t.priority);
        const account = this.db.getAccount(t.accountId);
        // Label mirroring is Gmail-only: a COPY on plain IMAP would duplicate
        // the message instead of just adding a label.
        if (account && isGmailAccount(account)) {
          const sync = await this.waitForAccount(t.accountId);
          const label = await sync.ensureAppFolder('Priority', 'other');
          const pattern = SyncService.senderPattern(email, 'address');
          if (t.priority) {
            const sources = this.senderMessagesByFolder(t.accountId, pattern, new Set([label.id]));
            for (const { path, uids } of sources.values()) {
              await sync.copyMessages(path, uids, label.path);
            }
            await sync.syncFolder(label);
          } else {
            await this.unlabelSender(sync, label, pattern);
          }
        }
        this.delta({ kind: 'threads-changed', accountIds: [t.accountId] });
        break;
      }
      case 'apply-label': {
        const account = this.db.getAccount(t.accountId);
        if (!account || !isGmailAccount(account)) break;
        const m = this.db.getMessage(t.messageId);
        if (!m) break;
        const src = this.db.getFolder(m.folderId);
        if (!src) break;
        const sync = await this.waitForAccount(t.accountId);
        const label = await sync.ensureAppFolder(t.label, 'other');
        const hdr = (
          this.db.raw.prepare(`SELECT message_id_hdr FROM messages WHERE id = ?`).get(m.id) as
            | { message_id_hdr: string | null }
            | undefined
        )?.message_id_hdr;
        // A copy already sits in the label folder — idempotent no-op.
        if (
          hdr &&
          this.db.raw
            .prepare(`SELECT 1 FROM messages WHERE folder_id = ? AND message_id_hdr = ?`)
            .get(label.id, hdr)
        ) {
          break;
        }
        await sync.copyMessages(src.path, [m.uid], label.path);
        await sync.syncFolder(label);
        break;
      }
      case 'fetch-body': {
        const m = this.db.getMessage(t.messageId);
        if (!m) return;
        // Several views ask for the same body at once and each miss enqueues a
        // fetch; the queue is serial, so later duplicates find it already stored.
        if (this.db.getBody(t.messageId)) return;
        const sync = await this.waitForAccount(m.accountId);
        await sync.fetchBody(m);
        break;
      }
      case 'sync-now': {
        const targets = t.accountId ? [this.sync(t.accountId)] : [...this.accounts.values()];
        for (const s of targets) await s.syncAllFolders();
        break;
      }
    }
  }
}
