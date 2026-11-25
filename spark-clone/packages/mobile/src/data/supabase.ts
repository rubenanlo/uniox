import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { dedupeMirroredEvents } from '@app/shared';
import type { ThreadAction, UnioxApi } from './api';
import {
  DEFAULT_SETTINGS,
  type MobileAccount,
  type MobileEvent,
  type MobileMessage,
  type MobileThread,
  type RsvpAnswer,
  type SharedSettings,
} from './types';

/* Rows as stored in Supabase (see supabase/migrations). */
interface ThreadRow {
  id: string;
  account_id: string;
  subject: string;
  snippet: string;
  participants: MobileThread['participants'];
  last_from: MobileThread['lastFrom'];
  last_message_at: number;
  message_count: number;
  unread_count: number;
  has_attachments: boolean;
  pinned: boolean;
  priority: boolean;
  category: MobileThread['category'];
  in_inbox: boolean;
  snooze_until: number | null;
}
interface MessageRow {
  id: string;
  thread_id: string;
  account_id: string;
  from_addr: MobileMessage['from'];
  to_addrs: MobileMessage['to'];
  cc_addrs: MobileMessage['cc'];
  date: number;
  snippet: string;
  html: string | null;
  body_text: string | null;
  from_me: boolean;
  unread: boolean;
  attachments: MobileMessage['attachments'];
  invite: MobileMessage['invite'] | null;
}
interface EventRow {
  id: string;
  account_id: string;
  calendar_id: string;
  calendar_name: string;
  title: string;
  start_ms: number;
  end_ms: number;
  all_day: boolean;
  color: string;
  location: string | null;
  description: string | null;
  meeting_url: string | null;
  attendees: MobileEvent['attendees'];
  organizer: MobileEvent['organizer'];
  my_answer: string | null;
  free: boolean;
}

export const toThread = (r: ThreadRow): MobileThread => ({
  id: r.id,
  accountId: r.account_id,
  subject: r.subject,
  snippet: r.snippet,
  participants: r.participants ?? [],
  lastFrom: r.last_from,
  lastMessageAt: Number(r.last_message_at),
  messageCount: r.message_count,
  unreadCount: r.unread_count,
  hasAttachments: r.has_attachments,
  pinned: r.pinned,
  priority: r.priority,
  category: r.category,
  inInbox: r.in_inbox,
  snoozeUntil: r.snooze_until === null ? null : Number(r.snooze_until),
});

export const toMessage = (r: MessageRow): MobileMessage => ({
  id: r.id,
  threadId: r.thread_id,
  accountId: r.account_id,
  from: r.from_addr,
  to: r.to_addrs ?? [],
  cc: r.cc_addrs ?? [],
  date: Number(r.date),
  snippet: r.snippet,
  html: r.html,
  text: r.body_text,
  fromMe: r.from_me,
  unread: r.unread,
  attachments: r.attachments ?? [],
  ...(r.invite ? { invite: r.invite } : {}),
});

const answer = (a: string | null): RsvpAnswer | null =>
  a === 'accepted' || a === 'tentative' || a === 'declined' ? a : null;

export const toEvent = (r: EventRow): MobileEvent => ({
  id: r.id,
  accountId: r.account_id,
  calendarId: `${r.account_id}:${r.calendar_id}`,
  calendarName: r.calendar_name,
  title: r.title,
  startMs: Number(r.start_ms),
  endMs: Number(r.end_ms),
  allDay: r.all_day,
  color: r.color,
  ...(r.location ? { location: r.location } : {}),
  ...(r.description ? { description: r.description } : {}),
  ...(r.meeting_url ? { meetingUrl: r.meeting_url } : {}),
  attendees: r.attendees ?? [],
  organizer: r.organizer,
  myAnswer: answer(r.my_answer),
  free: r.free,
});

export function supabaseApi(url: string, anonKey: string): UnioxApi {
  const sb: SupabaseClient = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  const appUrl = () => `${location.origin}${location.pathname.replace(/\/$/, '')}`;

  async function fn<T>(name: string, body: unknown): Promise<T> {
    const { data, error } = await sb.functions.invoke(name, {
      body: body as Record<string, unknown>,
    });
    if (error) {
      // Surface the server's message instead of a generic "non-2xx".
      const ctx = (error as { context?: Response }).context;
      const detail = ctx ? await ctx.json().catch(() => null) : null;
      throw new Error(detail?.error ?? error.message);
    }
    return data as T;
  }

  async function uid(): Promise<string> {
    const { data } = await sb.auth.getUser();
    if (!data.user) throw new Error('Not signed in');
    return data.user.id;
  }

  return {
    kind: 'supabase',
    async session() {
      // Finish a Google sign-in: the server sent us back with a one-time token.
      const hash = location.hash;
      const m = hash.match(/token_hash=([^&]+)/);
      if (m) {
        const { error } = await sb.auth.verifyOtp({
          token_hash: decodeURIComponent(m[1]!),
          type: 'magiclink',
        });
        history.replaceState(null, '', `${location.pathname}#/home`);
        if (error) throw error;
      }
      const { data } = await sb.auth.getSession();
      return data.session?.user.email ? { email: data.session.user.email } : null;
    },
    async signIn() {
      const { url: to } = await fn<{ url: string }>('google-connect', {
        mode: 'signin',
        returnTo: appUrl(),
      });
      location.href = to;
    },
    async signOut() {
      await sb.auth.signOut();
    },
    async connectAccount() {
      const { url: to } = await fn<{ url: string }>('google-connect', {
        mode: 'link',
        returnTo: appUrl(),
      });
      location.href = to;
    },
    async accounts() {
      const { data, error } = await sb
        .from('accounts')
        .select('id, email, display_name, color, status, last_sync_at')
        .order('created_at');
      if (error) throw error;
      return (data ?? []).map((r): MobileAccount => ({
        id: r.id,
        email: r.email,
        displayName: r.display_name,
        color: r.color,
        status: r.status,
        lastSyncAt: r.last_sync_at ? Date.parse(r.last_sync_at) : null,
      }));
    },
    async syncNow() {
      await fn('sync', {});
    },
    async threads({ accountId, limit = 200 }) {
      let q = sb
        .from('threads')
        .select('*')
        .eq('in_inbox', true)
        .order('last_message_at', { ascending: false })
        .limit(limit);
      if (accountId) q = q.eq('account_id', accountId);
      const { data, error } = await q;
      if (error) throw error;
      return (data as ThreadRow[]).map(toThread);
    },
    async thread(id) {
      const [{ data: t, error: e1 }, { data: m, error: e2 }] = await Promise.all([
        sb.from('threads').select('*').eq('id', id).single(),
        sb.from('messages').select('*').eq('thread_id', id).order('date'),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      return { thread: toThread(t as ThreadRow), messages: (m as MessageRow[]).map(toMessage) };
    },
    async act(threadId: string, action: ThreadAction) {
      await fn('mail', { ...action, action: action.kind, threadId });
    },
    async send(draft) {
      await fn('mail', { action: 'send', ...draft });
    },
    async events(from, to) {
      const { data, error } = await sb
        .from('events')
        .select('*')
        .gt('end_ms', from)
        .lt('start_ms', to)
        .order('start_ms');
      if (error) throw error;
      // Hide "Busy" mirrors and the same invite shown by a second account.
      return dedupeMirroredEvents((data as EventRow[]).map(toEvent));
    },
    async freeBusy(accountId, emails, fromMs, toMs) {
      return (await fn('mail', { action: 'freebusy', accountId, emails, fromMs, toMs })) as {
        me: string;
        busy: Record<string, { startMs: number; endMs: number }[] | null>;
      };
    },
    async proposeTime(eventId, startMs, endMs, label) {
      await fn('mail', { action: 'propose', eventId, startMs, endMs, label });
    },
    async rsvp(eventId, _accountId, ans) {
      await fn('mail', { action: 'rsvp', eventId, answer: ans });
    },
    calendars: () => fn('mail', { action: 'calendars' }),
    async createEvent(input) {
      await fn('mail', { action: 'createEvent', ...input });
    },
    async search(query) {
      const q = query.trim();
      if (!q) return { answer: null, threads: [], events: [] };
      const like = `%${q.replace(/[%_,()*\\]/g, ' ').trim()}%`;
      const [threads, events, ai] = await Promise.all([
        sb
          .from('threads')
          .select('*')
          .or(
            `subject.ilike.${like},snippet.ilike.${like},last_from->>name.ilike.${like},last_from->>email.ilike.${like}`,
          )
          .order('last_message_at', { ascending: false })
          .limit(40),
        sb
          .from('events')
          .select('*')
          .ilike('title', like)
          .order('start_ms', { ascending: false })
          .limit(10),
        fn<{ answer: string | null }>('ai', { task: 'search', query: q }).catch(() => ({
          answer: null,
        })),
      ]);
      return {
        answer: ai.answer,
        threads: ((threads.data ?? []) as ThreadRow[]).map(toThread),
        events: dedupeMirroredEvents(((events.data ?? []) as EventRow[]).map(toEvent)),
      };
    },
    firstRead: (threadId) => fn('ai', { task: 'firstRead', threadId }),
    async rewrite(body, instruction) {
      return (await fn<{ text: string }>('ai', { task: 'rewrite', body, instruction })).text;
    },
    async assistant(history) {
      return (await fn<{ text: string }>('ai', { task: 'assistant', history })).text;
    },
    aiKey: () => fn('ai', { task: 'keyStatus' }),
    setAiKey: (key) => fn('ai', { task: 'setKey', key }),
    async clearAiKey() {
      await fn('ai', { task: 'clearKey' });
    },
    async settings() {
      const { data } = await sb.from('settings').select('data').maybeSingle();
      return { ...DEFAULT_SETTINGS, ...((data?.data ?? {}) as Partial<SharedSettings>) };
    },
    async saveSettings(patch) {
      const user_id = await uid();
      const { data } = await sb.from('settings').select('data').maybeSingle();
      const next = {
        ...((data?.data ?? {}) as object),
        ...patch,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      const { error } = await sb
        .from('settings')
        .upsert({ user_id, data: next, updated_at: new Date().toISOString() });
      if (error) throw error;
    },
    async registerPush(sub) {
      const user_id = await uid();
      const { error } = await sb
        .from('push_subscriptions')
        .upsert({ user_id, endpoint: sub.endpoint, keys: sub.keys }, { onConflict: 'endpoint' });
      if (error) throw error;
    },
    onChange(cb) {
      // Pull a fresh sync when the app opens, then listen for row changes.
      void fn('sync', {}).catch(() => undefined);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const debounced = () => {
        clearTimeout(timer);
        timer = setTimeout(cb, 400);
      };
      const ch = sb
        .channel('uniox-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'threads' }, debounced)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, debounced)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts' }, debounced)
        .subscribe();
      return () => {
        clearTimeout(timer);
        void sb.removeChannel(ch);
      };
    },
  };
}
