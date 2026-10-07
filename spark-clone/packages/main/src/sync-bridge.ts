import { utilityProcess, type UtilityProcess } from 'electron';
import { join } from 'node:path';
import type { DeltaEvent, MainToSync, SyncToMain, Task } from '@app/shared';
import type { CredentialStore } from './credentials';
import { refreshGoogleToken } from './google-auth';

const QUERY_TIMEOUT_MS = 30_000;

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

  constructor(
    private readonly opts: {
      dbPath: string;
      attachmentsDir: string;
      credentials: CredentialStore;
      onDelta: (event: DeltaEvent) => void;
    },
  ) {}

  start(): void {
    this.stopped = false;
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
        setTimeout(() => this.start(), 1_500);
      }
      if (code !== 0) console.error(`[main] sync process exited with code ${code}`);
    });

    this.send({ kind: 'init', dbPath: this.opts.dbPath, attachmentsDir: this.opts.attachmentsDir });
  }

  stop(): void {
    this.stopped = true;
    this.proc?.kill();
    this.proc = null;
  }

  private send(msg: MainToSync): void {
    this.proc?.postMessage(msg);
  }

  private handleMessage(msg: SyncToMain): void {
    switch (msg.kind) {
      case 'ready':
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
        cached = await refreshGoogleToken(
          { clientId: record.clientId, clientSecret: record.clientSecret },
          record.refreshToken,
        );
        this.tokenCache.set(accountId, cached);
      }
      this.send({ kind: 'credentials', accountId, password: cached.accessToken, authType: 'oauth' });
    } catch (err) {
      console.error(`[main] Google token refresh failed for ${accountId}:`, err);
    }
  }

  primeToken(accountId: string, accessToken: string, expiresAt: number): void {
    this.tokenCache.set(accountId, { accessToken, expiresAt });
  }
}
