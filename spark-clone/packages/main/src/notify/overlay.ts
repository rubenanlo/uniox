import { BrowserWindow, ipcMain, nativeTheme, screen } from 'electron';
import type { NotifyContext, NotifyPayload } from '@app/shared';
import { buildCard } from './build-card';
import type { CardAction, MainToOverlay, OverlayToMain } from './card';
import { OVERLAY_HEIGHT, OVERLAY_URL, OVERLAY_WIDTH } from './overlay-page';

/** After the last card leaves, keep the window warm this long, then free it. */
const IDLE_DESTROY_MS = 60_000;
const EDGE = 6;

/**
 * Uniox's own notification cards, in one frameless, transparent, always-on-top
 * window in the screen's top-right corner.
 *
 * Performance: the window (and its renderer process, ~30 MB) exists only
 * while there is something to show plus a minute of warm-up for the next
 * one; hidden, it runs nothing. It never takes focus, and it ignores the mouse
 * except while the pointer is over a card, so the empty area stays
 * click-through.
 */
export class NotifyOverlay {
  private win: BrowserWindow | null = null;
  private loaded: Promise<void> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private ctx: NotifyContext | null = null;
  private seq = 0;
  /** Cards posted to the current window (compared with the overlay's own count). */
  private posted = 0;
  /** Payloads of cards on screen, so actions know their thread/message. */
  private readonly payloads = new Map<string, NotifyPayload>();

  constructor(
    private readonly opts: {
      preload: string;
      onAction: (payload: NotifyPayload | null, action: CardAction) => void;
    },
  ) {
    ipcMain.on('notify-overlay', (event, msg: OverlayToMain) => {
      if (!this.win || event.sender !== this.win.webContents) return;
      this.handle(msg);
    });
  }

  setContext(ctx: NotifyContext): void {
    const themeChanged = this.ctx?.dark !== ctx.dark;
    this.ctx = ctx;
    if (themeChanged) this.post({ kind: 'theme', dark: ctx.dark });
  }

  async show(payload: NotifyPayload): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const id = `n${++this.seq}`;
    this.payloads.set(id, payload);
    const card = buildCard(id, payload, this.ctx, Date.now());
    const win = await this.ensureWindow();
    if (!win.isVisible()) {
      this.place(win);
      win.showInactive();
    }
    this.posted++;
    this.post({ kind: 'show', card });
  }

  destroy(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.win?.destroy();
  }

  private handle(msg: OverlayToMain): void {
    const win = this.win;
    if (!win) return;
    switch (msg.kind) {
      case 'interactive':
        if (msg.on) win.setIgnoreMouseEvents(false);
        else win.setIgnoreMouseEvents(true, { forward: true });
        return;
      case 'empty':
        if (msg.shown !== this.posted) return; // a card is on its way
        this.payloads.clear();
        win.setIgnoreMouseEvents(true, { forward: true });
        win.hide();
        this.idleTimer = setTimeout(() => this.destroy(), IDLE_DESTROY_MS);
        return;
      case 'action': {
        const payload = this.payloads.get(msg.id) ?? null;
        this.payloads.delete(msg.id);
        this.opts.onAction(payload, msg.action);
        return;
      }
    }
  }

  private post(msg: MainToOverlay): void {
    this.win?.webContents.send('notify-overlay', msg);
  }

  /** Top-right of the display the pointer is on, under the menu bar. */
  private place(win: BrowserWindow): void {
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    win.setBounds({
      x: Math.round(workArea.x + workArea.width - OVERLAY_WIDTH - EDGE),
      y: Math.round(workArea.y + EDGE),
      width: OVERLAY_WIDTH,
      height: Math.min(OVERLAY_HEIGHT, workArea.height - EDGE * 2),
    });
  }

  private async ensureWindow(): Promise<BrowserWindow> {
    if (this.win && !this.win.isDestroyed()) {
      await this.loaded;
      return this.win;
    }
    const mac = process.platform === 'darwin';
    const win = new BrowserWindow({
      width: OVERLAY_WIDTH,
      height: OVERLAY_HEIGHT,
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
      skipTaskbar: true,
      focusable: false,
      acceptFirstMouse: true,
      alwaysOnTop: true,
      // A non-activating panel: floats over full-screen apps, never steals focus.
      ...(mac ? { type: 'panel' } : {}),
      webPreferences: {
        preload: this.opts.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    win.setIgnoreMouseEvents(true, { forward: true });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.on('closed', () => {
      if (this.win === win) {
        this.win = null;
        this.loaded = null;
        this.posted = 0;
        this.payloads.clear();
      }
    });
    this.win = win;
    this.loaded = win.loadURL(OVERLAY_URL).then(() => {
      this.post({ kind: 'theme', dark: this.ctx?.dark ?? nativeTheme.shouldUseDarkColors });
    });
    await this.loaded;
    return win;
  }
}
