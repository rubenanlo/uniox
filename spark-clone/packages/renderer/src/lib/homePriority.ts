import type { Address, ThreadSummary } from '@app/shared';
import { isPriorityThread, senderLabel } from './utils';

/**
 * When a thread last had something actually arrive. Falls back to the thread
 * date for rows written before last_inbound_date existed, so an un-migrated
 * cache degrades to the old behaviour instead of showing an empty Home.
 */
export function arrivedAt(t: ThreadSummary): number {
  return t.lastInboundDate ?? t.lastMessageDate;
}

/**
 * Priority mail that arrived since the app was last open, oldest first.
 *
 * Keyed off the newest message from someone else, so saving a draft or sending
 * a reply no longer drags an old thread back onto Home.
 */
export function freshPriorityThreads(
  threads: ThreadSummary[],
  prio: Set<string>,
  baseline: number,
): ThreadSummary[] {
  return threads
    .filter((t) => {
      if (!isPriorityThread(t, prio)) return false;
      const at = arrivedAt(t);
      // 0 means the thread holds nothing but our own mail.
      return at > 0 && at >= baseline;
    })
    .sort((a, b) => arrivedAt(a) - arrivedAt(b));
}

/** The correspondent to name on Home: whoever actually sent the new message. */
export function inboundSender(t: ThreadSummary): Address | null {
  return t.lastInboundFrom ?? t.participants[0] ?? null;
}

export function inboundSenderLabel(t: ThreadSummary): string {
  return senderLabel(inboundSender(t));
}
