import type {
  Account,
  AccountConfig,
  Address,
  Folder,
  GatekeeperPending,
  MessageBodyPayload,
  MessageMeta,
  ScheduledSend,
  Signature,
  SyncStatus,
  Template,
  ThreadQuery,
  ThreadSummary,
} from './models';
import type { Calendar, CalendarEvent, CalendarEventInput } from './calendar';
import type { KanbanBoard, NotionBlock } from './notion';
import type { Task } from './tasks';

/** Typed invoke channels: renderer → main → (mostly) sync process. */
export interface Queries {
  'accounts:list': { args: undefined; result: Account[] };
  'folders:list': { args: { accountId?: string }; result: Folder[] };
  'threads:list': { args: ThreadQuery; result: ThreadSummary[] };
  'thread:messages': { args: { threadId: string }; result: MessageMeta[] };
  /** One thread regardless of view filters, for reading what the list hides. */
  'thread:get': { args: { threadId: string }; result: ThreadSummary | null };
  'message:body': { args: { messageId: string }; result: MessageBodyPayload | null };
  'search:threads': {
    args: { query: string; limit?: number; accountId?: string };
    result: ThreadSummary[];
  };
  /** Address autocomplete from mail history, ranked by use and recency. */
  'contacts:suggest': { args: { query: string; limit?: number }; result: Address[] };
  'settings:get': { args: { key: string }; result: unknown };
  'outbox:list': { args: undefined; result: ScheduledSend[] };
  'gatekeeper:pending': { args: undefined; result: GatekeeperPending[] };
  'templates:list': { args: undefined; result: Template[] };
  'signatures:list': { args: undefined; result: Signature[] };
  'priority:list': {
    args: undefined;
    result: { accountId: string; email: string; updatedAt: number }[];
  };
  /** Handled in the main process (not the sync worker), like all notion:*. */
  'notion:status': { args: undefined; result: { configured: boolean; hasClient: boolean } };
  'notion:board': { args: undefined; result: KanbanBoard | null };
  'notion:page': { args: { pageId: string }; result: NotionBlock[] };
  /** Whether the Claude API key is stored and which model is selected. */
  'ai:status': { args: undefined; result: { configured: boolean; model: string } };
  /** Events overlapping [startMs, endMs) — stored local/Google rows only. */
  'calendar:events': { args: { startMs: number; endMs: number }; result: CalendarEvent[] };
  /** All calendars (per-account local calendars are ensured on first call). */
  'calendar:list': { args: undefined; result: Calendar[] };
}

export type QueryChannel = keyof Queries;

/** A single turn in an assistant conversation sent to the model. */
export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Streamed output of an `ai:chat` turn, keyed by the request `id`. */
export type AiChunk =
  | { id: string; type: 'delta'; text: string }
  | { id: string; type: 'done' }
  | { id: string; type: 'error'; text: string };

export interface Commands {
  'task:enqueue': { args: Task; result: { taskId: number } };
  'account:add': {
    args: { config: AccountConfig; password: string };
    result: { ok: true; accountId: string } | { ok: false; error: string };
  };
  'account:test': {
    args: { config: AccountConfig; password: string };
    result: { ok: boolean; error?: string };
  };
  /** Interactive Google OAuth in the main process; client config persists after first use. */
  'account:add-google': {
    args: { clientId?: string; clientSecret?: string };
    result: { ok: true; accountId: string; email: string } | { ok: false; error: string };
  };
  /** `builtIn` = the build-time client will be used (no saved custom client). */
  'account:google-status': { args: undefined; result: { hasClient: boolean; builtIn: boolean } };
  /**
   * Re-run Google consent for an existing account (grants the calendar scope;
   * upgrades app-password Gmail accounts to OAuth). `calendars` counts the
   * account's visible Google calendars as scope verification.
   */
  'account:reconnect-google': {
    args: { accountId: string };
    result: { ok: boolean; error?: string; calendars?: number; warning?: string };
  };
  /**
   * Full disconnect: revoke the Google grant (if OAuth), forget credentials,
   * and delete the account with its locally cached mail and calendar. Mail on
   * the server is untouched.
   */
  'account:remove': {
    args: { accountId: string };
    result: { ok: boolean; error?: string };
  };
  'settings:set': { args: { key: string; value: unknown }; result: { ok: boolean } };
  /** Play a system sound in the main process so the settings picker can audition it. */
  'notify-sound:preview': { args: { sound: string }; result: { ok: boolean } };
  'templates:save': { args: Template; result: { ok: boolean } };
  'templates:delete': { args: { id: string }; result: { ok: boolean } };
  'signatures:save': { args: Signature & { accountId?: string }; result: { ok: boolean } };
  /** Quick Look (macOS) / default-app preview of a downloaded attachment. */
  'attachment:preview': { args: { localPath: string }; result: { ok: boolean } };
  /** Save dialog defaulting to ~/Downloads/<filename>, then copy the file. */
  'attachment:save': {
    args: { localPath: string; filename: string };
    result: { ok: boolean; path?: string };
  };
  /** One folder picker, then copy every file there (collisions get " (1)" names). */
  'attachment:save-all': {
    args: { files: { localPath: string; filename: string }[] };
    result: { ok: boolean; path?: string; saved?: number };
  };
  /** Validates against the Sprint board before storing (encrypted). */
  'notion:set-token': { args: { token: string }; result: { ok: boolean; error?: string } };
  /** Writes the task's Status back to Notion (board cache invalidated). */
  'notion:set-status': {
    args: { pageId: string; status: string };
    result: { ok: boolean; error?: string };
  };
  /** Browser OAuth grant flow; client config persists after first use (like Google). */
  'notion:connect': {
    args: { clientId?: string; clientSecret?: string };
    result: { ok: boolean; error?: string; workspace?: string };
  };
  /** Store the Claude API key and/or model (main process, safeStorage-backed). */
  'ai:config': {
    args: { key?: string; model?: string };
    result: { ok: boolean; error?: string };
  };
  /**
   * Start a streaming assistant turn. Tokens arrive out-of-band as `ai:chunk`
   * push events keyed by `id`; the promise resolves once the turn is accepted.
   */
  'ai:chat': {
    args: { id: string; messages: AiMessage[]; system?: string };
    result: { ok: boolean; error?: string };
  };
  /** Abort an in-flight `ai:chat` turn. */
  'ai:stop': { args: { id: string }; result: { ok: boolean } };
  /** Create (no id) or update a local calendar event. */
  'calendar:event:save': { args: { event: CalendarEventInput }; result: { ok: boolean; id: string } };
  /** Show/hide a calendar's events everywhere. */
  'calendar:setVisible': { args: { id: string; visible: boolean }; result: { ok: boolean } };
  /** Add another calendar (e.g. a colleague's, by email) to a Google account. */
  'calendar:subscribe': {
    args: { accountId: string; email: string };
    result: { ok: boolean; error?: string };
  };
  /** Unsubscribe from a Google calendar (removes it from the account entirely). */
  'calendar:unsubscribe': { args: { id: string }; result: { ok: boolean; error?: string } };
  /** Delete a local calendar event. */
  'calendar:event:delete': { args: { id: string }; result: { ok: boolean } };
  /**
   * Partial update (drag reschedule / edit) that keeps the event's source.
   * Google-sourced events PATCH upstream first; text fields only when changed.
   */
  'calendar:event:patch': {
    args: {
      id: string;
      startMs: number;
      endMs: number;
      allDay: boolean;
      title?: string;
      location?: string;
      description?: string;
      transparency?: 'opaque' | 'transparent';
    };
    result: { ok: boolean; error?: string };
  };
}

export type CommandChannel = keyof Commands;

/** Push events: sync → main → renderer. Coarse deltas; the renderer re-queries. */
export type DeltaEvent =
  | { kind: 'threads-changed'; accountIds: string[] }
  /** Bodies that just landed. Batched: a hydration pass fills many at once,
   *  and threadIds lets the reading pane ignore ones it isn't showing. */
  | { kind: 'message-body'; messageIds: string[]; threadIds: string[] }
  | { kind: 'accounts-changed' }
  | { kind: 'sync-status'; status: SyncStatus }
  /** category 'event' = meeting alert: shown even while the window is focused. */
  | { kind: 'notify'; title: string; body: string; threadId?: string; category?: 'event' }
  /** A system notification was clicked — the renderer opens that thread. */
  | { kind: 'open-thread'; threadId: string }
  /** A meeting-alert notification was clicked — the renderer shows the calendar. */
  | { kind: 'open-calendar' }
  /** Calendar events changed (local edit, or Google sync); renderer re-queries. */
  | { kind: 'calendar-changed' };

/** Surface exposed on window.api by the preload script. */
export interface RendererApi {
  query<C extends QueryChannel>(channel: C, args: Queries[C]['args']): Promise<Queries[C]['result']>;
  command<C extends CommandChannel>(
    channel: C,
    args: Commands[C]['args'],
  ): Promise<Commands[C]['result']>;
  onDelta(cb: (event: DeltaEvent) => void): () => void;
  /** Streamed tokens for assistant turns started via the `ai:chat` command. */
  onAiChunk(cb: (chunk: AiChunk) => void): () => void;
  /** macOS routes ⌘Z through the app menu; this is the renderer handler. */
  onTriageUndo(cb: () => void): () => void;
  /** True for the installed .app / .dmg build (not pnpm dev). */
  isPackaged: boolean;
}

/** Messages between main and the sync utility process. */
export type MainToSync =
  | { kind: 'init'; dbPath: string; attachmentsDir: string }
  | { kind: 'account-added'; accountId: string; password: string }
  | { kind: 'query'; id: number; channel: string; args: unknown } // query or command channel
  | { kind: 'enqueue-task'; id: number; task: Task }
  /** secret is the password, or a fresh access token for oauth accounts */
  | { kind: 'credentials'; accountId: string; password: string; authType?: 'password' | 'oauth' }
  /** System sleep/wake: sync pauses its timers while suspended. */
  | { kind: 'power'; state: 'suspend' | 'resume' };

export type SyncToMain =
  | { kind: 'ready' }
  | { kind: 'query-result'; id: number; result: unknown; error?: string }
  | { kind: 'task-enqueued'; id: number; taskId: number }
  | { kind: 'delta'; event: DeltaEvent }
  | { kind: 'need-credentials'; accountId: string };
