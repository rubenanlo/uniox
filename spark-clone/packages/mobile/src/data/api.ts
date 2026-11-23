import type {
  AssistantTurn,
  ComposeDraft,
  FirstRead,
  MobileAccount,
  MobileEvent,
  MobileMessage,
  MobileThread,
  RsvpAnswer,
  SearchResults,
  SharedSettings,
} from './types';

export interface AiKeyStatus {
  set: boolean;
  hint?: string;
}

export type ThreadAction =
  | { kind: 'archive' }
  /** Back to the inbox (undo archive/snooze). */
  | { kind: 'inbox' }
  | { kind: 'trash' }
  | { kind: 'read'; read: boolean }
  | { kind: 'pin'; pinned: boolean }
  | { kind: 'snooze'; until: number };

/**
 * Everything the phone UI needs from a backend. Two implementations:
 * `mockApi` (sample data, used for demos and when Supabase isn't configured)
 * and `supabaseApi` (the real backend).
 */
export interface UnioxApi {
  readonly kind: 'mock' | 'supabase';
  /** Signed-in user's email, or null when signed out. */
  session(): Promise<{ email: string } | null>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  /** Opens Google's consent screen to connect another Gmail account. */
  connectAccount(): Promise<void>;
  accounts(): Promise<MobileAccount[]>;
  /** Asks the server to pull from Gmail/Calendar right now. */
  syncNow(): Promise<void>;

  threads(opts: { accountId?: string; limit?: number }): Promise<MobileThread[]>;
  thread(id: string): Promise<{ thread: MobileThread; messages: MobileMessage[] }>;
  act(threadId: string, action: ThreadAction): Promise<void>;
  send(draft: ComposeDraft): Promise<void>;

  events(fromMs: number, toMs: number): Promise<MobileEvent[]>;
  rsvp(eventId: string, accountId: string, answer: RsvpAnswer): Promise<void>;
  /** Propose a new time to the organizer (iTIP COUNTER, like Gmail). */
  proposeTime(eventId: string, startMs: number, endMs: number, label: string): Promise<void>;
  /** Busy blocks per email (null = not visible to you); `me` is your own address. */
  freeBusy(
    accountId: string,
    emails: string[],
    fromMs: number,
    toMs: number,
  ): Promise<{ me: string; busy: Record<string, { startMs: number; endMs: number }[] | null> }>;
  createEvent(input: {
    accountId: string;
    title: string;
    startMs: number;
    endMs: number;
    addMeet: boolean;
  }): Promise<void>;

  search(query: string): Promise<SearchResults>;

  firstRead(threadId: string): Promise<FirstRead>;
  rewrite(body: string, instruction: string): Promise<string>;
  assistant(history: AssistantTurn[]): Promise<string>;

  /** Whether this user has stored an Anthropic key; `hint` is its last 4 characters. */
  aiKey(): Promise<AiKeyStatus>;
  /** Sends the key to the server once. It is stored encrypted and never comes back. */
  setAiKey(key: string): Promise<AiKeyStatus>;
  clearAiKey(): Promise<void>;

  settings(): Promise<SharedSettings>;
  saveSettings(patch: Partial<SharedSettings>): Promise<void>;
  /** Registers this device for Web Push (requires Home Screen install on iOS). */
  registerPush(sub: PushSubscriptionJSON): Promise<void>;

  /** Called when the backend pushes changes; returns an unsubscribe. */
  onChange(cb: () => void): () => void;
}
