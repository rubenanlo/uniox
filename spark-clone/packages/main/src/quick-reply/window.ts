import { BrowserWindow, screen, type Rectangle, type WebContents, type WebPreferences } from 'electron';
import type { DeltaEvent, GlassRect, IslandDisplay, IslandStyle, NotifyPayload, QuickReplyItem, QuickReplyMode, QuickReplyState, QuickReplyView } from '@app/shared';
import { GlassBackdrops } from '../glass';
import { giveActivationBack, makeNonActivating, trackAppActive } from '../mac-activation';
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
/** The page's own fade-out (.qr-scrim), which the glass behind its panels follows. */
const PAGE_FADE_MS = 180;
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
  /** The page has painted once; until then showing the window flashes an empty transparent surface. */
  private ready = false;
  /** open() ran before the first paint: show as soon as the page is ready. */
  private pendingShow = false;
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
  private display: IslandDisplay = 'pointer';
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

  /** On screen (not closing). */
  get isOpen(): boolean {
    return this.shown && this.visible();
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
      liquid: this.island === 'frosted' && this.backdrops.liquid,
    };
  }

  /** Which screen the next open lands on (an open window stays where it is). */
  setDisplay(display: IslandDisplay): void {
    this.display = display === 'primary' ? 'primary' : 'pointer';
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

  /** Settings → Transparency behind at Clear: Liquid Glass's clear variant, no frost of its own. */
  setGlassClear(clear: boolean): void {
    this.backdrops.setClear(clear);
  }

  /** Frosted: the page reports where its glass panels are; the blur follows them. */
  glass(rects: GlassRect[]): void {
    const win = this.win;
    // Closing: the page clears its rects as it starts to fade; the glass fades with it instead.
    if (!this.shown && this.hideTimer) return;
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
    if (!this.ready) {
      // First open: the window was just made and the page hasn't painted. Showing it
      // now makes macOS composite a blank full-screen surface for a moment (the
      // flicker on the very first ⌥⌘N). Wait for the first paint instead.
      this.pendingShow = true;
      return;
    }
    this.reveal(win);
  }

  private reveal(win: BrowserWindow): void {
    if (!win.isVisible()) {
      const bounds = this.place(win);
      // Show the (transparent) window first, then tell the page: it fades the
      // dim and the card in from nothing on screen, instead of painting them
      // while hidden and popping in at full strength.
      win.show();
      // macOS can move a hidden window back to the main display as it shows
      // it (seen on a secondary screen): put it back on the chosen screen
      // right after, and again a beat later in case the move lands late.
      this.keepOn(win, bounds);
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
    if (this.pendingShow) {
      this.pendingShow = false;
      this.shown = false;
      this.backToList = false;
      this.returnTo = null;
      return;
    }
    const win = this.win;
    if (!win || win.isDestroyed() || !win.isVisible() || !this.shown) return;
    this.shown = false;
    this.backToList = false;
    // The glass fades out with the page (its .qr-scrim fade), so the text never floats bare.
    this.backdrops.fadeOut(PAGE_FADE_MS);
    const returnTo = this.returnTo;
    this.returnTo = null;
    this.push();
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (win.isDestroyed()) return;
      if (opts?.returnFocus) this.hideAndGiveFocusBack(win, returnTo);
      else win.hide();
      this.idleTimer = setTimeout(() => this.destroy(), IDLE_DESTROY_MS);
    }, CLOSE_FADE_MS);
  }

  /**
   * Hide the overlay and hand the keyboard back.
   *
   * - A Uniox window that had focus at open gets it back.
   * - Otherwise, never order the panel out on its own. It holds the keyboard,
   *   and when it goes macOS hands the keyboard to Uniox's next window,
   *   activating Uniox and raising its main window over the app you were in
   *   (or, from a toast click, bringing some other app such as ForkLift
   *   forward). That happens whether or not Uniox counted as the active app,
   *   since Electron's panel only pretends to be non-activating. So hide the
   *   whole app in one step, panel included (its page has already faded to
   *   nothing). Nothing of Uniox is left to take the keyboard, and macOS gives
   *   it back to the app you were in, as ⌘H does. Then drop the panel and
   *   bring Uniox's other windows back behind that app without activating.
   */
  private hideAndGiveFocusBack(win: BrowserWindow, returnTo: BrowserWindow | null): void {
    if (returnTo && !returnTo.isDestroyed() && returnTo.isVisible() && !returnTo.isMinimized()) {
      win.hide();
      returnTo.focus();
      return;
    }
    // Order the panel out while the app is hidden so unhiding leaves it out
    // (unless ⌥⌘N opened it again in the meantime).
    giveActivationBack(() => {
      if (!win.isDestroyed() && !this.shown) win.hide();
    });
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

  /** Cover the whole display (the pointer's or the primary one, per Settings), menu bar and Dock included. */
  private place(win: BrowserWindow): Rectangle {
    const { bounds } =
      this.display === 'primary' ? screen.getPrimaryDisplay() : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    win.setBounds(bounds);
    return bounds;
  }

  private keepOn(win: BrowserWindow, bounds: Rectangle): void {
    const fix = () => {
      if (win.isDestroyed() || !win.isVisible()) return;
      const b = win.getBounds();
      if (b.x !== bounds.x || b.y !== bounds.y || b.width !== bounds.width || b.height !== bounds.height) win.setBounds(bounds);
    };
    fix();
    setTimeout(fix, 60);
    setTimeout(fix, 250);
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
    makeNonActivating(win);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    // Switching to another app hides the overlay, Spotlight-style.
    win.on('blur', () => this.close());
    win.on('hide', () => this.backdrops.hide());
    win.on('closed', () => {
      if (this.win === win) this.win = null;
    });
    this.ready = false;
    const onReady = () => {
      if (this.win !== win || win.isDestroyed() || this.ready) return;
      this.ready = true;
      if (!this.pendingShow) return;
      this.pendingShow = false;
      this.reveal(win);
    };
    win.once('ready-to-show', onReady);
    // Never leave ⌥⌘N dead if the paint event doesn't come.
    setTimeout(onReady, 1500);
    this.opts.guard(win);
    this.opts.load(win, 'quick-reply');
    this.win = win;
    return win;
  }
}
