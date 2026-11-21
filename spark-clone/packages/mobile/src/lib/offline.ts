import type { ComposeDraft, MobileMessage, MobileThread } from '../data/types';

/**
 * Offline support: the last inbox and recently opened threads are kept in
 * localStorage so they open with no signal, and replies written offline wait
 * in an outbox until the phone is back online. Storage can be unavailable
 * (private mode), so every access is guarded.
 */
const K = {
  inbox: 'uniox.inbox',
  thread: 'uniox.thread.',
  recent: 'uniox.recentThreads',
  outbox: 'uniox.outbox',
};
const MAX_THREADS = 40;
const MAX_HTML = 200_000;

function read<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* full or blocked: offline cache is best-effort */
  }
}

export const cachedInbox = () => read<MobileThread[]>(K.inbox) ?? [];
export const cacheInbox = (threads: MobileThread[]) => write(K.inbox, threads.slice(0, 200));

export function cachedThread(id: string) {
  return read<{ thread: MobileThread; messages: MobileMessage[] }>(K.thread + id);
}
export function cacheThread(id: string, data: { thread: MobileThread; messages: MobileMessage[] }) {
  const slim = {
    ...data,
    messages: data.messages.map((m) => ({
      ...m,
      html: m.html && m.html.length > MAX_HTML ? null : m.html,
    })),
  };
  write(K.thread + id, slim);
  const recent = (read<string[]>(K.recent) ?? []).filter((x) => x !== id);
  recent.unshift(id);
  for (const old of recent.splice(MAX_THREADS)) {
    try {
      localStorage.removeItem(K.thread + old);
    } catch {
      /* ignore */
    }
  }
  write(K.recent, recent);
}

export interface QueuedSend {
  id: string;
  draft: ComposeDraft;
  queuedAt: number;
}
export const outbox = () => read<QueuedSend[]>(K.outbox) ?? [];
export function enqueue(draft: ComposeDraft): QueuedSend {
  const item = { id: crypto.randomUUID(), draft, queuedAt: Date.now() };
  write(K.outbox, [...outbox(), item]);
  return item;
}
export function dequeue(id: string) {
  write(
    K.outbox,
    outbox().filter((x) => x.id !== id),
  );
}

/** Sends everything queued; keeps what still fails. Returns how many went out. */
export async function flushOutbox(send: (d: ComposeDraft) => Promise<void>): Promise<number> {
  let sent = 0;
  for (const item of outbox()) {
    try {
      await send(item.draft);
      dequeue(item.id);
      sent++;
    } catch {
      break;
    }
  }
  return sent;
}

export const isNetworkError = (e: unknown) =>
  !navigator.onLine || (e instanceof TypeError && /fetch|network|load failed/i.test(e.message));
