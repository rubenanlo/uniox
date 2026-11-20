import { api } from './api';
import { replyIdeas } from './quickReplyAi';
import type { ReplyIdeas } from './quickReply';

/**
 * The assistant's first read of an email (summary, reply ideas, forward,
 * meeting length) is made once per newest message and reused: reopening the
 * email, or opening it in the ⌥⌘N island and then the chat view, costs no new
 * Claude call. A new message in the thread has a new id, so it gets a fresh
 * read. Saved in settings so the island window and the main window share it
 * and it survives restarts; the oldest entries fall off past MAX_ENTRIES.
 */

const SETTING = 'aiReplyIdeas';
const MAX_ENTRIES = 300;

type Store = Record<string, { at: number; ideas: ReplyIdeas }>;

const memory = new Map<string, ReplyIdeas>();
/** Reads in flight, so two views opening the same email share one call. */
const pending = new Map<string, Promise<ReplyIdeas>>();

async function loadStore(): Promise<Store> {
  try {
    const v = await api.query('settings:get', { key: SETTING });
    return v && typeof v === 'object' ? (v as Store) : {};
  } catch {
    return {};
  }
}

async function save(messageId: string, ideas: ReplyIdeas): Promise<void> {
  // Re-read first: the other window may have added entries since.
  const store = await loadStore();
  store[messageId] = { at: Date.now(), ideas };
  const keep = Object.entries(store)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_ENTRIES);
  await api.command('settings:set', { key: SETTING, value: Object.fromEntries(keep) }).catch(() => {});
}

/** The cached read of `messageId`, else one fresh read of `context` (then cached). */
export async function cachedReplyIdeas(messageId: string, context: string): Promise<ReplyIdeas> {
  const hit = memory.get(messageId);
  if (hit) return hit;
  const inFlight = pending.get(messageId);
  if (inFlight) return inFlight;
  const run = (async () => {
    const saved = (await loadStore())[messageId]?.ideas;
    if (saved) {
      memory.set(messageId, saved);
      return saved;
    }
    const read = await replyIdeas(context);
    memory.set(messageId, read);
    void save(messageId, read);
    return read;
  })();
  pending.set(messageId, run);
  try {
    return await run;
  } finally {
    pending.delete(messageId);
  }
}
