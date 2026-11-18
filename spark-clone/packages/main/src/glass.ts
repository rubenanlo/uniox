import { BrowserWindow, type Rectangle } from 'electron';
import type { GlassRect } from '@app/shared';
import { backdropBounds } from './glass-geometry';

/**
 * The "Frosted" island's blur. CSS can't see other apps through a
 * transparent window, so the blur comes from macOS: one small vibrancy window
 * behind each glass panel, sized and moved to follow it. They sit one level
 * below the island's windows (still above every app), never take focus or
 * the mouse, and are hidden whenever there's nothing to blur.
 *
 * Cost: an empty window per panel (no page work), only while frosted panels
 * are on screen; destroyed together with the island.
 */
export class GlassBackdrops {
  private readonly pool: BrowserWindow[] = [];
  private dark = false;

  setDark(dark: boolean): void {
    if (this.dark === dark) return;
    this.dark = dark;
    for (const w of this.pool) if (!w.isDestroyed()) w.setVibrancy(this.material());
  }

  /** Put a blur behind each rect (window coordinates of the window at `origin`); hide the rest. */
  sync(rects: GlassRect[], origin: { x: number; y: number }): void {
    if (process.platform !== 'darwin') return;
    const bounds = rects.map((r) => backdropBounds(r, origin)).filter((b): b is Rectangle => !!b);
    bounds.forEach((b, i) => {
      const w = this.pool[i] && !this.pool[i].isDestroyed() ? this.pool[i] : (this.pool[i] = this.create());
      w.setBounds(b, false);
      if (!w.isVisible()) w.showInactive();
    });
    for (const w of this.pool.slice(bounds.length)) if (!w.isDestroyed() && w.isVisible()) w.hide();
  }

  hide(): void {
    for (const w of this.pool) if (!w.isDestroyed() && w.isVisible()) w.hide();
  }

  destroy(): void {
    for (const w of this.pool) if (!w.isDestroyed()) w.destroy();
    this.pool.length = 0;
  }

  /** HUD is always dark; popover is the light frosted material (Control Center's look). */
  private material(): 'hud' | 'popover' {
    return this.dark ? 'hud' : 'popover';
  }

  private create(): BrowserWindow {
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
      vibrancy: this.material(),
      visualEffectState: 'active',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
    });
    // Under the island (screen-saver level) but over every app window and the menu bar.
    w.setAlwaysOnTop(true, 'pop-up-menu');
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    w.setIgnoreMouseEvents(true);
    void w.loadURL('about:blank');
    return w;
  }
}
