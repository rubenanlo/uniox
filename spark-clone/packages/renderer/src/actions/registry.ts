import { toast } from 'sonner';
import type { ThreadSummary } from '@app/shared';
import { api } from '../lib/api';
import { shareAvailability } from '../state/availability';
import { markThreadsRead, moveThreads } from '../lib/bulk';
import { advancePastMultiSelection, extendSelection, multiSelectedThreads } from '../lib/multiSelect';
import { focusGatekeeper, openSelectedThread, toggleSidebarReveal } from '../lib/panels';
import { toastWithUndo, handleTriageUndo } from '../lib/undo';
import { bundleByRowId, keyboardTargetId, navRowId, PRIORITY_TOGGLE_ID, useUi } from '../state/store';

export interface KeyCombo {
  key: string; // KeyboardEvent.key, lowercase
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export type ActionContext = 'thread' | 'global';

export interface AppAction {
  id: string;
  label: string;
  combo: KeyCombo | null;
  /** Secondary binding dispatched like `combo` (e.g. plain C for compose). */
  altCombo?: KeyCombo;
  context: ActionContext;
  section: string;
  /** Disabled actions still appear in the Command Center with a hint. */
  disabledReason?: string;
  perform(targetThreadId: string | null): void;
}

function target(): ThreadSummary | null {
  const id = keyboardTargetId();
  if (!id) return null;
  return useUi.getState().visibleThreads.find((t) => t.id === id) ?? null;
}

function threadById(id: string | null): ThreadSummary | null {
  if (!id) return null;
  return useUi.getState().visibleThreads.find((t) => t.id === id) ?? null;
}

/** Move selection to the neighbouring row when the current one is leaving the list. */
function advanceSelectionFrom(rowId: string) {
  const ui = useUi.getState();
  if (ui.selectedThreadId !== rowId) return;
  const idx = ui.visibleRows.findIndex((r) => navRowId(r) === rowId);
  const next = ui.visibleRows[idx + 1] ?? ui.visibleRows[idx - 1];
  ui.selectThread(next ? navRowId(next) : null, true);
}

/** When the target is a bundle row, triage the whole group at once. */
function bundleMoveWithUndo(id: string | null, toRole: 'archive' | 'trash', label: string): boolean {
  const bundle = bundleByRowId(id);
  if (!bundle) return false;
  advanceSelectionFrom(id!);
  moveThreads(bundle.threads, toRole);
  toastWithUndo(`${label} · ${bundle.threads.length} conversations`, () =>
    moveThreads(bundle.threads, 'inbox'),
  );
  return true;
}

/** When several rows are picked (⇧↑/↓), move them all at once with one undo. */
function multiMoveWithUndo(toRole: 'archive' | 'trash', label: string): boolean {
  const threads = multiSelectedThreads();
  if (!threads) return false;
  if (toRole === 'trash' && useUi.getState().view === 'drafts') {
    advancePastMultiSelection();
    void Promise.all(threads.map(deleteThreadDrafts)).then((counts) => {
      const n = counts.reduce((a, b) => a + b, 0);
      toast(n === 1 ? 'Draft deleted' : `${n} drafts deleted`);
    });
    return true;
  }
  advancePastMultiSelection();
  moveThreads(threads, toRole);
  toastWithUndo(`${label} · ${threads.length} conversations`, () => moveThreads(threads, 'inbox'));
  return true;
}

/** Delete in the Drafts view targets the draft itself, not the conversation. */
async function deleteThreadDrafts(thread: ThreadSummary): Promise<number> {
  const messages = await api.query('thread:messages', { threadId: thread.id });
  const drafts = messages.filter((m) => m.draft);
  for (const m of drafts) {
    void api.command('task:enqueue', { type: 'delete-draft', accountId: m.accountId, messageId: m.id });
  }
  return drafts.length;
}

function moveWithUndo(thread: ThreadSummary, toRole: 'archive' | 'trash', label: string) {
  advanceSelectionFrom(thread.id);
  void api.command('task:enqueue', { type: 'move-thread', accountId: thread.accountId, threadId: thread.id, toRole });
  toastWithUndo(label, () =>
    void api.command('task:enqueue', {
      type: 'move-thread',
      accountId: thread.accountId,
      threadId: thread.id,
      toRole: 'inbox',
    }),
  );
}

async function setThreadSeen(thread: ThreadSummary, seen: boolean) {
  const messages = await api.query('thread:messages', { threadId: thread.id });
  const ids = messages.filter((m) => m.seen !== seen).map((m) => m.id);
  if (ids.length) {
    void api.command('task:enqueue', {
      type: 'set-seen',
      accountId: thread.accountId,
      messageIds: ids,
      seen,
    });
  }
}

export function markThreadRead(thread: ThreadSummary) {
  if (thread.unreadCount > 0) void setThreadSeen(thread, true);
}

function replyAction(mode: 'reply' | 'reply-all' | 'forward') {
  return (targetThreadId: string | null) => {
    const thread = threadById(targetThreadId) ?? target();
    if (!thread) return;
    void api.query('thread:messages', { threadId: thread.id }).then((messages) => {
      const last = messages[messages.length - 1];
      if (!last) return;
      useUi.getState().openComposer({
        mode,
        accountId: thread.accountId,
        replyTo: last,
        subject: last.subject,
      });
    });
  };
}

/** ⌘R: pull new mail and calendar events now instead of waiting for the next poll. */
export function refreshNow() {
  void api.command('sync:now', undefined).then((r) => {
    toast(r?.ok === false ? 'Can’t refresh while the computer is asleep' : 'Refreshing mail and calendar…');
  });
}

export function moveSelection(delta: 1 | -1) {
  const ui = useUi.getState();
  const rows = ui.visibleRows;
  if (!rows.length) return;
  const currentId = ui.selectedThreadId ?? ui.hoveredThreadId;
  const idx = rows.findIndex((r) => navRowId(r) === currentId);
  // ↑ past the first row climbs into the new-sender cards above the list.
  if (delta === -1 && idx === 0 && focusGatekeeper()) return;
  const next = rows[idx === -1 ? (delta === 1 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, idx + delta))];
  if (next) {
    // Arrow browsing is an auto selection: preview without marking read.
    ui.selectThread(navRowId(next), true);
    ui.hoverThread(null);
  }
}

async function gatekeeperDecide(decision: 'accepted' | 'blocked') {
  const pending = await api.query('gatekeeper:pending', undefined);
  // The first VISIBLE card: the strip honors the sidebar's account filter,
  // and the shortcut must act on the same sender the user is looking at.
  const accountFilter = useUi.getState().accountFilter;
  const first = (accountFilter ? pending.filter((p) => p.accountId === accountFilter) : pending)[0];
  if (!first) return;
  void api.command('task:enqueue', {
    type: 'gatekeeper-decide',
    accountId: first.accountId,
    key: first.key,
    kind: first.kind,
    decision,
  });
  toast(decision === 'accepted' ? `Accepted ${first.key}` : `Blocked ${first.key}`);
}

/**
 * The single action registry (report §6.1). Keyboard dispatch, the Command
 * Center, hover bars, and the shortcuts sheet all derive from this table.
 * Default bindings are Spark Desktop's documented map.
 */
export const ACTIONS: AppAction[] = [
  // --- triage (Spark's four exit states + pin)
  {
    id: 'done',
    label: 'Done',
    combo: { key: 'e' },
    context: 'thread',
    section: 'Triage',
    perform: (id) => {
      if (multiMoveWithUndo('archive', 'Done')) return;
      if (bundleMoveWithUndo(id, 'archive', 'Done')) return;
      const t = threadById(id) ?? target();
      if (t) moveWithUndo(t, 'archive', 'Done');
    },
  },
  {
    id: 'delete',
    label: 'Delete',
    combo: { key: 'backspace' },
    context: 'thread',
    section: 'Triage',
    perform: (id) => {
      if (multiMoveWithUndo('trash', 'Deleted')) return;
      if (bundleMoveWithUndo(id, 'trash', 'Deleted')) return;
      const t = threadById(id) ?? target();
      if (!t) return;
      if (useUi.getState().view === 'drafts') {
        advanceSelectionFrom(t.id);
        void deleteThreadDrafts(t).then((n) => toast(n > 1 ? `${n} drafts deleted` : 'Draft deleted'));
        return;
      }
      moveWithUndo(t, 'trash', 'Deleted');
    },
  },
  {
    id: 'pin',
    label: 'Pin / Unpin',
    combo: { key: 'd' },
    context: 'thread',
    section: 'Triage',
    perform: (id) => {
      const many = multiSelectedThreads();
      const t = threadById(id) ?? target();
      const threads = many ?? (t ? [t] : []);
      // Pin them all unless every one is already pinned.
      const pinned = !threads.every((x) => x.pinned);
      for (const x of threads) {
        void api.command('task:enqueue', {
          type: 'set-pinned',
          accountId: x.accountId,
          threadId: x.id,
          pinned,
        });
      }
    },
  },
  {
    id: 'snooze',
    label: 'Snooze',
    combo: { key: 's' },
    context: 'thread',
    section: 'Triage',
    perform: (id) => {
      const t = threadById(id) ?? target();
      if (t) useUi.getState().openPicker({ kind: 'snooze', thread: t });
    },
  },
  {
    id: 'set-aside',
    label: 'Set Aside / Move back',
    combo: { key: 'g' },
    context: 'thread',
    section: 'Triage',
    perform: (id) => {
      const many = multiSelectedThreads();
      const t = threadById(id) ?? target();
      const threads = many ?? (t ? [t] : []);
      if (!threads.length) return;
      const aside = useUi.getState().view !== 'set_aside';
      if (many) advancePastMultiSelection();
      for (const x of threads) {
        void api.command('task:enqueue', {
          type: 'set-aside-thread',
          accountId: x.accountId,
          threadId: x.id,
          aside,
        });
      }
      const n = threads.length > 1 ? ` · ${threads.length} conversations` : '';
      toast((aside ? 'Set aside' : 'Moved back to Inbox') + n);
    },
  },
  {
    id: 'remind',
    label: 'Remind me…',
    combo: { key: 'h' },
    context: 'thread',
    section: 'Triage',
    perform: (id) => {
      const t = threadById(id) ?? target();
      if (t) useUi.getState().openPicker({ kind: 'remind', thread: t });
    },
  },
  {
    id: 'toggle-read',
    label: 'Mark read / unread',
    combo: { key: 'u' },
    altCombo: { key: 'u', meta: true },
    context: 'thread',
    section: 'Triage',
    perform: (id) => {
      const many = multiSelectedThreads();
      if (many) {
        // Any unread → mark all read; all read already → mark all unread.
        if (many.some((t) => t.unreadCount > 0)) void markThreadsRead(many);
        else for (const t of many) void setThreadSeen(t, false);
        return;
      }
      const bundle = bundleByRowId(id);
      if (bundle) {
        void markThreadsRead(bundle.threads);
        return;
      }
      const t = threadById(id) ?? target();
      if (t) void setThreadSeen(t, t.unreadCount > 0);
    },
  },
  {
    id: 'undo',
    label: 'Undo last triage',
    combo: { key: 'z', meta: true },
    context: 'global',
    section: 'Triage',
    perform: () => {
      handleTriageUndo();
    },
  },
  {
    id: 'open-row',
    label: 'Open email / group',
    combo: { key: 'enter' },
    context: 'thread',
    section: 'Navigate',
    perform: (id) => {
      if (id === PRIORITY_TOGGLE_ID) {
        const ui = useUi.getState();
        ui.setPriorityExpanded(!ui.priorityExpanded);
        return;
      }
      const bundle = bundleByRowId(id);
      if (bundle) {
        useUi.getState().setCategoryFocus(bundle.category);
        return;
      }
      const t = threadById(id) ?? target();
      if (t) openSelectedThread(t.id);
    },
  },
  // --- respond (Spark: Reply All R, Reply ⇧R, Forward F)
  {
    id: 'reply-all',
    label: 'Reply All',
    combo: { key: 'r' },
    context: 'thread',
    section: 'Respond',
    perform: replyAction('reply-all'),
  },
  {
    id: 'reply',
    label: 'Reply',
    combo: { key: 'r', shift: true },
    context: 'thread',
    section: 'Respond',
    perform: replyAction('reply'),
  },
  {
    id: 'forward',
    label: 'Forward',
    combo: { key: 'f' },
    context: 'thread',
    section: 'Respond',
    perform: replyAction('forward'),
  },
  {
    id: 'share-availability',
    label: 'Share availability',
    combo: { key: 'a', meta: true, shift: true },
    context: 'global',
    section: 'Respond',
    perform: () => void shareAvailability(),
  },
  {
    id: 'compose',
    label: 'New email',
    combo: { key: 'n', meta: true },
    altCombo: { key: 'c' },
    context: 'global',
    section: 'Respond',
    perform: () => {
      const ui = useUi.getState();
      const accountId = ui.accountFilter;
      void api.query('accounts:list', undefined).then((accounts) => {
        const acc = accounts.find((a) => a.id === accountId) ?? accounts[0];
        if (acc) ui.openComposer({ mode: 'new', accountId: acc.id });
      });
    },
  },
  // --- gatekeeper (acts on the first pending sender)
  {
    id: 'gatekeeper-accept',
    label: 'Gatekeeper: accept sender',
    combo: { key: 't', meta: true },
    context: 'global',
    section: 'Triage',
    perform: () => void gatekeeperDecide('accepted'),
  },
  {
    id: 'gatekeeper-block',
    label: 'Gatekeeper: block sender',
    combo: { key: 'b', meta: true },
    context: 'global',
    section: 'Triage',
    perform: () => void gatekeeperDecide('blocked'),
  },
  // --- navigate
  {
    id: 'priority-expand',
    label: 'Expand priority section',
    combo: { key: 'arrowdown', alt: true },
    context: 'global',
    section: 'Navigate',
    perform: () => {
      const ui = useUi.getState();
      if (ui.view === 'inbox') ui.setPriorityExpanded(true);
    },
  },
  {
    id: 'priority-collapse',
    label: 'Collapse priority section',
    combo: { key: 'arrowup', alt: true },
    context: 'global',
    section: 'Navigate',
    perform: () => {
      const ui = useUi.getState();
      if (ui.view === 'inbox') ui.setPriorityExpanded(false);
    },
  },
  {
    id: 'next-thread',
    label: 'Next email',
    combo: { key: 'arrowdown' },
    context: 'global',
    section: 'Navigate',
    perform: () => moveSelection(1),
  },
  {
    id: 'prev-thread',
    label: 'Previous email',
    combo: { key: 'arrowup' },
    context: 'global',
    section: 'Navigate',
    perform: () => moveSelection(-1),
  },
  {
    id: 'go-to',
    label: 'Go to…',
    combo: { key: 'l', meta: true },
    context: 'global',
    section: 'Navigate',
    perform: () => useUi.getState().setCommandOpen(true, 'goto'),
  },
  {
    id: 'select-down',
    label: 'Add next email to selection',
    combo: { key: 'arrowdown', shift: true },
    context: 'global',
    section: 'Navigate',
    perform: () => extendSelection(1),
  },
  {
    id: 'select-up',
    label: 'Add previous email to selection',
    combo: { key: 'arrowup', shift: true },
    context: 'global',
    section: 'Navigate',
    perform: () => extendSelection(-1),
  },
  {
    id: 'view-inbox',
    label: 'Go to Inbox',
    combo: { key: 'i', meta: true, shift: true },
    context: 'global',
    section: 'Navigate',
    perform: () => useUi.getState().setView('inbox'),
  },
  {
    id: 'view-pinned',
    label: 'Show Pinned',
    combo: { key: 'd', meta: true },
    context: 'global',
    section: 'Navigate',
    perform: () => useUi.getState().setView('pinned'),
  },
  {
    id: 'view-snoozed',
    label: 'Show Snoozed',
    combo: { key: 's', meta: true },
    context: 'global',
    section: 'Navigate',
    perform: () => useUi.getState().setView('snoozed'),
  },
  {
    id: 'view-set-aside',
    label: 'Show Set Aside',
    combo: { key: 'g', meta: true },
    context: 'global',
    section: 'Navigate',
    perform: () => useUi.getState().setView('set_aside'),
  },
  {
    id: 'view-outbox',
    label: 'Show Outbox',
    combo: null,
    context: 'global',
    section: 'Navigate',
    perform: () => useUi.getState().setView('outbox'),
  },
  {
    id: 'view-done',
    label: 'Show Done',
    combo: { key: 'e', meta: true },
    context: 'global',
    section: 'Navigate',
    perform: () => useUi.getState().setView('archive'),
  },
  {
    id: 'search',
    label: 'Search',
    combo: { key: 'f', meta: true },
    context: 'global',
    section: 'Navigate',
    perform: () => useUi.getState().focusSearch(),
  },
  // --- account switcher (mirrors the sidebar: ⌘1 is All, accounts follow in order)
  {
    id: 'account-all',
    label: 'All accounts',
    combo: { key: '1', meta: true },
    context: 'global',
    section: 'Navigate',
    perform: () => useUi.getState().setAccountFilter(undefined),
  },
  ...(['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'] as const).map(
    (ord, i): AppAction => ({
      id: `account-${i + 1}`,
      label: `Switch to ${ord} account`,
      combo: { key: String(i + 2), meta: true },
      context: 'global',
      section: 'Navigate',
      perform: () => {
        void api.query('accounts:list', undefined).then((accounts) => {
          const a = accounts[i];
          if (a) useUi.getState().setAccountFilter(a.id);
        });
      },
    }),
  ),
  // --- layout (Spark: ⌘⌥1/2/3, sidebar /)
  {
    id: 'layout-focused',
    label: 'Focused List layout',
    combo: { key: '1', meta: true, alt: true },
    context: 'global',
    section: 'Layout',
    perform: () => useUi.getState().setListLayout('focused'),
  },
  {
    id: 'layout-cards',
    label: 'Unread Cards layout',
    combo: { key: '2', meta: true, alt: true },
    context: 'global',
    section: 'Layout',
    perform: () => useUi.getState().setListLayout('cards'),
  },
  {
    id: 'layout-simple',
    label: 'Simple List layout',
    combo: { key: '3', meta: true, alt: true },
    context: 'global',
    section: 'Layout',
    perform: () => useUi.getState().setListLayout('simple'),
  },
  {
    id: 'toggle-sidebar',
    label: 'Show / hide sidebar',
    combo: { key: '/' },
    context: 'global',
    section: 'Layout',
    perform: () => toggleSidebarReveal(),
  },
  {
    id: 'toggle-split',
    label: 'Toggle Split View',
    combo: { key: '\\', meta: true },
    context: 'global',
    section: 'Layout',
    perform: () => useUi.getState().toggleSplit(),
  },
  {
    id: 'toggle-smart-inbox',
    label: 'Smart Inbox / Classic',
    combo: null,
    context: 'global',
    section: 'Layout',
    perform: () => useUi.getState().toggleSmartInbox(),
  },
  {
    id: 'command-center',
    label: 'Command Center',
    combo: { key: 'k', meta: true },
    context: 'global',
    section: 'Layout',
    perform: () => useUi.getState().setCommandOpen(true),
  },
  {
    id: 'refresh',
    label: 'Refresh mail & calendar',
    combo: { key: 'r', meta: true },
    context: 'global',
    section: 'Navigate',
    perform: () => refreshNow(),
  },
  {
    id: 'open-settings',
    label: 'Settings',
    combo: { key: ',', meta: true },
    context: 'global',
    section: 'Layout',
    perform: () => useUi.getState().setSettingsOpen(true),
  },
  {
    id: 'shortcuts',
    label: 'Keyboard shortcuts',
    combo: { key: '/', meta: true },
    context: 'global',
    section: 'Layout',
    perform: () => useUi.getState().setShortcutsOpen(true),
  },
];

export function comboLabel(combo: KeyCombo | null): string[] {
  if (!combo) return [];
  const keys: string[] = [];
  if (combo.meta) keys.push('⌘');
  if (combo.alt) keys.push('⌥');
  if (combo.shift) keys.push('⇧');
  const k = combo.key;
  keys.push(
    k === 'backspace' ? '⌫' : k === 'arrowdown' ? '↓' : k === 'arrowup' ? '↑' : k === 'enter' ? '↩' : k.toUpperCase(),
  );
  return keys;
}

/** Keycap strings for an action's binding, for tooltips — [] if unbound. */
export function keysFor(actionId: string): string[] {
  const action = ACTIONS.find((a) => a.id === actionId);
  return action ? comboLabel(action.combo) : [];
}

/** The physical key ('Digit1' → '1', 'KeyU' → 'u'), for ⌥ combos where macOS
 *  reports the Option-modified character in e.key (⌥1 → '¡'). */
function physicalKey(e: KeyboardEvent): string {
  const code = e.code ?? '';
  if (code.startsWith('Digit')) return code.slice(5).toLowerCase();
  if (code.startsWith('Key')) return code.slice(3).toLowerCase();
  return '';
}

/** ⌘-keys a text field needs for itself: selection, clipboard, undo, B/I/U formatting. */
const FIELD_META_KEYS = ['a', 'c', 'v', 'x', 'z', 'b', 'i', 'u'];

/**
 * True when the focused field (or the composer) should keep this key instead
 * of the action running. Checks the binding that actually matched: an action
 * whose main combo is plain (U) can still match via a ⌘ altCombo (⌘U).
 */
export function fieldOwnsKey(
  e: KeyboardEvent,
  action: AppAction,
  ctx: { editable: boolean; inComposer: boolean },
): boolean {
  if (action.id === 'undo') return false;
  // While writing, keys belong to the draft: nothing may act on the email
  // behind it (⌘U must not mark the thread you're replying to read/unread).
  if (ctx.inComposer && action.context === 'thread') return true;
  if (!ctx.editable) return false;
  const matched = matchCombo(e, action.combo) ? action.combo : action.altCombo;
  return !!matched?.meta && !matched.shift && FIELD_META_KEYS.includes(matched.key);
}

export function matchCombo(e: KeyboardEvent, combo: KeyCombo | null): boolean {
  if (!combo) return false;
  const keyMatches =
    e.key.toLowerCase() === combo.key || (!!combo.alt && physicalKey(e) === combo.key);
  return (
    keyMatches &&
    (e.metaKey || e.ctrlKey) === !!combo.meta &&
    e.shiftKey === !!combo.shift &&
    e.altKey === !!combo.alt
  );
}
