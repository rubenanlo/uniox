import { BrowserWindow, screen, type WebContents, type WebPreferences } from 'electron';
import type { DeltaEvent, NotifyPayload, QuickReplyMode, QuickReplyState } from '@app/shared';
import { QuickReplyQueue } from './queue';

/** After the overlay is closed, keep it warm this long (and let an Undo Send finish), then free it. */
const IDLE_DESTROY_MS = 60_000;

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
  private mode: QuickReplyMode = 'list';
  private currentId: string | null = null;

  constructor(
    private readonly opts: {
      webPreferences: WebPreferences;
      load: (win: BrowserWindow, hash: string) => void;
      guard: (win: BrowserWindow) => void;
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
    return { mode: this.mode, items, currentId: current };
  }

  /** Open (or switch) the overlay. A payload picks the email to reply to. */
  open(mode: QuickReplyMode, current?: string | NotifyPayload | null): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.mode = mode;
    if (typeof current === 'string' || current === null) this.currentId = current;
    else if (current) this.currentId = (this.queue.find(current) ?? this.queue.record(current)).id;
    const win = this.ensureWindow();
    if (!win.isVisible()) {
      this.place(win);
      // Fresh page state for a fresh open; the page re-queries on show.
      this.push();
      win.show();
    } else this.push();
    win.focus();
  }

  /** ⌥⌘N while open closes it again. */
  toggleList(): void {
    if (this.visible()) this.close();
    else this.open('list', null);
  }

  dismiss(id: string): void {
    if (this.queue.dismiss(id) && this.visible()) this.push();
  }

  close(): void {
    const win = this.win;
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    win.hide();
    this.idleTimer = setTimeout(() => this.destroy(), IDLE_DESTROY_MS);
  }

  destroy(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.win?.destroy();
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
