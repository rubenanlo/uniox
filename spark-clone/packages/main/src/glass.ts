import { BrowserWindow, type Rectangle } from 'electron';
import type { GlassRect } from '@app/shared';
import { backdropBounds } from './glass-geometry';

/** The bit of electron-liquid-glass we use (an optional, macOS-only dependency). */
interface LiquidGlassApi {
  isGlassSupported(): boolean;
  addView(handle: Buffer, options?: { cornerRadius?: number; tintColor?: string; opaque?: boolean }): number;
}

let liquidApi: LiquidGlassApi | null | undefined;
/**
 * macOS 26's Liquid Glass (NSGlassEffectView), through electron-liquid-glass.
 * It follows System Settings → Appearance → Liquid Glass (Clear / Tinted) by
 * itself. Null before macOS 26, off the Mac, or if the module didn't install.
 */
export function liquidGlass(): LiquidGlassApi | null {
  if (liquidApi !== undefined) return liquidApi;
  liquidApi = null;
  if (process.platform !== 'darwin') return liquidApi;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('electron-liquid-glass') as LiquidGlassApi & { default?: LiquidGlassApi };
    const api = mod.default ?? mod;
    if (api.isGlassSupported()) liquidApi = api;
  } catch {
    liquidApi = null;
  }
  return liquidApi;
}

/**
 * The "Liquid glass" island's backdrop. CSS can't see other apps through a
 * transparent window, so the glass comes from macOS: one small window
 * behind each glass panel, sized and moved to follow it. They sit one level
 * below the island's windows (still above every app), never take focus or
 * the mouse, and are hidden whenever there's nothing to blur.
 *
 * On macOS 26+ each window holds a real Liquid Glass view (Clear or Tinted,
 * per System Settings) sized to the whole panel with its corner radius.
 * Earlier macOS falls back to a vibrancy material, inset so the window's own
 * 10px corners stay under the panel's curve.
 *
 * Cost: an empty window per panel (no page work), only while frosted panels
 * are on screen; destroyed together with the island.
 */
export class GlassBackdrops {
  private readonly pool: BrowserWindow[] = [];
  /** The radius and tint each pooled window's glass was made with (Liquid Glass can't change them later). */
  private readonly made = new WeakMap<BrowserWindow, string>();
  private dark = false;

  /** The last panels synced, to rebuild them when the theme changes while they're up. */
  private last: { rects: GlassRect[]; origin: { x: number; y: number } } | null = null;

  /** True when panels sit on real Liquid Glass (the page then drops its own fill). */
  get liquid(): boolean {
    return liquidGlass() !== null;
  }

  setDark(dark: boolean): void {
    if (this.dark === dark) return;
    this.dark = dark;
    // Liquid Glass keeps the tint it was made with: drop the pool, the next sync remakes it.
    if (this.liquid) {
      const shown = this.pool.some((w) => !w.isDestroyed() && w.isVisible());
      this.destroy();
      if (shown && this.last) this.sync(this.last.rects, this.last.origin);
      return;
    }
    for (const w of this.pool) if (!w.isDestroyed()) w.setVibrancy(this.material());
  }

  /** Put a blur behind each rect (window coordinates of the window at `origin`); hide the rest. */
  sync(rects: GlassRect[], origin: { x: number; y: number }): void {
    if (process.platform !== 'darwin') return;
    this.last = rects.length ? { rects, origin } : null;
    const liquid = this.liquid;
    const panels = rects
      .map((r) => ({ radius: Math.round(r.radius), bounds: liquid ? fullBounds(r, origin) : backdropBounds(r, origin) }))
      .filter((p): p is { radius: number; bounds: Rectangle } => !!p.bounds);
    const bounds = panels.map((p) => p.bounds);
    panels.forEach(({ radius, bounds: b }, i) => {
      let w: BrowserWindow | undefined = this.pool[i];
      // Liquid Glass keeps the corner radius it was made with: remake for a rounder or squarer panel.
      if (w && !w.isDestroyed() && liquid && this.made.get(w) !== this.key(radius)) w.destroy();
      if (!w || w.isDestroyed()) w = this.pool[i] = this.create(radius);
      w.setBounds(b, false);
      if (!w.isVisible()) w.showInactive();
    });
    for (const w of this.pool.slice(bounds.length)) if (!w.isDestroyed() && w.isVisible()) w.hide();
  }

  hide(): void {
    this.last = null;
    for (const w of this.pool) if (!w.isDestroyed() && w.isVisible()) w.hide();
  }

  destroy(): void {
    for (const w of this.pool) if (!w.isDestroyed()) w.destroy();
    this.pool.length = 0;
  }

  private key(radius: number): string {
    return `${radius}:${this.dark ? 'dark' : 'light'}`;
  }

  /**
   * In dark mode the glass gets a dark smoke tint: Liquid Glass on its own
   * turns light over bright windows, and the island's white text then
   * vanishes. Light mode keeps the plain glass (Clear / Tinted as set).
   */
  private tint(): string | undefined {
    return this.dark ? '#14141acc' : undefined;
  }

  /** HUD is always dark. In light mode 'under-window' is the thinnest material:
   *  'popover' laid a milky grey-white of its own over the blur, so the panel
   *  read as a flat card instead of the AI windows' see-through glass. */
  private material(): 'hud' | 'under-window' {
    return this.dark ? 'hud' : 'under-window';
  }

  private create(radius: number): BrowserWindow {
    const liquid = liquidGlass();
    const w = new BrowserWindow({
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
      type: 'panel',
      ...(liquid ? {} : { vibrancy: this.material(), visualEffectState: 'active' as const }),
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
    });
    // Under the island (screen-saver level) but over every app window and the menu bar.
    w.setAlwaysOnTop(true, 'pop-up-menu');
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    w.setIgnoreMouseEvents(true);
    if (liquid) {
      this.made.set(w, this.key(radius));
      const tintColor = this.tint();
      w.webContents.once('did-finish-load', () => {
        if (!w.isDestroyed()) liquid.addView(w.getNativeWindowHandle(), { cornerRadius: radius, ...(tintColor ? { tintColor } : {}) });
      });
    }
    void w.loadURL('about:blank');
    return w;
  }
}

/** Liquid Glass draws its own rounded corners, so its window covers the whole panel. */
function fullBounds(r: GlassRect, origin: { x: number; y: number }): Rectangle | null {
  if (r.width < 4 || r.height < 4) return null;
  return {
    x: Math.round(origin.x + r.x),
    y: Math.round(origin.y + r.y),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
}
