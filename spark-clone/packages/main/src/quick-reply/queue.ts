import type { NotifyPayload, QuickReplyItem } from '@app/shared';

/** How many notifications the ⌥⌘N list keeps, and for how long. */
export const QUEUE_MAX = 40;
export const QUEUE_MAX_AGE_MS = 24 * 3_600_000;

/** A mail notification is about its thread; a meeting alert about its event. */
function sameSubject(a: NotifyPayload, b: NotifyPayload): boolean {
  if (a.category === 'event' || b.category === 'event') {
    return a.category === b.category && a.title === b.title && a.startMs === b.startMs;
  }
  return !!a.threadId && a.threadId === b.threadId;
}

/**
 * The notifications behind the quick-reply overlay, newest first. Pure data,
 * so the rules (one row per thread or meeting, a size and age cap) are testable
 * without Electron.
 */
export class QuickReplyQueue {
  private items: QuickReplyItem[] = [];
  private seq = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** Add a notification; a newer one for the same thread replaces the older row. */
  record(payload: NotifyPayload): QuickReplyItem {
    const at = this.now();
    const item: QuickReplyItem = { ...payload, id: `q${++this.seq}`, at };
    this.items = [item, ...this.items.filter((i) => !sameSubject(i, payload))];
    this.prune();
    return item;
  }

  list(): QuickReplyItem[] {
    this.prune();
    return this.items;
  }

  get(id: string | null | undefined): QuickReplyItem | null {
    return (id && this.items.find((i) => i.id === id)) || null;
  }

  /** The row for this payload's thread or meeting, if it's still listed. */
  find(payload: NotifyPayload): QuickReplyItem | null {
    return this.items.find((i) => sameSubject(i, payload)) ?? null;
  }

  dismiss(id: string): boolean {
    const before = this.items.length;
    this.items = this.items.filter((i) => i.id !== id);
    return this.items.length !== before;
  }

  private prune(): void {
    const cutoff = this.now() - QUEUE_MAX_AGE_MS;
    this.items = this.items.filter((i) => i.at >= cutoff).slice(0, QUEUE_MAX);
  }
}
