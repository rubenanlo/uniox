import type { ThreadSummary } from '@app/shared';
import { api } from './api';

/** Queue a mailbox move for every thread (bundle rows, group bulk actions). */
export function moveThreads(threads: ThreadSummary[], toRole: 'inbox' | 'archive' | 'trash') {
  for (const t of threads) {
    void api.command('task:enqueue', {
      type: 'move-thread',
      accountId: t.accountId,
      threadId: t.id,
      toRole,
    });
  }
}

/** Mark every unseen message in the given threads as read. */
export async function markThreadsRead(threads: ThreadSummary[]) {
  for (const t of threads.filter((x) => x.unreadCount > 0)) {
    const messages = await api.query('thread:messages', { threadId: t.id });
    const ids = messages.filter((m) => !m.seen).map((m) => m.id);
    if (ids.length) {
      void api.command('task:enqueue', {
        type: 'set-seen',
        accountId: t.accountId,
        messageIds: ids,
        seen: true,
      });
    }
  }
}
