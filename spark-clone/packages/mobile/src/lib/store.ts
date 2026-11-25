import { create } from 'zustand';
import type { ThreadAction, UnioxApi } from '../data/api';
import { mockApi } from '../data/mock';
import { supabaseApi } from '../data/supabase';
import {
  type ComposeDraft,
  DEFAULT_SETTINGS,
  type MobileAccount,
  type MobileThread,
  type SharedSettings,
} from '../data/types';
import { cachedInbox, cacheInbox, enqueue, flushOutbox, isNetworkError, outbox } from './offline';
import { PendingActions, withThread, without } from './pending';

function pickApi(): UnioxApi {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const forceDemo = new URLSearchParams(location.search).has('demo');
  return url && key && !forceDemo ? supabaseApi(url, key) : mockApi;
}

interface Toast {
  text: string;
  undo?: () => void;
}

interface State {
  api: UnioxApi;
  ready: boolean;
  me: { email: string } | null;
  accounts: MobileAccount[];
  threads: MobileThread[];
  settings: SharedSettings;
  accountFilter: string | null;
  loading: boolean;
  online: boolean;
  queued: number;
  toast: Toast | null;
  error: string | null;

  boot(): Promise<void>;
  refresh(): Promise<void>;
  act(thread: MobileThread, action: ThreadAction, label?: string): Promise<void>;
  send(draft: ComposeDraft): Promise<'sent' | 'queued'>;
  saveSettings(patch: Partial<SharedSettings>): Promise<void>;
  setAccountFilter(id: string | null): void;
  showToast(t: Toast | null): void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
const pending = new PendingActions();

export const useStore = create<State>((set, get) => ({
  api: pickApi(),
  ready: false,
  me: null,
  accounts: [],
  threads: cachedInbox(),
  settings: DEFAULT_SETTINGS,
  accountFilter: null,
  loading: false,
  online: navigator.onLine,
  queued: outbox().length,
  toast: null,
  error: null,

  async boot() {
    const { api } = get();
    try {
      const me = await api.session();
      set({ me });
      if (me) {
        const [settings] = await Promise.all([api.settings(), get().refresh()]);
        set({ settings });
        api.onChange(() => void get().refresh());
        void flushOutbox(api.send).then(() => set({ queued: outbox().length }));
      }
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ ready: true });
    }
    window.addEventListener('online', () => {
      set({ online: true });
      void flushOutbox(get().api.send).then((n) => {
        set({ queued: outbox().length });
        if (n) get().showToast({ text: `Sent ${n} queued ${n === 1 ? 'reply' : 'replies'}` });
      });
      void get().refresh();
    });
    window.addEventListener('offline', () => set({ online: false }));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && get().me) void get().refresh();
    });
  },

  async refresh() {
    const { api } = get();
    set({ loading: true });
    const startedAt = Date.now();
    try {
      const [accounts, fetched] = await Promise.all([api.accounts(), api.threads({ limit: 300 })]);
      // Actions still on their way to the server stay applied on top.
      const threads = pending.applyTo(fetched);
      pending.prune(startedAt);
      set({ accounts, threads, error: null });
      cacheInbox(threads);
    } catch (e) {
      if (!isNetworkError(e)) set({ error: (e as Error).message });
    } finally {
      set({ loading: false });
    }
  },

  async act(thread, action, label) {
    const { api } = get();
    // Optimistic: archive/trash/snooze drop the row, read/pin update it.
    const patch =
      action.kind === 'archive' || action.kind === 'trash' || action.kind === 'snooze'
        ? without(thread.id)
        : action.kind === 'read'
          ? withThread({ ...thread, unreadCount: action.read ? 0 : Math.max(1, thread.unreadCount) })
          : action.kind === 'pin'
            ? withThread({ ...thread, pinned: action.pinned })
            : withThread(thread);
    const op = pending.begin(thread.id, patch);
    set({ threads: patch(get().threads) });
    try {
      await api.act(thread.id, action);
      pending.settle(op);
      void get().refresh();
      if (label) {
        get().showToast({
          text: label,
          undo:
            action.kind === 'archive' || action.kind === 'snooze'
              ? () => void get().act(thread, { kind: 'inbox' })
              : undefined,
        });
      }
    } catch (e) {
      // Put back only this thread; other actions made meanwhile stand.
      pending.drop(op);
      set({ threads: withThread(thread)(get().threads) });
      get().showToast({ text: (e as Error).message || 'Could not update' });
    }
  },

  async send(draft) {
    const { api } = get();
    if (!navigator.onLine) {
      enqueue(draft);
      set({ queued: outbox().length });
      return 'queued';
    }
    try {
      await api.send(draft);
      return 'sent';
    } catch (e) {
      if (isNetworkError(e)) {
        enqueue(draft);
        set({ queued: outbox().length });
        return 'queued';
      }
      throw e;
    }
  },

  async saveSettings(patch) {
    set({ settings: { ...get().settings, ...patch } });
    try {
      await get().api.saveSettings(patch);
    } catch (e) {
      get().showToast({ text: `Settings not saved: ${(e as Error).message}` });
    }
  },

  setAccountFilter(id) {
    set({ accountFilter: id });
  },

  showToast(t) {
    clearTimeout(toastTimer);
    set({ toast: t });
    if (t) toastTimer = setTimeout(() => set({ toast: null }), t.undo ? 5000 : 2600);
  },
}));

export const accountById = (accounts: MobileAccount[], id: string) =>
  accounts.find((a) => a.id === id);
