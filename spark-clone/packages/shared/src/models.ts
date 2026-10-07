export type FolderRole =
  | 'inbox'
  | 'sent'
  | 'drafts'
  | 'archive'
  | 'trash'
  | 'spam'
  | 'snoozed'
  | 'outbox'
  | 'other';

/** Non-secret connection config. Credentials go to the OS keychain, never the DB. */
export interface ImapEndpoint {
  host: string;
  port: number;
  secure: boolean;
  /** Dev-only escape hatch for self-signed certs (the local Dovecot). */
  allowInsecureTls?: boolean;
}

export interface SmtpEndpoint {
  host: string;
  port: number;
  secure: boolean;
  allowInsecureTls?: boolean;
}

export type AuthType = 'password' | 'oauth-google';

export interface AccountConfig {
  email: string;
  displayName?: string;
  imap: ImapEndpoint;
  smtp: SmtpEndpoint;
  authType?: AuthType;
}

export interface Account {
  id: string;
  email: string;
  displayName: string;
  imap: ImapEndpoint;
  smtp: SmtpEndpoint;
  authType: AuthType;
}

export const GMAIL_ENDPOINTS = {
  imap: { host: 'imap.gmail.com', port: 993, secure: true },
  smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
} as const;

export interface Folder {
  id: string;
  accountId: string;
  path: string;
  role: FolderRole;
  delimiter: string | null;
}

export interface Address {
  name?: string;
  email: string;
}

/** One row in the mail list. */
export interface ThreadSummary {
  id: string;
  accountId: string;
  subject: string;
  participants: Address[];
  lastMessageDate: number;
  snippet: string;
  messageCount: number;
  unreadCount: number;
  hasAttachments: boolean;
  /** The thread contains an unsent draft (pencil row treatment, Spark-style). */
  hasDraft?: boolean;
  /** Everyone who wrote in the thread, most recent sender first. */
  senders?: Address[];
  /** The addresses from `senders`, same most-recent-first order. */
  fromEmails?: string[];
  /**
   * Date of the newest message that did NOT come from us (0 when the thread is
   * only our own mail). Unlike lastMessageDate this does not move when we save
   * a draft or send a reply, so it answers "did anything actually arrive?".
   */
  lastInboundDate?: number;
  /** Who sent that message, for surfaces that must name a real correspondent. */
  lastInboundFrom?: Address | null;
  pinned: boolean;
  category: Category;
  /** Snooze wake time when the thread is snoozed; null = Someday. */
  snoozeWakeAt?: number | null;
}

export interface MessageMeta {
  id: string;
  threadId: string;
  accountId: string;
  folderId: string;
  uid: number;
  subject: string;
  from: Address | null;
  to: Address[];
  cc: Address[];
  date: number;
  snippet: string;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  draft: boolean;
  hasAttachments: boolean;
}

export interface AttachmentMeta {
  id: string;
  messageId: string;
  filename: string;
  contentType: string;
  size: number;
  cid: string | null;
  /** Set once streamed to disk; renderer loads it via the app:// protocol. */
  localPath: string | null;
}

export interface MessageBodyPayload {
  messageId: string;
  html: string | null;
  text: string | null;
  attachments: AttachmentMeta[];
}

export type MailView =
  | 'home'
  | 'calendar'
  | 'inbox'
  | 'sent'
  | 'drafts'
  | 'archive'
  | 'trash'
  | 'spam'
  | 'pinned'
  | 'snoozed'
  | 'set_aside'
  | 'outbox';

export type Category = 'personal' | 'invites' | 'notifications' | 'newsletters' | 'promotions';

export type Placement = 'inbox' | 'done' | 'set_aside' | 'snoozed';

export type GatekeeperStatus = 'unknown' | 'pending' | 'accepted' | 'blocked';

export interface ScheduledSend {
  id: string;
  accountId: string;
  sendAt: number;
  status: 'pending' | 'sending' | 'sent' | 'overdue';
  subject: string;
  toLabel: string;
}

export interface Template {
  id: string;
  name: string;
  subject: string;
  bodyHtml: string;
  to: Address[];
  cc: Address[];
  bcc: Address[];
}

export interface Signature {
  id: string;
  name: string;
  bodyHtml: string;
}

export interface GatekeeperPending {
  key: string; // sender address
  kind: 'address' | 'domain';
  accountId: string;
  senderName: string;
  threadCount: number;
  latestThreadId: string;
  latestSubject: string;
  latestSnippet: string;
  latestDate: number;
}

export interface SchedulingPresets {
  laterTodayHours: number; // +N hours
  eveningHour: number; // e.g. 18
  morningHour: number; // e.g. 9
  weekendDay: 6 | 0; // Saturday | Sunday
  notify: boolean;
}

export const DEFAULT_SCHEDULING: SchedulingPresets = {
  laterTodayHours: 3,
  eveningHour: 18,
  morningHour: 9,
  weekendDay: 6,
  notify: true,
};

export interface ThreadQuery {
  view: MailView;
  /** undefined = unified across all accounts */
  accountId?: string;
  limit: number;
  offset: number;
}

export interface SyncStatus {
  accountId: string;
  state: 'connecting' | 'backfilling' | 'idle' | 'syncing' | 'error';
  detail?: string;
}

/** macOS system sounds offered for the new-mail notification. 'None' = silent. */
export const NOTIFY_SOUNDS = ['Glass', 'Ping', 'Pop', 'Purr', 'Hero', 'Submarine', 'Tink'] as const;
export type NotifySound = (typeof NOTIFY_SOUNDS)[number] | 'None';
export const DEFAULT_NOTIFY_SOUND: NotifySound = 'Glass';
