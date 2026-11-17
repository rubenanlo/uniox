import type { NotifyPayload, QuickReplyItem } from '@app/shared';

/** How many notifications the ⌥⌘N list keeps, and for how long (kept emails aside). */
export const QUEUE_MAX = 40;
export const QUEUE_MAX_AGE_MS = 24 * 3_600_000;
/** Kept emails have their own cap, so the list (and the saved setting) can't grow without bound. */
export const KEPT_MAX = 50;

/** A mail notification is about its thread; a meeting alert about its event. */
function sameSubject(a: NotifyPayload, b: NotifyPayload): boolean {
  if (a.category === 'event' || b.category === 'event') {
    return a.category === b.category && a.title === b.title && a.startMs === b.startMs;
  }
  return !!a.threadId && a.threadId === b.threadId;
}

/**
 * The notifications behind the quick-reply overlay, newest first. Pure data,
 * so the rules (one row per thread or meeting, a size and age cap, kept
 * emails exempt from both) are testable without Electron.
 */
export class QuickReplyQueue {
  private items: QuickReplyItem[] = [];
  private seq = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** Add a notification; a newer one for the same thread replaces the older row (and stays kept if it was). */
  record(payload: NotifyPayload): QuickReplyItem {
    const at = this.now();
    const old = this.items.find((i) => sameSubject(i, payload));
    const item: QuickReplyItem = { ...payload, id: `q${++this.seq}`, at, ...(old?.kept ? { kept: true } : {}) };
    // A real notification for a thread first opened from "Still unread" is a notification now.
    if (!payload.origin) delete item.origin;
    this.items = [item, ...this.items.filter((i) => i !== old)];
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

  /** Keep a listed email (or stop keeping it). False when there's no such row. */
  keep(id: string, on: boolean): boolean {
    const item = this.items.find((i) => i.id === id);
    if (!item) return false;
    if (on) item.kept = true;
    else delete item.kept;
    this.prune();
    return true;
  }

  kept(): QuickReplyItem[] {
    return this.items.filter((i) => i.kept);
  }

  /** Put saved kept emails back (on launch), behind anything already listed for the same thread. */
  restore(saved: QuickReplyItem[]): void {
    for (const s of saved) {
      if (!s || typeof s !== 'object' || typeof s.title !== 'string' || typeof s.at !== 'number') continue;
      if (this.find(s)) continue;
      this.items.push({ ...s, id: `q${++this.seq}`, kept: true });
    }
    this.items.sort((a, b) => b.at - a.at);
    this.prune();
  }

  private prune(): void {
    const cutoff = this.now() - QUEUE_MAX_AGE_MS;
    let fresh = 0;
    let kept = 0;
    this.items = this.items.filter((i) => {
      if (i.kept) return ++kept <= KEPT_MAX;
      return i.at >= cutoff && ++fresh <= QUEUE_MAX;
    });
  }
}
