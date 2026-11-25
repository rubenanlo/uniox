import type { MobileThread } from '../data/types';

type Patch = (list: MobileThread[]) => MobileThread[];

interface Entry {
  threadId: string;
  apply: Patch;
  /** When the server write finished; null while it is still in flight. */
  settledAt: number | null;
}

/**
 * Optimistic thread actions that the server may not reflect yet.
 *
 * Every refresh re-applies them on top of what the server returned, so a
 * fetch that raced an in-flight archive (archive A finishes, its realtime
 * change refetches while B's write is still going) can't put B back in the
 * list for a moment. An entry is dropped once a refresh that started after
 * its write finished comes back, because that answer already includes it.
 */
export class PendingActions {
  private entries = new Map<number, Entry>();
  private next = 1;

  begin(threadId: string, apply: Patch): number {
    // The newest intent for a thread wins (archive, then undo).
    for (const [id, e] of this.entries) if (e.threadId === threadId) this.entries.delete(id);
    const id = this.next++;
    this.entries.set(id, { threadId, apply, settledAt: null });
    return id;
  }

  settle(id: number, at = Date.now()): void {
    const e = this.entries.get(id);
    if (e) e.settledAt = at;
  }

  drop(id: number): void {
    this.entries.delete(id);
  }

  applyTo(list: MobileThread[]): MobileThread[] {
    let out = list;
    for (const e of this.entries.values()) out = e.apply(out);
    return out;
  }

  /** Forget entries the refresh that began at `startedAt` already reflects. */
  prune(startedAt: number): void {
    for (const [id, e] of this.entries) {
      if (e.settledAt !== null && e.settledAt <= startedAt) this.entries.delete(id);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

export const without = (threadId: string): Patch => (list) => list.filter((t) => t.id !== threadId);

/** Put this version of the thread in the list, replacing any copy, newest first. */
export const withThread = (thread: MobileThread): Patch => (list) =>
  [...list.filter((t) => t.id !== thread.id), thread].sort((a, b) => b.lastMessageAt - a.lastMessageAt);
