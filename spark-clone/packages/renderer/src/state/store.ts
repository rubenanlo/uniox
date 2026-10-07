import { create } from 'zustand';
import type { Category, MailView, MessageMeta, ThreadSummary } from '@app/shared';

export type ListLayout = 'focused' | 'cards' | 'simple';
/** Row spacing: compressed = flush rows with hairline dividers; expanded = spaced cards. */
export type ListDensity = 'compressed' | 'expanded';
export type ThemePref = 'system' | 'light' | 'dark';

/**
 * A selectable row in the mail list. Bundle rows (Smart Inbox groups) are
 * keyboard targets too, so triage shortcuts can act on the whole group.
 */
export type NavRow =
  | { kind: 'thread'; thread: ThreadSummary }
  | { kind: 'bundle'; category: Category; threads: ThreadSummary[] }
  /** The Priority group's "Show all / Show less" row — Enter toggles it. */
  | { kind: 'priority-toggle' };

export const PRIORITY_TOGGLE_ID = 'priority:toggle';

/** Selection id for a bundle row (threads use their own ids). */
export function bundleRowId(category: Category): string {
  return `bundle:${category}`;
}

export function navRowId(row: NavRow): string {
  if (row.kind === 'priority-toggle') return PRIORITY_TOGGLE_ID;
  return row.kind === 'thread' ? row.thread.id : bundleRowId(row.category);
}

export interface ComposerState {
  mode: 'new' | 'reply' | 'reply-all' | 'forward' | 'edit-draft';
  accountId: string;
  replyTo?: MessageMeta;
  /** The stored draft being edited; sending it replaces the draft. */
  draftMessage?: MessageMeta;
  quotedHtml?: string;
  subject?: string;
  to?: { name?: string; email: string }[];
  /** New messages only (e.g. from a mailto: link). */
  cc?: { name?: string; email: string }[];
  bcc?: { name?: string; email: string }[];
  /** Plain-text body drafted by the assistant, seeded into the editor on open. */
  initialBody?: string;
}

interface UiState {
  view: MailView;
  accountFilter: string | undefined;
  listLayout: ListLayout;
  density: ListDensity;
  split: boolean;
  sidebarExpanded: boolean;
  theme: ThemePref;
  selectedThreadId: string | null;
  hoveredThreadId: string | null;
  searchQuery: string;
  searchFocusTick: number;
  composer: ComposerState | null;
  /** Composer dialog grown to full height / 1100px (the orb repositions on it). */
  composerExpanded: boolean;
  commandOpen: boolean;
  shortcutsOpen: boolean;
  settingsOpen: boolean;
  /** Shows the add-account onboarding overlay (from the sidebar or settings). */
  addingAccount: boolean;
  /** First-run intro splash: null until the saved flag loads, then seen/not. */
  introSeen: boolean | null;
  /** Smart Inbox card grouping vs Classic chronological (report §2.3). */
  smartInbox: boolean;
  /** Senders whose threads group at the top of the inbox (Settings → Priority). */
  priorityEmails: string[];
  /** Custom account pictures as small data-URLs, keyed by account id (Settings → Accounts). */
  accountAvatars: Record<string, string>;
  /** Custom identity color per account, keyed by account id (Settings → Accounts). Unset = the account's default hue. */
  accountColors: Record<string, string>;
  /** App-wide accent override (Settings → Appearance). null = follow the theme's built-in accent. */
  accentColor: string | null;
  /** When the app was last open, captured at launch. Home shows priority mail newer than this. */
  homeBaseline: number;
  /** Home shows the Notion Sprint-board kanban instead of the daylight view. */
  kanbanOpen: boolean;
  /** A bundle row was opened: show only this category as a dedicated list. */
  categoryFocus: Category | null;
  /** open schedule picker for a thread action */
  picker: { kind: 'snooze' | 'remind'; thread: ThreadSummary } | null;
  /**
   * How the current selection happened. Auto selections (arrow-key browsing,
   * post-triage advance) preview in the reading pane without marking read;
   * deliberate ones (click, Enter, notification) read the thread as usual.
   */
  selectionAuto: boolean;
  /** Display name for the Home greeting; null until the user tells us. */
  userName: string | null;
  /** Inbox's Priority section: collapsed shows new-since-last-open, expanded shows all. */
  priorityExpanded: boolean;
  /** the list currently rendered, so keyboard nav can move selection */
  visibleThreads: ThreadSummary[];
  /** rendered rows in order, including bundle rows, for arrow navigation */
  visibleRows: NavRow[];

  setView(view: MailView): void;
  setAccountFilter(id: string | undefined): void;
  setListLayout(layout: ListLayout): void;
  setDensity(density: ListDensity): void;
  toggleSplit(): void;
  toggleSidebar(): void;
  setTheme(theme: ThemePref): void;
  selectThread(id: string | null, auto?: boolean): void;
  setPriorityExpanded(expanded: boolean): void;
  setUserName(name: string | null): void;
  hoverThread(id: string | null): void;
  setSearchQuery(q: string): void;
  focusSearch(): void;
  openComposer(state: ComposerState): void;
  closeComposer(): void;
  setComposerExpanded(expanded: boolean): void;
  setCommandOpen(open: boolean): void;
  setShortcutsOpen(open: boolean): void;
  setSettingsOpen(open: boolean): void;
  setAddingAccount(adding: boolean): void;
  setIntroSeen(seen: boolean): void;
  toggleSmartInbox(): void;
  setPriorityEmails(emails: string[]): void;
  setAccountAvatar(accountId: string, dataUrl: string | null): void;
  setAccountColor(accountId: string, color: string | null): void;
  setAccentColor(color: string | null): void;
  setHomeBaseline(ts: number): void;
  setKanbanOpen(open: boolean): void;
  setCategoryFocus(category: Category | null): void;
  openPicker(picker: { kind: 'snooze' | 'remind'; thread: ThreadSummary }): void;
  closePicker(): void;
  setVisibleRows(rows: NavRow[]): void;
}

export const useUi = create<UiState>((set) => ({
  view: 'home',
  accountFilter: undefined,
  listLayout: 'focused',
  density: 'compressed',
  split: true,
  sidebarExpanded: false,
  theme: 'system',
  selectedThreadId: null,
  hoveredThreadId: null,
  searchQuery: '',
  searchFocusTick: 0,
  composer: null,
  composerExpanded: false,
  commandOpen: false,
  shortcutsOpen: false,
  settingsOpen: false,
  addingAccount: false,
  introSeen: null,
  smartInbox: true,
  priorityEmails: [],
  accountAvatars: {},
  accountColors: {},
  accentColor: null,
  homeBaseline: Date.now(),
  kanbanOpen: false,
  categoryFocus: null,
  picker: null,
  selectionAuto: false,
  userName: null,
  priorityExpanded: false,
  visibleThreads: [],
  visibleRows: [],

  setView: (view) =>
    // Changing screens also drops the Kanban overlay: it's a Home sub-view that
    // otherwise leaks, so returning to Home (icon / Esc / idle) would re-open the
    // board instead of the daylight briefing.
    set({
      view,
      selectedThreadId: null,
      hoveredThreadId: null,
      categoryFocus: null,
      kanbanOpen: false,
    }),
  setAccountFilter: (accountFilter) => set({ accountFilter }),
  setListLayout: (listLayout) => set({ listLayout }),
  setDensity: (density) => set({ density }),
  toggleSplit: () => set((s) => ({ split: !s.split })),
  toggleSidebar: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
  setTheme: (theme) => set({ theme }),
  selectThread: (selectedThreadId, auto = false) => set({ selectedThreadId, selectionAuto: auto }),
  setPriorityExpanded: (priorityExpanded) => set({ priorityExpanded }),
  setUserName: (userName) => set({ userName }),
  hoverThread: (hoveredThreadId) => set({ hoveredThreadId }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  focusSearch: () => set((s) => ({ searchFocusTick: s.searchFocusTick + 1 })),
  openComposer: (composer) => set({ composer, composerExpanded: false }),
  closeComposer: () => set({ composer: null, composerExpanded: false }),
  setComposerExpanded: (composerExpanded) => set({ composerExpanded }),
  setCommandOpen: (commandOpen) => set({ commandOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setAddingAccount: (addingAccount) => set({ addingAccount }),
  setIntroSeen: (introSeen) => set({ introSeen }),
  toggleSmartInbox: () => set((s) => ({ smartInbox: !s.smartInbox, categoryFocus: null })),
  setPriorityEmails: (priorityEmails) => set({ priorityEmails }),
  setAccountAvatar: (accountId, dataUrl) =>
    set((s) => {
      const accountAvatars = { ...s.accountAvatars };
      if (dataUrl) accountAvatars[accountId] = dataUrl;
      else delete accountAvatars[accountId];
      return { accountAvatars };
    }),
  setAccountColor: (accountId, color) =>
    set((s) => {
      const accountColors = { ...s.accountColors };
      if (color) accountColors[accountId] = color;
      else delete accountColors[accountId];
      return { accountColors };
    }),
  setAccentColor: (accentColor) => set({ accentColor }),
  setHomeBaseline: (homeBaseline) => set({ homeBaseline }),
  setKanbanOpen: (kanbanOpen) => set({ kanbanOpen }),
  setCategoryFocus: (categoryFocus) =>
    set((s) => ({
      categoryFocus,
      hoveredThreadId: null,
      // a selected bundle row does not exist inside (or after leaving) the dedicated list
      selectedThreadId: s.selectedThreadId?.startsWith('bundle:') ? null : s.selectedThreadId,
    })),
  openPicker: (picker) => set({ picker }),
  closePicker: () => set({ picker: null }),
  setVisibleRows: (visibleRows) =>
    set({
      visibleRows,
      visibleThreads: visibleRows.flatMap((r) => (r.kind === 'thread' ? [r.thread] : [])),
    }),
}));

/** The bundle the given selection id points at, if any. */
export function bundleByRowId(id: string | null): Extract<NavRow, { kind: 'bundle' }> | null {
  if (!id?.startsWith('bundle:')) return null;
  const row = useUi.getState().visibleRows.find((r) => navRowId(r) === id);
  return row?.kind === 'bundle' ? row : null;
}

/** The row keyboard actions act on: hovered beats selected (Spark semantics). */
export function keyboardTargetId(): string | null {
  const s = useUi.getState();
  return s.hoveredThreadId ?? s.selectedThreadId;
}
