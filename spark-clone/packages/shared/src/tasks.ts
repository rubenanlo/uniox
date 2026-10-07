import type { Address, Category } from './models';

export interface OutgoingAttachment {
  filename: string;
  contentType: string;
  dataBase64: string;
}

export interface OutgoingDraft {
  accountId: string;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  html: string;
  text: string;
  /** Message id (our DB id) being replied to, for In-Reply-To/References. */
  inReplyToMessageId?: string;
  /** Sending an edited draft: remove this draft message once the send succeeds. */
  deleteDraftMessageId?: string;
  attachments: OutgoingAttachment[];
}

/**
 * Durable UI → sync commands. The renderer never touches IMAP/SMTP or writes
 * the DB; it enqueues one of these and the sync process executes it.
 */
export type Task =
  | { type: 'send-draft'; draft: OutgoingDraft }
  | { type: 'save-draft'; draft: OutgoingDraft }
  | { type: 'set-seen'; accountId: string; messageIds: string[]; seen: boolean }
  | { type: 'set-flagged'; accountId: string; messageIds: string[]; flagged: boolean }
  | { type: 'move-thread'; accountId: string; threadId: string; toRole: 'archive' | 'trash' | 'inbox' }
  /** folderId/uid are stamped at enqueue time so the local row can be removed
   *  instantly (local-first) while the server-side move still knows its target. */
  | { type: 'delete-draft'; accountId: string; messageId: string; folderId?: string; uid?: number }
  | { type: 'purge-drafts' }
  | { type: 'set-pinned'; accountId: string; threadId: string; pinned: boolean }
  | { type: 'snooze-thread'; accountId: string; threadId: string; wakeAt: number | null; alert: boolean }
  | { type: 'unsnooze-thread'; accountId: string; threadId: string; markUnread: boolean; notify: boolean }
  | { type: 'set-aside-thread'; accountId: string; threadId: string; aside: boolean }
  | { type: 'set-reminder'; accountId: string; threadId: string; remindAt: number }
  | { type: 'cancel-reminder'; accountId: string; threadId: string }
  | { type: 'fire-reminder'; accountId: string; threadId: string }
  | { type: 'schedule-send'; draft: OutgoingDraft; sendAt: number }
  | { type: 'send-scheduled-now'; scheduledId: string }
  | { type: 'cancel-scheduled'; scheduledId: string }
  | { type: 'set-category'; accountId: string; key: string; kind: 'address' | 'domain'; category: Category }
  /** Priority senders sync as the Uniox/Priority Gmail label so every client agrees. */
  | { type: 'set-priority-sender'; accountId: string; email: string; priority: boolean }
  /** Copy one message into an app label (Uniox/<label>); enqueued by the ingest hook. */
  | { type: 'apply-label'; accountId: string; messageId: string; label: string }
  | { type: 'gatekeeper-decide'; accountId: string; key: string; kind: 'address' | 'domain'; decision: 'accepted' | 'blocked' }
  | { type: 'fetch-body'; accountId: string; messageId: string }
  | { type: 'sync-now'; accountId?: string };

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed';

export interface TaskRow {
  id: number;
  type: Task['type'];
  payload: Task;
  status: TaskStatus;
  attempts: number;
  lastError: string | null;
  createdAt: number;
}
