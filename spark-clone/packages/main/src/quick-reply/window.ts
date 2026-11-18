import { app, BrowserWindow, Menu, screen, type WebContents, type WebPreferences } from 'electron';
import type { DeltaEvent, GlassRect, IslandStyle, NotifyPayload, QuickReplyItem, QuickReplyMode, QuickReplyState, QuickReplyView } from '@app/shared';
import { GlassBackdrops } from '../glass';
import { QuickReplyQueue } from './queue';

/** After the overlay is closed, keep it warm this long (and let an Undo Send finish), then free it. */
const IDLE_DESTROY_MS = 60_000;
/**
 * Close fades the page out first and hides the window after it, so the last
 * frame the window holds is a transparent one. Otherwise macOS flashes that
 * old frame (dim and all) for a moment on the next show. Matches the page's
 * .qr-scrim fade-out (180 ms) plus a little slack.
 */
const CLOSE_FADE_MS = 210;
/** Longest wait for macOS to hand activation back after app.hide() before Uniox's windows come back. */
const UNHIDE_FALLBACK_MS = 300;

/**
 * Whether Uniox is the active macOS app. Electron has no getter, so follow the
 * app events once the overlay exists, starting from whether a window has focus.
 */
let appActive = false;
let trackingActive = false;
function trackAppActive(): void {
  if (trackingActive || process.platform !== 'darwin') return;
  trackingActive = true;
  appActive = BrowserWindow.getFocusedWindow() !== null;
  app.on('did-become-active', () => (appActive = true));
  app.on('did-resign-active', () => (appActive = false));
}

/**
 * The quick-reply overlay: one frameless, transparent window covering the
 * whole display the pointer is on. The page dims everything behind it and
 * draws either the notification list (⌥⌘N) or the chat-style reply widget.
 *
 * It floats above other apps (and full-screen Spaces), so the dim works even
 * while Uniox is in the background. On macOS it is a panel: it takes the
 * keyboard without pulling the main Uniox window forward.
 *
 * Performance: the window exists only while open plus a minute of warm-up;
 * hidden, its page is idle (no animation loops, CSS-only transitions).
 */
export class QuickReplyWindow {
  readonly queue = new QuickReplyQueue();
  private win: BrowserWindow | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private hideTimer: NodeJS.Timeout | null = null;
  private shown = false;
  private mode: QuickReplyMode = 'list';
  /** The list's view: every open starts on unread only. */
  private view: QuickReplyView = 'unread';
  private currentId: string | null = null;
  /** A reply typed in Notification Center, for the widget to send (with Undo). */
  private pendingSend: QuickReplyState['send'] = null;
  private sendSeq = 0;
  /** The list opened this widget, so Esc steps back to it. */
  private backToList = false;
  /** The Uniox window that had the keyboard when the overlay opened (null: another app did). */
  private returnTo: BrowserWindow | null = null;
  /** Settings → Appearance → Island style. Frosted puts macOS's blur behind the page's panels. */
  private island: IslandStyle = 'glass';
  private readonly backdrops = new GlassBackdrops();

  constructor(
    private readonly opts: {
      webPreferences: WebPreferences;
      load: (win: BrowserWindow, hash: string) => void;
      guard: (win: BrowserWindow) => void;
      /** Kept emails changed: save them so they come back after a restart. */
      saveKept?: (items: QuickReplyItem[]) => void;
    },
  ) {
    trackAppActive();
  }

  /** Remember a notification for the list; refresh an open list. */
  record(payload: NotifyPayload): void {
    this.queue.record(payload);
    if (this.visible()) this.push();
  }

  state(): QuickReplyState {
    const items = this.queue.list();
    const current = this.queue.get(this.currentId) ? this.currentId : (items[0]?.id ?? null);
    return {
      mode: this.mode,
      items,
      currentId: current,
      shown: this.shown,
      send: this.pendingSend,
      canGoBack: this.mode === 'reply' && this.backToList,
      view: this.view,
      island: this.island,
    };
  }

  /** The island's look (frosted only on macOS) and the app's light/dark, for the blur's material. */
  setIsland(style: IslandStyle, dark: boolean): void {
    this.backdrops.setDark(dark);
    const next: IslandStyle = style === 'frosted' && process.platform === 'darwin' ? 'frosted' : 'glass';
    if (next === this.island) return;
    this.island = next;
    if (next === 'glass') this.backdrops.hide();
    if (this.visible()) this.push();
  }

  /** Frosted: the page reports where its glass panels are; the blur follows them. */
  glass(rects: GlassRect[]): void {
    const win = this.win;
    if (this.island !== 'frosted' || !win || win.isDestroyed() || !win.isVisible() || !this.shown) {
      this.backdrops.hide();
      return;
    }
    this.backdrops.sync(rects, win.getBounds());
  }

  /**
   * Open (or switch) the overlay. A payload picks the email to reply to;
   * `send` is a reply already written (in Notification Center) that the
   * widget sends straight away, Undo included.
   */
  open(mode: QuickReplyMode, current?: string | NotifyPayload | null, opts?: { send?: string }): void {
    this.clearTimers();
    const wasOpen = this.shown && this.visible();
    if (!wasOpen) {
      const focused = BrowserWindow.getFocusedWindow();
      this.returnTo = focused && focused !== this.win ? focused : null;
      this.view = 'unread';
    }
    // From the list into a reply: Esc comes back. ←/→ between replies keeps it.
    if (mode === 'list' || !wasOpen) this.backToList = false;
    else if (this.mode === 'list') this.backToList = true;
    this.shown = true;
    this.mode = mode;
    if (typeof current === 'string' || current === null) this.currentId = current;
    else if (current) this.currentId = (this.queue.find(current) ?? this.queue.record(current)).id;
    this.pendingSend =
      opts?.send && this.currentId ? { id: this.currentId, text: opts.send, seq: ++this.sendSeq } : null;
    const win = this.ensureWindow();
    if (!win.isVisible()) {
      this.place(win);
      // Show the (transparent) window first, then tell the page: it fades the
      // dim and the card in from nothing on screen, instead of painting them
      // while hidden and popping in at full strength.
      win.show();
    }
    win.focus();
    this.push();
  }

  /**
   * ⌥⌘N opens the list on unread mail. Pressed again while the list is open
   * it flips to the whole inbox and back (Esc closes). From a reply it goes
   * back to the list.
   */
  toggleList(): void {
    if (!this.visible() || !this.shown) this.open('list', null);
    else if (this.mode === 'reply') this.open('list', this.currentId);
    else this.setView(this.view === 'inbox' ? 'unread' : 'inbox');
  }

  setView(view: QuickReplyView): void {
    if (this.view === view) return;
    this.view = view;
    if (this.visible()) this.push();
  }

  dismiss(id: string): void {
    const wasKept = !!this.queue.get(id)?.kept;
    if (!this.queue.dismiss(id)) return;
    if (wasKept) this.saveKept();
    if (this.visible()) this.push();
  }

  /**
   * Keep an email in the list after it's read (K), or let it go again. An
   * unread thread that isn't listed yet comes in as a payload. Returns the
   * row's id.
   */
  keep(target: { id: string } | { item: NotifyPayload }, on: boolean): string | null {
    const id = 'id' in target ? target.id : (this.queue.find(target.item) ?? this.queue.record(target.item)).id;
    if (!this.queue.keep(id, on)) return null;
    this.saveKept();
    if (this.visible()) this.push();
    return id;
  }

  /** Saved kept emails, on launch. */
  restoreKept(saved: unknown): void {
    if (!Array.isArray(saved)) return;
    this.queue.restore(saved as QuickReplyItem[]);
    if (this.visible()) this.push();
  }

  private saveKept(): void {
    this.opts.saveKept?.(this.queue.kept());
  }

  /**
   * Fade out and hide. `returnFocus` (Esc, a click on the dim, ⌥⌘N again)
   * hands the keyboard back to whatever had it before the overlay opened;
   * leave it off when the user switched apps (blur) or Uniox's own window is
   * about to take over.
   */
  close(opts?: { returnFocus?: boolean }): void {
    const win = this.win;
    if (!win || win.isDestroyed() || !win.isVisible() || !this.shown) return;
    this.shown = false;
    this.backToList = false;
    // The blur can't fade with the page, so it leaves first; the panels fade out over the screen.
    this.backdrops.hide();
    const returnTo = this.returnTo;
    this.returnTo = null;
    this.push();
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (win.isDestroyed()) return;
      win.hide();
      if (opts?.returnFocus) this.giveFocusBack(returnTo);
      this.idleTimer = setTimeout(() => this.destroy(), IDLE_DESTROY_MS);
    }, CLOSE_FADE_MS);
  }

  /**
   * After the overlay hides, macOS picks who gets the keyboard. When Uniox
   * ended up the active app (a click on a notification activates it) but has
   * no window on this screen, macOS activated whichever app owns the next
   * window (often an unrelated one, like ForkLift) instead of the one you
   * were in. So: a Uniox window that had focus gets it back; otherwise, if
   * Uniox is active, hide it (macOS then reactivates the previous app, as ⌘H
   * does) and bring its windows straight back without activating them.
   */
  private giveFocusBack(returnTo: BrowserWindow | null): void {
    if (returnTo && !returnTo.isDestroyed() && returnTo.isVisible() && !returnTo.isMinimized()) {
      returnTo.focus();
      return;
    }
    if (process.platform !== 'darwin' || !appActive) return;
    let done = false;
    const unhide = () => {
      if (done) return;
      done = true;
      clearTimeout(fallback);
      app.off('did-resign-active', unhide);
      // NSApplication's unhideWithoutActivation: Uniox's windows (and its
      // notification toasts) show again while the other app keeps the keyboard.
      Menu.sendActionToFirstResponder('unhideWithoutActivation');
    };
    const fallback = setTimeout(unhide, UNHIDE_FALLBACK_MS);
    app.on('did-resign-active', unhide);
    app.hide();
  }

  destroy(): void {
    this.clearTimers();
    this.shown = false;
    this.backdrops.destroy();
    this.win?.destroy();
  }

  private clearTimers(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.idleTimer = null;
    this.hideTimer = null;
  }

  owns(contents: WebContents): boolean {
    return !!this.win && !this.win.isDestroyed() && this.win.webContents === contents;
  }

  /** Mail deltas (new bodies, thread changes) so the open conversation stays current. */
  forward(event: DeltaEvent): void {
    if (event.kind !== 'threads-changed' && event.kind !== 'message-body' && event.kind !== 'accounts-changed') return;
    if (this.visible()) this.win!.webContents.send('delta', event);
  }

  private visible(): boolean {
    return !!this.win && !this.win.isDestroyed() && this.win.isVisible();
  }

  private push(): void {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.webContents.send('delta', { kind: 'quick-reply', state: this.state() } satisfies DeltaEvent);
  }

  /** Cover the whole display the pointer is on, menu bar and Dock included. */
  private place(win: BrowserWindow): void {
    const { bounds } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    win.setBounds(bounds);
  }

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const mac = process.platform === 'darwin';
    const win = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      enableLargerThanScreen: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      roundedCorners: false,
      // A panel takes key focus without activating (and raising) the main window.
      ...(mac ? { type: 'panel' } : {}),
      webPreferences: { ...this.opts.webPreferences, backgroundThrottling: false },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    // Switching to another app hides the overlay, Spotlight-style.
    win.on('blur', () => this.close());
    win.on('hide', () => this.backdrops.hide());
    win.on('closed', () => {
      if (this.win === win) this.win = null;
    });
    this.opts.guard(win);
    this.opts.load(win, 'quick-reply');
    this.win = win;
    return win;
  }
}
