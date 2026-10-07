import type { DeltaEvent, SyncStatus } from '@app/shared';

/**
 * Sync bursts (backfill, multi-folder poll) emit dozens of coarse deltas in a
 * row; each one makes the renderer re-run its list queries. Emit the first of
 * a burst immediately (snappy single events), then fold the rest into one
 * merged event per window.
 */
export class DeltaCoalescer {
  private timer: NodeJS.Timeout | null = null;
  private accountIds = new Set<string>();
  private statuses = new Map<string, SyncStatus>();
  private calendarChanged = false;
  private bodyMessageIds = new Set<string>();
  private bodyThreadIds = new Set<string>();

  constructor(
    private readonly emit: (e: DeltaEvent) => void,
    private readonly intervalMs = 250,
  ) {}

  push(e: DeltaEvent): void {
    switch (e.kind) {
      case 'threads-changed':
        if (!this.timer) {
          this.emit(e);
          this.arm();
        } else {
          for (const id of e.accountIds) this.accountIds.add(id);
        }
        break;
      case 'sync-status':
        if (!this.timer) {
          this.emit(e);
          this.arm();
        } else {
          this.statuses.set(e.status.accountId, e.status);
        }
        break;
      case 'calendar-changed':
        if (!this.timer) {
          this.emit(e);
          this.arm();
        } else {
          this.calendarChanged = true;
        }
        break;
      case 'message-body':
        if (!this.timer) {
          this.emit(e);
          this.arm();
        } else {
          for (const id of e.messageIds) this.bodyMessageIds.add(id);
          for (const id of e.threadIds) this.bodyThreadIds.add(id);
        }
        break;
      default:
        this.emit(e);
    }
  }

  private arm(): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      const ids = [...this.accountIds];
      this.accountIds.clear();
      const statuses = [...this.statuses.values()];
      this.statuses.clear();
      const cal = this.calendarChanged;
      this.calendarChanged = false;
      const bodyMessageIds = [...this.bodyMessageIds];
      this.bodyMessageIds.clear();
      const bodyThreadIds = [...this.bodyThreadIds];
      this.bodyThreadIds.clear();
      if (ids.length) this.emit({ kind: 'threads-changed', accountIds: ids });
      for (const status of statuses) this.emit({ kind: 'sync-status', status });
      if (cal) this.emit({ kind: 'calendar-changed' });
      if (bodyMessageIds.length) {
        this.emit({ kind: 'message-body', messageIds: bodyMessageIds, threadIds: bodyThreadIds });
      }
      // A flush that carried anything re-arms once more so a still-running
      // burst keeps coalescing instead of emitting per-event again.
      if (ids.length || statuses.length || cal || bodyMessageIds.length) this.arm();
    }, this.intervalMs);
  }
}
