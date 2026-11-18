import { BrowserWindow, type Rectangle } from 'electron';
import type { GlassRect } from '@app/shared';
import { backdropBounds } from './glass-geometry';
import { makeNonActivating } from './mac-activation';

/** Corner radii this close share a Liquid Glass window (see sync). */
const RADIUS_SLACK = 3;

/** The bit of electron-liquid-glass we use (an optional, macOS-only dependency). */
interface LiquidGlassApi {
  isGlassSupported(): boolean;
  addView(handle: Buffer, options?: { cornerRadius?: number; tintColor?: string; opaque?: boolean }): number;
  /** NSGlassEffectView's material variant: 0 regular (frosted), 1 clear. Private API, so optional. */
  unstable_setVariant?(id: number, variant: number): void;
}

/** electron-liquid-glass variant ids (GlassMaterialVariant). */
const VARIANT_REGULAR = 0;
const VARIANT_CLEAR = 1;

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
  /** The corner radius each pooled window's glass was made with (Liquid Glass can't change it later). */
  private readonly radii = new WeakMap<BrowserWindow, number>();
  /** Liquid Glass windows still waiting for their glass view: showing them early flashes an empty frame. */
  private readonly unglazed = new WeakSet<BrowserWindow>();
  /** Windows the last sync wanted on screen, so a late glass view knows whether to show. */
  private readonly wanted = new WeakSet<BrowserWindow>();
  private fadeTimer: NodeJS.Timeout | null = null;
  private dark = false;
  /** The glass view id each Liquid Glass window holds, to switch its variant later. */
  private readonly glassIds = new WeakMap<BrowserWindow, number>();
  /** Settings → Transparency behind at Clear: the clear variant, with no frost of its own. */
  private clear = false;

  /** True when panels sit on real Liquid Glass (the page then drops its own fill). */
  get liquid(): boolean {
    return liquidGlass() !== null;
  }

  setDark(dark: boolean): void {
    if (this.dark === dark) return;
    this.dark = dark;
    if (this.liquid) return; // Liquid Glass follows the app's appearance by itself
    for (const w of this.pool) if (!w.isDestroyed()) w.setVibrancy(this.material());
  }

  /**
   * Clear (Transparency behind at 100%) uses Liquid Glass's clear variant; the
   * regular one adds its own frost, so the panel never looked fully see-through.
   */
  setClear(clear: boolean): void {
    if (this.clear === clear) return;
    this.clear = clear;
    for (const w of this.pool) if (!w.isDestroyed()) this.applyVariant(w);
  }

  private applyVariant(w: BrowserWindow): void {
    const id = this.glassIds.get(w);
    if (id === undefined || id < 0) return;
    try {
      liquidGlass()?.unstable_setVariant?.(id, this.clear ? VARIANT_CLEAR : VARIANT_REGULAR);
    } catch {
      // Private API: an older macOS or module without it keeps the regular glass.
    }
  }

  /** Put a blur behind each rect (window coordinates of the window at `origin`); hide the rest. */
  sync(rects: GlassRect[], origin: { x: number; y: number }): void {
    if (process.platform !== 'darwin') return;
    const liquid = this.liquid;
    const panels = rects
      .map((r) => ({ radius: Math.round(r.radius), bounds: liquid ? fullBounds(r, origin) : backdropBounds(r, origin) }))
      .filter((p): p is { radius: number; bounds: Rectangle } => !!p.bounds);
    const bounds = panels.map((p) => p.bounds);
    // A reopen mid-fade: the panels come back at full strength.
    const wasFading = this.stopFade();
    panels.forEach(({ radius, bounds: b }, i) => {
      let w: BrowserWindow | undefined = this.pool[i];
      // Liquid Glass keeps the corner radius it was made with: remake for a
      // clearly rounder or squarer panel. A pixel or two either way (a capsule
      // opening into a card, a radius mid-transition) keeps the window: a
      // remade one shows nothing until its glass loads, so remaking it every
      // frame of an animation left the panel bare and flickering.
      if (w && !w.isDestroyed() && liquid && Math.abs((this.radii.get(w) ?? radius) - radius) > RADIUS_SLACK) w.destroy();
      if (!w || w.isDestroyed()) w = this.pool[i] = this.create(radius);
      w.setBounds(b, false);
      this.wanted.add(w);
      if (!w.isVisible() && !this.unglazed.has(w)) reveal(w);
      else if (wasFading && w.isVisible()) w.setOpacity(1);
    });
    for (const w of this.pool.slice(bounds.length)) {
      if (w.isDestroyed()) continue;
      this.wanted.delete(w);
      conceal(w);
    }
  }

  /**
   * Fade the panels out with the island's page (its close fade), then hide
   * them. Hiding them at once left the page's text floating over the screen,
   * bare, for the length of that fade (Liquid glass draws no fill of its own).
   */
  fadeOut(ms: number): void {
    this.stopFade();
    const shown = this.pool.filter((w) => !w.isDestroyed() && w.isVisible());
    // A panel whose glass loads late must not show up mid-close.
    for (const w of this.pool) this.wanted.delete(w);
    if (!shown.length) return this.hide();
    const start = Date.now();
    this.fadeTimer = setInterval(() => {
      const t = Math.min(1, (Date.now() - start) / ms);
      // Ease in, like the page's fade (cubic-bezier(0.4, 0, 1, 1)).
      const opacity = 1 - t * t;
      for (const w of shown) if (!w.isDestroyed()) w.setOpacity(opacity);
      if (t >= 1) this.hide();
    }, 16);
  }

  /** Stop a running fade; true when one was running. */
  private stopFade(): boolean {
    if (!this.fadeTimer) return false;
    clearInterval(this.fadeTimer);
    this.fadeTimer = null;
    return true;
  }

  hide(): void {
    this.stopFade();
    for (const w of this.pool) {
      if (w.isDestroyed()) continue;
      this.wanted.delete(w);
      conceal(w);
    }
  }

  destroy(): void {
    this.stopFade();
    for (const w of this.pool) if (!w.isDestroyed()) w.destroy();
    this.pool.length = 0;
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
    makeNonActivating(w);
    if (liquid) {
      this.radii.set(w, radius);
      this.unglazed.add(w);
      w.webContents.once('did-finish-load', () => {
        if (w.isDestroyed()) return;
        this.glassIds.set(w, liquid.addView(w.getNativeWindowHandle(), { cornerRadius: radius }));
        this.applyVariant(w);
        this.unglazed.delete(w);
        if (this.wanted.has(w) && !w.isVisible()) reveal(w);
      });
    }
    void w.loadURL('about:blank');
    return w;
  }
}

function reveal(w: BrowserWindow): void {
  w.showInactive();
  w.setOpacity(1);
}

/**
 * Hide at once. macOS fades a panel out when it's ordered out, and a glass
 * window caught in that fade lost its rounded mask: a grey rectangle lingered
 * after the notification had gone. Dropping the opacity first makes the fade
 * invisible.
 */
function conceal(w: BrowserWindow): void {
  if (!w.isVisible()) return;
  w.setOpacity(0);
  w.hide();
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
