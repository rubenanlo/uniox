import { utilityProcess, type UtilityProcess } from 'electron';
import { join } from 'node:path';
import type { DeltaEvent, MainToSync, SyncToMain, Task } from '@app/shared';
import type { CredentialStore } from './credentials';
import { refreshGoogleToken } from './google-auth';

const QUERY_TIMEOUT_MS = 30_000;
const RESTART_MIN_MS = 1_500;
const RESTART_MAX_MS = 60_000;

/**
 * Owns the sync utilityProcess: spawn, supervise (restart on crash),
 * request/response correlation for queries, delta fan-out.
 */
export class SyncBridge {
  private proc: UtilityProcess | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  private stopped = false;
  private readonly tokenCache = new Map<string, { accessToken: string; expiresAt: number }>();
  /** One in-flight refresh per account: launch + waitForAccount can ask several times at once. */
  private readonly refreshing = new Map<string, Promise<{ accessToken: string; expiresAt: number }>>();
  /** Crash-restart delay; doubles on each crash, resets once the process reports ready. */
  private restartDelay = RESTART_MIN_MS;
  private restartTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly opts: {
      dbPath: string;
      attachmentsDir: string;
      credentials: CredentialStore;
      onDelta: (event: DeltaEvent) => void;
    },
  ) {}

  start(): void {
    if (this.stopped) return;
    const entry = join(__dirname, 'sync.js');
    const proc = utilityProcess.fork(entry, [], { serviceName: 'mail-sync', stdio: 'inherit' });
    this.proc = proc;

    proc.on('message', (msg: SyncToMain) => this.handleMessage(msg));
    proc.on('exit', (code) => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('sync process exited'));
      }
      this.pending.clear();
      this.proc = null;
      if (!this.stopped) {
        // Back off so a process that dies on boot (e.g. native ABI mismatch)
        // doesn't fork-loop every 1.5s forever.
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          this.start();
        }, this.restartDelay);
        this.restartDelay = Math.min(this.restartDelay * 2, RESTART_MAX_MS);
      }
      if (code !== 0) console.error(`[main] sync process exited with code ${code}`);
    });

    this.send({ kind: 'init', dbPath: this.opts.dbPath, attachmentsDir: this.opts.attachmentsDir });
  }

  stop(): void {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.proc?.kill();
    this.proc = null;
  }

  private send(msg: MainToSync): void {
    this.proc?.postMessage(msg);
  }

  private handleMessage(msg: SyncToMain): void {
    switch (msg.kind) {
      case 'ready':
        this.restartDelay = RESTART_MIN_MS;
        break;
      case 'need-credentials':
        void this.resolveCredentials(msg.accountId);
        break;
      case 'query-result': {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.error) p.reject(new Error(msg.error));
          else p.resolve(msg.result);
        }
        break;
      }
      case 'task-enqueued': {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          clearTimeout(p.timer);
          p.resolve({ taskId: msg.taskId });
        }
        break;
      }
      case 'delta':
        this.opts.onDelta(msg.event);
        break;
    }
  }

  private request(build: (id: number) => MainToSync): Promise<unknown> {
    if (!this.proc) return Promise.reject(new Error('sync process not running'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('sync request timed out'));
      }, QUERY_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.send(build(id));
    });
  }

  query(channel: string, args: unknown): Promise<unknown> {
    return this.request((id) => ({ kind: 'query', id, channel, args }));
  }

  enqueueTask(task: Task): Promise<unknown> {
    return this.request((id) => ({ kind: 'enqueue-task', id, task }));
  }

  provideCredentials(accountId: string, password: string): void {
    this.send({ kind: 'credentials', accountId, password });
  }

  power(state: 'suspend' | 'resume'): void {
    this.send({ kind: 'power', state });
  }

  /** Answer a sync-process credential request; refreshes OAuth tokens as needed. */
  async resolveCredentials(accountId: string): Promise<void> {
    const record = this.opts.credentials.getRecord(accountId);
    if (!record) {
      console.error(`[main] no stored credentials for account ${accountId}`);
      return;
    }
    if (record.type === 'password') {
      this.send({ kind: 'credentials', accountId, password: record.password, authType: 'password' });
      return;
    }
    try {
      let cached = this.tokenCache.get(accountId);
      if (!cached || cached.expiresAt < Date.now() + 2 * 60_000) {
        let inflight = this.refreshing.get(accountId);
        if (!inflight) {
          inflight = refreshGoogleToken(
            { clientId: record.clientId, clientSecret: record.clientSecret },
            record.refreshToken,
          ).finally(() => this.refreshing.delete(accountId));
          this.refreshing.set(accountId, inflight);
        }
        cached = await inflight;
        this.tokenCache.set(accountId, cached);
      }
      this.send({ kind: 'credentials', accountId, password: cached.accessToken, authType: 'oauth' });
    } catch (err) {
      console.error(`[main] Google token refresh failed for ${accountId}:`, err);
      // Surface it instead of letting the sync side time out silently.
      this.opts.onDelta({
        kind: 'sync-status',
        status: {
          accountId,
          state: 'error',
          detail: 'Google sign-in failed — reconnect this account in Settings.',
        },
      });
    }
  }

  primeToken(accountId: string, accessToken: string, expiresAt: number): void {
    this.tokenCache.set(accountId, { accessToken, expiresAt });
  }

  forgetToken(accountId: string): void {
    this.tokenCache.delete(accountId);
  }
}
