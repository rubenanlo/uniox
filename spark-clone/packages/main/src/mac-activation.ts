import { app, BrowserWindow, Menu } from 'electron';
import { trace } from './debug-activation';

/**
 * Keeping Uniox's floating overlays (the ⌥⌘N island and the notification
 * toasts) from activating Uniox, so the app you're in keeps the keyboard and
 * Uniox's main window never jumps forward.
 *
 * Electron's `type: 'panel'` only *reports* NSWindowStyleMaskNonactivatingPanel
 * from an overridden getter; the flag never goes through -setStyleMask:, so
 * AppKit and the window server never see it and the panel behaves like an
 * ordinary window: clicking it, or making it key, activates Uniox. Any
 * Electron setter that rewrites the style mask passes the getter's value
 * (flag included) through -setStyleMask:, which is what applies it.
 * setMinimizable(false) changes nothing else on these frameless windows.
 */
export function makeNonActivating(win: BrowserWindow): void {
  if (process.platform !== 'darwin') return;
  win.setMinimizable(false);
}

/**
 * Whether Uniox is the active macOS app. Electron has no getter, so follow
 * the app events, starting from whether a window has focus.
 */
let appActive = false;
let tracking = false;
export function trackAppActive(): void {
  if (tracking || process.platform !== 'darwin') return;
  tracking = true;
  appActive = BrowserWindow.getFocusedWindow() !== null;
  app.on('did-become-active', () => (appActive = true));
  app.on('did-resign-active', () => (appActive = false));
}

export function isAppActive(): boolean {
  trackAppActive();
  return appActive;
}

/** Last time something asked for Uniox's own window (a click meant to open the app). */
let wantedAt = 0;
export function markUnioxWanted(): void {
  wantedAt = Date.now();
}
export function unioxWantedSince(t: number): boolean {
  return wantedAt >= t;
}

/** Longest wait for macOS to hand activation back after app.hide() before Uniox's windows come back. */
const UNHIDE_FALLBACK_MS = 300;

/**
 * Give activation back to the app that had it, the way ⌘H does, and bring
 * Uniox's windows straight back behind it without activating them.
 * `whileHidden` runs with every Uniox window hidden: order out a panel there,
 * so it can't hand the keyboard to Uniox's main window on its way out.
 */
export function giveActivationBack(whileHidden?: () => void): void {
  if (process.platform !== 'darwin') {
    whileHidden?.();
    return;
  }
  trace('giveActivationBack', { appActive: isAppActive() });
  let done = false;
  const unhide = () => {
    if (done) return;
    done = true;
    clearTimeout(fallback);
    app.off('did-resign-active', unhide);
    whileHidden?.();
    // NSApplication's unhideWithoutActivation: Uniox's windows (and its
    // toasts) show again while the other app keeps the keyboard.
    Menu.sendActionToFirstResponder('unhideWithoutActivation');
    whileHidden?.();
  };
  const fallback = setTimeout(unhide, UNHIDE_FALLBACK_MS);
  app.on('did-resign-active', unhide);
  app.hide();
  // Uniox wasn't active (or hiding already handed activation back): nothing to wait for.
  if (!isAppActive()) unhide();
}
