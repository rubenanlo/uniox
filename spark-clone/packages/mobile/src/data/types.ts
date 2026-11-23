import type { Address, Category } from '@app/shared';

export type { Address, Category };

/** A connected Google account. Tokens never reach the phone; they live server-side. */
export interface MobileAccount {
  id: string;
  email: string;
  displayName: string;
  color: string;
  status: 'syncing' | 'ok' | 'error';
  lastSyncAt: number | null;
}

export interface MobileThread {
  id: string;
  accountId: string;
  subject: string;
  snippet: string;
  participants: Address[];
  lastFrom: Address | null;
  lastMessageAt: number;
  messageCount: number;
  unreadCount: number;
  hasAttachments: boolean;
  pinned: boolean;
  priority: boolean;
  category: Category;
  inInbox: boolean;
  snoozeUntil: number | null;
}

export interface MobileAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
}

export interface MobileMessage {
  id: string;
  threadId: string;
  accountId: string;
  from: Address | null;
  to: Address[];
  cc: Address[];
  date: number;
  snippet: string;
  /** Sanitized server-side and again on render. */
  html: string | null;
  text: string | null;
  fromMe: boolean;
  unread: boolean;
  attachments: MobileAttachment[];
  /** Present when the message carries a calendar invitation. */
  invite?: InviteInfo;
}

export type RsvpAnswer = 'accepted' | 'tentative' | 'declined';

export interface InviteInfo {
  eventId: string | null;
  title: string;
  startMs: number;
  endMs: number;
  meetingUrl?: string;
  organizer: Address | null;
  guests: Address[];
  myAnswer: RsvpAnswer | null;
}

export interface MobileEvent {
  id: string;
  accountId: string;
  /** Google calendar id; with accountId it tells mirrored copies apart. */
  calendarId: string;
  calendarName: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  color: string;
  location?: string;
  description?: string;
  meetingUrl?: string;
  attendees: Address[];
  organizer?: Address | null;
  myAnswer: RsvpAnswer | null;
  /** Free-time blocks (focus time, transparency=transparent). */
  free: boolean;
}

export interface ComposeDraft {
  accountId: string;
  to: Address[];
  cc: Address[];
  subject: string;
  body: string;
  /** Gmail thread being answered, when replying. */
  threadId?: string;
  inReplyToMessageId?: string;
}

export interface FirstRead {
  summary: string;
  replyIdeas: string[];
  freeSlots?: { startMs: number; endMs: number }[];
}

export interface AssistantTurn {
  role: 'user' | 'assistant';
  text: string;
}

export type NotifyMode = 'all' | 'priority';
export type ThemeMode = 'light' | 'dark' | 'auto';
export type ThreadLayout = 'cards' | 'chat';

/** Settings shared with the desktop app (one row per user in Supabase). */
export interface SharedSettings {
  theme: ThemeMode;
  /** Color theme used in light mode ('default', 'linen', 'glacier', 'sage'). */
  palette: string;
  /** Color theme used in dark mode ('default', 'midnight', 'ember', 'aubergine'). */
  paletteDark: string;
  glassTransparency: number;
  threadLayout: ThreadLayout;
  pushEnabled: boolean;
  notifyMode: NotifyMode;
  aiFirstRead: boolean;
  signatures: Record<string, string>;
}

export const DEFAULT_SETTINGS: SharedSettings = {
  theme: 'auto',
  palette: 'default',
  paletteDark: 'default',
  glassTransparency: 60,
  threadLayout: 'chat',
  pushEnabled: true,
  notifyMode: 'priority',
  aiFirstRead: true,
  signatures: {},
};

export interface SearchResults {
  answer: string | null;
  threads: MobileThread[];
  events: MobileEvent[];
}
