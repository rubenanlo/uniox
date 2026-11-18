import { BrowserWindow, ipcMain, nativeTheme, screen } from 'electron';
import type { IslandStyle, NotifyContext, NotifyPayload } from '@app/shared';
import { GlassBackdrops } from '../glass';
import { giveActivationBack, isAppActive, makeNonActivating, trackAppActive, unioxWantedSince } from '../mac-activation';
import { trace, traceWindow } from '../debug-activation';
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
 * one; parked (transparent and click-through), it runs nothing. It never takes focus or activates Uniox, and it ignores the mouse
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
  /** Frosted island: the cards are clear and macOS blurs what's behind each one. */
  private frosted = false;
  /** Share (0–90) of the theme's surface laid over the glass: Settings → Transparency behind. */
  private frost = 0;
  private readonly backdrops = new GlassBackdrops();
  /**
   * Empty but still ordered in: transparent and click-through instead of
   * hidden (see 'empty').
   */
  private parked = false;
  /** The Uniox window that had the keyboard when the pointer reached a card. */
  private returnTo: BrowserWindow | null = null;
  /** When the pointer reached a card (0: not over one), and whether Uniox was the active app then. */
  private hoverAt = 0;
  private activeAtHover = true;

  constructor(
    private readonly opts: {
      preload: string;
      onAction: (payload: NotifyPayload | null, action: CardAction) => void;
      /** Another Uniox overlay (the island) holds the keyboard on purpose right now. */
      busy?: () => boolean;
    },
  ) {
    trackAppActive();
    ipcMain.on('notify-overlay', (event, msg: OverlayToMain) => {
      if (!this.win || event.sender !== this.win.webContents) return;
      this.handle(msg);
    });
  }

  setContext(ctx: NotifyContext): void {
    const themeChanged = this.ctx?.dark !== ctx.dark;
    this.ctx = ctx;
    this.backdrops.setDark(ctx.dark);
    if (themeChanged) this.post({ kind: 'theme', dark: ctx.dark });
  }

  setIsland(style: IslandStyle): void {
    const frosted = style === 'frosted' && process.platform === 'darwin';
    if (frosted === this.frosted) return;
    this.frosted = frosted;
    if (!frosted) this.backdrops.hide();
    this.postIsland();
  }

  /** Settings → Appearance → Transparency behind, as a frost share (0 clear … 90 nearly solid). */
  setFrost(frost: number): void {
    this.backdrops.setClear(frost === 0);
    if (frost === this.frost) return;
    this.frost = frost;
    this.postIsland();
  }

  private postIsland(): void {
    this.post({ kind: 'island', frosted: this.frosted, liquid: this.frosted && this.backdrops.liquid, frost: this.frost });
  }

  async show(payload: NotifyPayload): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const id = `n${++this.seq}`;
    this.payloads.set(id, payload);
    const card = buildCard(id, payload, this.ctx, Date.now());
    trace('toast:show', { id });
    const win = await this.ensureWindow();
    if (!win.isVisible() || this.parked) {
      this.place(win);
      trace('toast:reveal', { visible: win.isVisible(), parked: this.parked });
      if (!win.isVisible()) win.showInactive();
      win.setOpacity(1);
      this.parked = false;
    }
    this.posted++;
    this.post({ kind: 'show', card });
  }

  /**
   * Free the window after a quiet minute, but only while another app is in
   * front: closing it while you're in Uniox is the same ordering out that
   * 'empty' avoids.
   */
  private scheduleIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      const focused = BrowserWindow.getFocusedWindow();
      if (focused && focused !== this.win) this.scheduleIdle();
      else this.destroy();
    }, IDLE_DESTROY_MS);
  }

  destroy(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    trace('toast:destroy');
    this.backdrops.destroy();
    if (this.win && !this.win.isDestroyed()) this.handBack(this.win);
    this.win?.destroy();
  }

  /**
   * A click on a card can leave the overlay holding the keyboard. Taking a
   * key window off screen makes macOS pick another, and with Uniox's own
   * window not in the running it activated whatever app was behind it (in
   * Ruben's recording, Excel came forward in place of the Uniox window he
   * was in). So hand the keyboard back to the Uniox window that had it.
   */
  private handBack(win: BrowserWindow): void {
    const to = this.returnTo;
    this.returnTo = null;
    if (!win.isFocused() || !to || to.isDestroyed() || !to.isVisible() || to.isMinimized()) return;
    to.focus();
  }

  /**
   * The pointer left the cards. If a click on one activated Uniox while you
   * were in another app, and the click wasn't meant to open Uniox (Read,
   * Done, Snooze, Join, a quick reply), give activation straight back to that
   * app: a notification never pulls you into Uniox.
   */
  private releaseHover(): void {
    const since = this.hoverAt;
    if (!since) return;
    this.hoverAt = 0;
    if (this.activeAtHover || !isAppActive() || unioxWantedSince(since) || this.opts.busy?.()) return;
    giveActivationBack();
  }

  private handle(msg: OverlayToMain): void {
    const win = this.win;
    if (!win) return;
    if (msg.kind !== 'glass') trace(`toast:${msg.kind}`, msg);
    switch (msg.kind) {
      case 'interactive':
        if (msg.on) {
          const focused = BrowserWindow.getFocusedWindow();
          if (focused && focused !== win) this.returnTo = focused;
          if (!this.hoverAt) {
            this.hoverAt = Date.now();
            this.activeAtHover = isAppActive();
          }
          win.setIgnoreMouseEvents(false);
        } else {
          win.setIgnoreMouseEvents(true, { forward: true });
          this.releaseHover();
        }
        return;
      case 'empty':
        if (msg.shown !== this.posted) return; // a card is on its way
        this.payloads.clear();
        this.backdrops.hide();
        win.setIgnoreMouseEvents(true, { forward: true });
        // Parked, not hidden: transparent and click-through but still
        // ordered in, so taking the last card away never orders a window out
        // (and never makes macOS choose who gets the keyboard; see handBack).
        // It costs nothing while idle and goes with the window in a minute.
        win.setOpacity(0);
        this.parked = true;
        this.handBack(win);
        this.releaseHover();
        this.scheduleIdle();
        return;
      case 'glass':
        if (this.frosted && win.isVisible() && !this.parked) this.backdrops.sync(msg.rects, win.getBounds());
        else this.backdrops.hide();
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

  /**
   * Top-right of the display the pointer is on, under the menu bar. The
   * window reaches the screen's right edge (the page keeps the cards off it),
   * so a card sliding in or out is cut by the screen, not by a visible line
   * a few pixels short of it.
   */
  private place(win: BrowserWindow): void {
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    win.setBounds({
      x: Math.round(workArea.x + workArea.width - OVERLAY_WIDTH),
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
    traceWindow(win, 'toasts');
    makeNonActivating(win);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    win.setIgnoreMouseEvents(true, { forward: true });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.on('closed', () => {
      this.backdrops.hide();
      if (this.win === win) {
        this.win = null;
        this.parked = false;
        this.loaded = null;
        this.posted = 0;
        this.payloads.clear();
      }
    });
    this.win = win;
    this.loaded = win.loadURL(OVERLAY_URL).then(() => {
      this.post({ kind: 'theme', dark: this.ctx?.dark ?? nativeTheme.shouldUseDarkColors });
      this.postIsland();
    });
    await this.loaded;
    return win;
  }
}
