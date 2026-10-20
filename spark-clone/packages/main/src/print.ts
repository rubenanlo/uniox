import { app, BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * ⌘P: lay the printable document out in a hidden window and hand it to the
 * system print dialog. A temp file instead of a data: URL because inline
 * images easily push a mail past Chromium's 2 MB URL limit. The page gets no
 * JavaScript, no navigation and no popups; the default session keeps app://
 * (inline attachments) resolving like it does in the reader.
 */
export async function printHtml(
  html: string,
  title: string,
): Promise<{ ok: boolean; error?: string }> {
  const file = join(app.getPath('temp'), `uniox-print-${randomUUID()}.html`);
  await writeFile(file, html, 'utf8');
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 1100,
    title,
    webPreferences: {
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  const cleanup = () => {
    if (!win.isDestroyed()) win.destroy();
    void rm(file, { force: true });
  };
  try {
    // Resolves on did-finish-load, i.e. after the load event — images included.
    await win.loadFile(file);
  } catch (err) {
    cleanup();
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const done = (success: boolean, reason: string) => {
    cleanup();
    // Cancelling the dialog is not an error worth surfacing.
    return success || reason === 'cancelled' ? { ok: true } : { ok: false, error: reason };
  };
  return new Promise((resolve) => {
    win.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
      // Electron 43.0–43.1 rejected any options with "Invalid printer
      // settings" (electron#52367); retry with the dialog's defaults.
      if (!success && /invalid printer settings/i.test(reason) && !win.isDestroyed()) {
        win.webContents.print({}, (ok, why) => resolve(done(ok, why)));
        return;
      }
      resolve(done(success, reason));
    });
  });
}
