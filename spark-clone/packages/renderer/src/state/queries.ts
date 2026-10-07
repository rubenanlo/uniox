import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Account,
  DeltaEvent,
  Folder,
  GatekeeperPending,
  MessageBodyPayload,
  MessageMeta,
  ScheduledSend,
  SyncStatus,
  Template,
  ThreadQuery,
  ThreadSummary,
} from '@app/shared';
import { api } from '../lib/api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

type DeltaListener = (e: DeltaEvent) => void;
const listeners = new Set<DeltaListener>();
let wired = false;

function ensureWired() {
  if (wired) return;
  wired = true;
  api.onDelta((e) => {
    for (const l of [...listeners]) l(e);
  });
}

export function useDelta(listener: DeltaListener) {
  const ref = useRef(listener);
  useEffect(() => {
    ref.current = listener;
  });
  useEffect(() => {
    ensureWired();
    const stable: DeltaListener = (e) => ref.current(e);
    listeners.add(stable);
    return () => {
      listeners.delete(stable);
    };
  }, []);
}

export function useAccounts(): { accounts: Account[]; loaded: boolean; refresh: () => void } {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(() => {
    void api.query('accounts:list', undefined).then((a) => {
      setAccounts(a);
      setLoaded(true);
    });
  }, []);
  useEffect(refresh, [refresh]);
  useDelta((e) => {
    if (e.kind === 'accounts-changed') refresh();
  });
  return { accounts, loaded, refresh };
}

export function useFolders(): Folder[] {
  const [folders, setFolders] = useState<Folder[]>([]);
  const refresh = useCallback(() => {
    void api.query('folders:list', {}).then(setFolders);
  }, []);
  useEffect(refresh, [refresh]);
  useDelta((e) => {
    if (e.kind === 'accounts-changed' || e.kind === 'threads-changed') refresh();
  });
  return folders;
}

const PAGE = 200;
const SEARCH_DEBOUNCE_MS = 150;
const DELTA_COALESCE_MS = 100;

export function useThreads(opts: {
  view: ThreadQuery['view'];
  accountId?: string;
  search: string;
}): { threads: ThreadSummary[]; refresh: () => void } {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const gen = useRef(0);
  // Typing runs a full-text query per keystroke otherwise; clearing is instant.
  const search = useDebouncedValue(opts.search, opts.search.trim() ? SEARCH_DEBOUNCE_MS : 0);
  const refresh = useCallback(() => {
    const g = ++gen.current;
    const p = search.trim()
      ? // Search honours the sidebar's account focus, same as the list below.
        api.query('search:threads', {
          query: search,
          accountId: opts.accountId,
          limit: 100,
        })
      : api.query('threads:list', {
          view: opts.view,
          accountId: opts.accountId,
          limit: PAGE,
          offset: 0,
        });
    void p.then((t) => {
      if (gen.current === g) setThreads(t);
    });
  }, [opts.view, opts.accountId, search]);
  useEffect(refresh, [refresh]);
  // Sync emits threads-changed per task and per batch; coalesce a burst into
  // one 200-row refetch instead of one per event.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRefresh = useRef(refresh);
  useEffect(() => {
    latestRefresh.current = refresh;
  }, [refresh]);
  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    [],
  );
  useDelta((e) => {
    if (e.kind !== 'threads-changed' && e.kind !== 'accounts-changed') return;
    if (pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      latestRefresh.current();
    }, DELTA_COALESCE_MS);
  });
  return { threads, refresh };
}

/**
 * The selected thread, falling back to a direct fetch when the list isn't
 * showing it. A Gatekeeper card opens the sender's latest mail while that
 * sender is still screened out of the list, so the pane can't rely on it.
 */
export function useSelectedThread(
  threadId: string | null,
  fromList: ThreadSummary | null,
): ThreadSummary | null {
  const [fetched, setFetched] = useState<ThreadSummary | null>(null);
  const needsFetch = !!threadId && !fromList;
  const refresh = useCallback(() => {
    // No clearing here: a stale result is filtered by the id check below, and
    // setting state straight from the effect would cascade a render.
    if (!needsFetch || !threadId) return;
    void api.query('thread:get', { threadId }).then(setFetched);
  }, [needsFetch, threadId]);
  useEffect(refresh, [refresh]);
  useDelta((e) => {
    if (needsFetch && e.kind === 'threads-changed') refresh();
  });
  return fromList ?? (fetched?.id === threadId ? fetched : null);
}

export function useThreadMessages(threadId: string | null): MessageMeta[] {
  const [messages, setMessages] = useState<MessageMeta[]>([]);
  const refresh = useCallback(() => {
    const p: Promise<MessageMeta[]> = threadId
      ? api.query('thread:messages', { threadId })
      : Promise.resolve([]);
    void p.then(setMessages);
  }, [threadId]);
  useEffect(refresh, [refresh]);
  useDelta((e) => {
    if (e.kind === 'threads-changed') refresh();
    // A background hydration pass fills bodies across the whole mailbox; only
    // re-query when it touched the thread actually on screen.
    else if (e.kind === 'message-body' && threadId && e.threadIds.includes(threadId)) refresh();
  });
  return messages;
}

export function useMessageBody(messageId: string): MessageBodyPayload | null {
  const [body, setBody] = useState<MessageBodyPayload | null>(null);
  const refresh = useCallback(() => {
    void api.query('message:body', { messageId }).then(setBody);
  }, [messageId]);
  useEffect(refresh, [refresh]);
  useDelta((e) => {
    if (e.kind === 'message-body' && e.messageIds.includes(messageId)) refresh();
  });
  return body;
}

export function useOutbox(): { sends: ScheduledSend[]; refresh: () => void } {
  const [sends, setSends] = useState<ScheduledSend[]>([]);
  const refresh = useCallback(() => {
    void api.query('outbox:list', undefined).then(setSends);
  }, []);
  useEffect(refresh, [refresh]);
  useDelta((e) => {
    if (e.kind === 'threads-changed' || e.kind === 'accounts-changed') refresh();
  });
  return { sends, refresh };
}

export function useGatekeeperPending(): GatekeeperPending[] {
  const [pending, setPending] = useState<GatekeeperPending[]>([]);
  const refresh = useCallback(() => {
    void api.query('gatekeeper:pending', undefined).then(setPending);
  }, []);
  useEffect(refresh, [refresh]);
  useDelta((e) => {
    if (e.kind === 'threads-changed') refresh();
  });
  return pending;
}

export function useTemplates(): { templates: Template[]; refresh: () => void } {
  const [templates, setTemplates] = useState<Template[]>([]);
  const refresh = useCallback(() => {
    void api.query('templates:list', undefined).then(setTemplates);
  }, []);
  useEffect(refresh, [refresh]);
  return { templates, refresh };
}

export function useSyncStatuses(): Map<string, SyncStatus> {
  const [statuses, setStatuses] = useState<Map<string, SyncStatus>>(new Map());
  useDelta((e) => {
    if (e.kind === 'sync-status') {
      setStatuses((prev) => {
        const next = new Map(prev);
        next.set(e.status.accountId, e.status);
        return next;
      });
    }
  });
  return statuses;
}
