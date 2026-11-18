import { app, BrowserWindow } from 'electron';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Diagnostics for "a notification brings me into Uniox": with
 * UNIOX_DEBUG_ACTIVATION=1 every activation change, window focus/show/hide
 * and overlay step is written, timestamped, to
 * ~/Library/Logs/Uniox/activation.log, and `kill -USR2 <main pid>` shows a
 * sample notification (so it can be fired while another app is in front).
 * Off (the default) it does nothing.
 */
export const DEBUG_ACTIVATION = process.env.UNIOX_DEBUG_ACTIVATION === '1';

let file = '';
const names = new WeakMap<BrowserWindow, string>();

export function trace(event: string, detail?: unknown): void {
  if (!DEBUG_ACTIVATION) return;
  const focused = BrowserWindow.getFocusedWindow();
  const line =
    `${new Date().toISOString()} ${event}` +
    (detail === undefined ? '' : ` ${JSON.stringify(detail)}`) +
    ` focused=${focused ? (names.get(focused) ?? `#${focused.id}`) : '-'}\n`;
  try {
    appendFileSync(file, line);
  } catch {
    // Diagnostics only.
  }
}

/** Label a window in the log and follow its focus, show and hide. */
export function traceWindow(win: BrowserWindow, name: string): void {
  if (!DEBUG_ACTIVATION) return;
  names.set(win, `${name}#${win.id}`);
  for (const e of ['focus', 'blur', 'show', 'hide', 'closed'] as const) {
    win.on(e as 'focus', () => trace(`win:${e}`, { win: `${name}#${win.id}` }));
  }
}

export function startActivationTrace(showSample: () => void): void {
  if (!DEBUG_ACTIVATION) return;
  const dir = join(app.getPath('logs'));
  mkdirSync(dir, { recursive: true });
  file = join(dir, 'activation.log');
  trace('trace:start', { pid: process.pid, file });
  app.on('did-become-active', () => trace('app:did-become-active'));
  app.on('did-resign-active', () => trace('app:did-resign-active'));
  app.on('activate', (_e, hasVisibleWindows) => trace('app:activate', { hasVisibleWindows }));
  app.on('browser-window-created', (_e, w) => trace('app:window-created', { id: w.id }));
  process.on('SIGUSR2', () => {
    trace('sample:fire');
    showSample();
  });
}
