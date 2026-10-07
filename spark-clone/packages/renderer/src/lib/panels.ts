import { bundleByRowId, useUi } from '../state/store';

/**
 * Superhuman-style panel navigation: ← / → always move between the three
 * panels (sidebar ⇄ mail list ⇄ reading pane), no matter which element
 * happens to hold DOM focus. The keymap routes arrows here; Enter steps
 * into the panel to the right (sidebar → list, list → reading).
 */
export type Panel = 'sidebar' | 'list' | 'reading';

export function currentPanel(): Panel {
  const el = document.activeElement;
  if (el instanceof HTMLElement) {
    if (el.closest('nav[aria-label="Mailboxes"]')) return 'sidebar';
    if (el.closest('.reading-pane')) return 'reading';
  }
  // The list is the home panel: anything unclaimed (body, top bar, the list
  // itself) navigates as if the list had focus.
  return 'list';
}

export function focusSidebar(): void {
  // Focusing a nav button reveals the auto-hiding sidebar (it opens on focus).
  const btn =
    document.querySelector<HTMLElement>('nav button[data-active="true"]') ??
    document.querySelector<HTMLElement>('nav button[data-nav]');
  btn?.focus();
}

/**
 * The `/` shortcut. On every view except Home it expands/collapses the sticky
 * rail (classic behavior). On Home the sidebar auto-hides, so `/` instead
 * reveals and focuses it — or blurs it back off-canvas if it's already showing.
 */
export function toggleSidebarReveal(): void {
  const ui = useUi.getState();
  if (ui.view !== 'home' && ui.view !== 'calendar') {
    ui.toggleSidebar();
    return;
  }
  const nav = document.querySelector('nav[aria-label="Mailboxes"]');
  const active = document.activeElement;
  const showing =
    nav instanceof HTMLElement && active instanceof HTMLElement && nav.contains(active);
  if (showing) active.blur(); // focus leaves the sidebar → it tucks away
  else focusSidebar();
}

export function focusList(): void {
  const ui = useUi.getState();
  // In split view a selection keeps the reading pane meaningful; in single
  // pane selecting would immediately open the thread, so leave it alone.
  if (ui.split && !ui.selectedThreadId && ui.visibleThreads.length) {
    ui.selectThread(ui.visibleThreads[0]!.id, true);
  }
  // A view switch can remount the list right after we focus it (dropping
  // focus to body), so re-claim briefly — but never once the user has
  // meaningfully moved focus elsewhere.
  const claim = (attempt: number) => {
    const active = document.activeElement;
    const focusLostOrOurs =
      !(active instanceof HTMLElement) ||
      active === document.body ||
      !!active.closest('[data-thread-list]');
    if (attempt > 0 && !focusLostOrOurs) return;
    document.querySelector<HTMLElement>('[data-thread-list]')?.focus();
    if (attempt < 5) setTimeout(() => claim(attempt + 1), 100);
  };
  claim(0);
}

/**
 * Land on the newest message header of the open thread (Enter toggles it).
 * Messages load async, so briefly retry for the headers while focus is still
 * parked on the pane itself.
 */
export function focusReading(): void {
  const pane = document.querySelector<HTMLElement>('.reading-pane');
  if (!pane) return;
  const tryHeader = (attempt: number) => {
    const headers = pane.querySelectorAll<HTMLElement>('article > button');
    const last = headers[headers.length - 1];
    if (last) {
      last.focus();
      return;
    }
    if (attempt < 6 && pane.contains(document.activeElement)) {
      setTimeout(() => tryHeader(attempt + 1), 80);
    }
  };
  pane.focus();
  tryHeader(0);
}

export function focusPanelLeft(): void {
  const panel = currentPanel();
  if (panel === 'reading') {
    const ui = useUi.getState();
    if (!ui.split) ui.selectThread(null); // single pane: back out to the list
    setTimeout(focusList);
  } else if (panel === 'list') {
    focusSidebar();
  }
}

export function focusPanelRight(): void {
  const panel = currentPanel();
  if (panel === 'sidebar') {
    // On Home there's no list to step into, so focusList() can't move focus out
    // of the drawer. Blur it directly — dropping focus tucks the auto-hide pane
    // away, mirroring the kanban board's → behavior.
    if (useUi.getState().view === 'home' || useUi.getState().view === 'calendar') {
      (document.activeElement as HTMLElement | null)?.blur();
      return;
    }
    focusList(); // stepping right blurs the sidebar, which tucks it away
    return;
  }
  if (panel === 'list') {
    // → on a Smart Inbox bundle row steps into the group, like Enter.
    const bundle = bundleByRowId(useUi.getState().selectedThreadId);
    if (bundle) {
      useUi.getState().setCategoryFocus(bundle.category);
      return;
    }
    openSelectedThread();
  }
}

/** Enter on a list row / → from the list: put keyboard focus in the thread. */
export function openSelectedThread(threadId?: string): void {
  const ui = useUi.getState();
  const id = threadId ?? ui.selectedThreadId;
  if (!id || id.startsWith('bundle:') || id === 'priority:toggle') return;
  // Always re-select, even for the current thread: Enter on an arrow-browsed
  // (auto) selection upgrades it to a deliberate open, which marks it read.
  ui.selectThread(id);
  // the reading pane may render on this selection; focus it next tick
  setTimeout(focusReading);
}

/** A gatekeeper card's Accept / Block button, if that card is rendered. */
export function gatekeeperButton(index: number, choice: 'accept' | 'block'): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(
    `[data-gk-index="${index}"][data-gk-choice="${choice}"]`,
  );
}

/**
 * ↑ from the first mail row steps up into the new-sender cards, landing on the
 * first card's Accept. Returns false when no cards are showing.
 */
export function focusGatekeeper(): boolean {
  const btn = gatekeeperButton(0, 'accept');
  if (!btn) return false;
  const ui = useUi.getState();
  // Triage keys act on the selection; with focus up in the cards they must not
  // silently archive the email underneath.
  ui.selectThread(null);
  ui.hoverThread(null);
  btn.focus();
  return true;
}
