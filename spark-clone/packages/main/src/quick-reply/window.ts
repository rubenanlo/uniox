import { BrowserWindow, screen, type WebContents, type WebPreferences } from 'electron';
import type { DeltaEvent, NotifyPayload, QuickReplyItem, QuickReplyMode, QuickReplyState } from '@app/shared';
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
  private currentId: string | null = null;
  /** A reply typed in Notification Center, for the widget to send (with Undo). */
  private pendingSend: QuickReplyState['send'] = null;
  private sendSeq = 0;

  constructor(
    private readonly opts: {
      webPreferences: WebPreferences;
      load: (win: BrowserWindow, hash: string) => void;
      guard: (win: BrowserWindow) => void;
      /** Kept emails changed: save them so they come back after a restart. */
      saveKept?: (items: QuickReplyItem[]) => void;
    },
  ) {}

  /** Remember a notification for the list; refresh an open list. */
  record(payload: NotifyPayload): void {
    this.queue.record(payload);
    if (this.visible()) this.push();
  }

  state(): QuickReplyState {
    const items = this.queue.list();
    const current = this.queue.get(this.currentId) ? this.currentId : (items[0]?.id ?? null);
    return { mode: this.mode, items, currentId: current, shown: this.shown, send: this.pendingSend };
  }

  /**
   * Open (or switch) the overlay. A payload picks the email to reply to;
   * `send` is a reply already written (in Notification Center) that the
   * widget sends straight away, Undo included.
   */
  open(mode: QuickReplyMode, current?: string | NotifyPayload | null, opts?: { send?: string }): void {
    this.clearTimers();
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

  /** ⌥⌘N while open closes it again. */
  toggleList(): void {
    if (this.visible() && this.shown) this.close();
    else this.open('list', null);
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

  close(): void {
    const win = this.win;
    if (!win || win.isDestroyed() || !win.isVisible() || !this.shown) return;
    this.shown = false;
    this.push();
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (win.isDestroyed()) return;
      win.hide();
      this.idleTimer = setTimeout(() => this.destroy(), IDLE_DESTROY_MS);
    }, CLOSE_FADE_MS);
  }

  destroy(): void {
    this.clearTimers();
    this.shown = false;
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
    win.on('closed', () => {
      if (this.win === win) this.win = null;
    });
    this.opts.guard(win);
    this.opts.load(win, 'quick-reply');
    this.win = win;
    return win;
  }
}
