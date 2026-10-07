import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  Notification,
  powerMonitor,
  protocol,
  shell,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from 'electron';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { basename, join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_NOTIFY_SOUND,
  GMAIL_ENDPOINTS,
  KANBAN_STATUSES,
  NOTIFY_SOUNDS,
  type Account,
  type AccountConfig,
  type AiMessage,
  type DeltaEvent,
  type NotifySound,
  type Task,
} from '@app/shared';
import { AiService } from './ai';
import { CredentialStore } from './credentials';
import { DeltaCoalescer } from './delta-coalescer';
import { authorizeGoogle, defaultGoogleClient, revokeGoogleToken } from './google-auth';

// Ships with the build when .env provides MAIN_VITE_GOOGLE_CLIENT_ID/_SECRET;
// null keeps the paste-your-own-client onboarding.
const builtInGoogleClient = defaultGoogleClient({
  MAIN_VITE_GOOGLE_CLIENT_ID: import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID,
  MAIN_VITE_GOOGLE_CLIENT_SECRET: import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET,
});
import { fetchBoard, fetchPageBlocks, setPageStatus, validateToken } from './notion';
import { authorizeNotion } from './notion-auth';
import { SyncBridge } from './sync-bridge';

// Only an unpackaged build may load a dev-server URL: a packaged app must never
// trust ELECTRON_RENDERER_URL from the environment (it would grant a remote page
// the preload API and pass validSender).
const isDev = !app.isPackaged && !!process.env['ELECTRON_RENDERER_URL'];

// safeStorage derives its OS-keychain encryption key from the app name, so a
// rebrand (the package.json `name` / productName) silently orphans every
// previously-encrypted credential — the app can no longer decrypt its own
// credentials.json and all accounts fail to connect ("no sync engine"). Pin a
// stable internal identity, decoupled from branding, so the keychain key never
// moves. Must run before app ready and before any safeStorage use. It also
// keeps the dev profile path stable (…/Application Support/spark-clone).
app.setName('spark-clone');

// e2e harness isolation
if (process.env['SPARKCLONE_USER_DATA']) {
  app.setPath('userData', process.env['SPARKCLONE_USER_DATA']);
} else if (app.isPackaged) {
  // Packaged app must not reuse the dev profile (…/Application Support/spark-clone).
  app.setPath('userData', join(app.getPath('appData'), 'com.sparkclone.mail'));
}

// One instance per profile: a second one would fork its own sync process on the
// same mail.db / credentials.json (SQLITE_BUSY, duplicate sends, lost writes).
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

ipcMain.on('app-meta', (event) => {
  event.returnValue = { isPackaged: app.isPackaged };
});

// app:// must be registered before app ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, stream: true } },
]);

let mainWindow: BrowserWindow | null = null;
let bridge: SyncBridge | null = null;
let credentials: CredentialStore | null = null;
let ai: AiService | null = null;
let attachmentsRoot = '';

/** Join `rel` under `root`, or null if it escapes it (incl. sibling dirs like `attachments-old`). */
function containedPath(root: string, rel: string): string | null {
  const base = normalize(root);
  const full = normalize(join(base, rel));
  return full.startsWith(base.endsWith(sep) ? base : base + sep) ? full : null;
}

/** Attachment paths from the renderer are relative; keep them under the root. */
function resolveAttachmentPath(localPath: string): string | null {
  if (!attachmentsRoot || typeof localPath !== 'string') return null;
  const full = containedPath(attachmentsRoot, localPath);
  return full && existsSync(full) ? full : null;
}

/** Strip path parts and characters Windows/macOS refuse in a filename. */
function safeSaveName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return basename(String(name ?? '')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'attachment';
}

/** File types that "open" by executing; never hand these to the OS opener from a preview click. */
const EXECUTABLE_EXT =
  /\.(exe|bat|cmd|com|scr|msi|msp|ps1|vbs|vbe|js|jse|wsf|wsh|hta|cpl|lnk|reg|jar|desktop|sh|run|appimage|app|command)$/i;

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function openExternalGated(rawUrl: string): void {
  try {
    const url = new URL(rawUrl);
    if (EXTERNAL_PROTOCOLS.has(url.protocol)) void shell.openExternal(url.toString());
  } catch {
    /* invalid URL: drop */
  }
}

/** Reject IPC from anything that is not our own renderer frame. */
function validSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  if (isDev) return url.startsWith(process.env['ELECTRON_RENDERER_URL']!);
  return url.startsWith('app://') || url.startsWith('file://');
}

/**
 * Like the default menu, but without Edit ▸ Undo/Redo: their ⌘Z / ⇧⌘Z
 * accelerators are consumed at the menu level and never reach the renderer,
 * which needs them for triage undo (and the composer's own editor history).
 * Text fields keep native undo — Chromium handles ⌘Z itself once the key
 * event is delivered to the page.
 */
function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' } as const] : []),
    { role: 'fileMenu' },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => mainWindow?.webContents.send('triage:undo'),
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** App icon: build/icon.png in dev, bundled icon in packaged builds. */
function resolveIconPath(): string | undefined {
  const candidates = [
    join(app.getAppPath(), 'build/icon.png'),
    join(process.resourcesPath, 'icon.png'),
  ];
  return candidates.find((p) => existsSync(p));
}

function applyAppIcon(): void {
  const path = resolveIconPath();
  if (!path) return;
  const image = nativeImage.createFromPath(path);
  if (image.isEmpty()) return;
  if (process.platform === 'darwin') app.dock?.setIcon(image);
}

function createWindow(): void {
  const icon = resolveIconPath();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 720,
    minHeight: 480,
    title: 'Uniox',
    ...(icon ? { icon } : {}),
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
    // center the traffic lights in the 44px title bar (TopBar h-11)
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalGated(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL() ?? '';
    if (url !== current) {
      event.preventDefault();
      openExternalGated(url);
    }
  });

  if (isDev) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']!);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** The user's chosen new-mail sound (Settings → Notifications). Cached so a
 *  burst of notifications doesn't do a settings round-trip each; invalidated
 *  when the setting is written. */
let notifySoundCache: NotifySound | null = null;
async function notifySound(): Promise<NotifySound> {
  if (notifySoundCache) return notifySoundCache;
  try {
    const v = (await bridge?.query('settings:get', { key: 'notificationSound' })) as string | null;
    if (v === 'None' || (NOTIFY_SOUNDS as readonly string[]).includes(v ?? '')) {
      notifySoundCache = v as NotifySound;
      return notifySoundCache;
    }
  } catch {
    /* fall through to default */
  }
  return DEFAULT_NOTIFY_SOUND;
}

/**
 * macOS refuses UNUserNotificationCenter registration for unsigned builds
 * (UNErrorDomain 1) — the dev Electron binary and unsigned local packages
 * never even appear in System Settings → Notifications. Fall back to an
 * osascript banner so new-mail alerts still show; it can't click-through
 * to the thread, but the sync → notify path stays testable in development.
 */
function osascriptNotify(title: string, body: string, sound: NotifySound): void {
  if (process.platform !== 'darwin') return;
  const esc = (s: string) => s.replace(/[\\"]/g, '\\$&').replace(/\r?\n/g, ' ');
  // Unlike the native path, `display notification` is silent unless a sound
  // name is given explicitly.
  const chime = sound === 'None' ? '' : ` sound name "${sound}"`;
  execFile('osascript', [
    '-e',
    `display notification "${esc(body)}" with title "${esc(title)}"${chime}`,
  ]);
}

/** Hold shown notifications so they aren't garbage-collected before a click lands. */
const liveNotifications = new Set<Notification>();

const deltaCoalescer = new DeltaCoalescer((e) => mainWindow?.webContents.send('delta', e));

function broadcastDelta(event: DeltaEvent): void {
  deltaCoalescer.push(event);
  // Mail notifications stay quiet while the app is focused (you're looking at
  // the inbox); meeting alerts always show — being in the app is exactly when
  // you need the 10-minute nudge.
  const wantsBanner = event.kind === 'notify' && (event.category === 'event' || !mainWindow?.isFocused());
  if (event.kind === 'notify' && Notification.isSupported() && wantsBanner) {
    void (async () => {
      const sound = await notifySound();
      const n = new Notification({
        title: event.title,
        body: event.body,
        silent: sound === 'None',
        ...(sound !== 'None' ? { sound } : {}),
      });
      const threadId = event.threadId;
      const isEventAlert = event.category === 'event';
      liveNotifications.add(n);
      n.on('close', () => liveNotifications.delete(n));
      n.on('click', () => {
        liveNotifications.delete(n);
        mainWindow?.show();
        mainWindow?.focus();
        // Land on the email the notification was about, like any mail app;
        // meeting alerts land on the calendar instead.
        if (threadId) mainWindow?.webContents.send('delta', { kind: 'open-thread', threadId });
        else if (isEventAlert) mainWindow?.webContents.send('delta', { kind: 'open-calendar' });
      });
      n.on('failed', () => {
        liveNotifications.delete(n);
        osascriptNotify(event.title, event.body, sound);
      });
      n.show();
    })();
  }
}

function registerAppProtocol(attachmentsDir: string): void {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'attachments') return new Response('not found', { status: 404 });
    const rel = decodeURI(url.pathname).replace(/^\//, '');
    const full = containedPath(attachmentsDir, rel);
    if (!full) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(full).toString());
  });
}

function registerIpc(): void {
  ipcMain.handle('query', (event, channel: string, args: unknown) => {
    if (!validSender(event)) throw new Error('invalid sender');
    if (typeof channel !== 'string' || channel.includes('account:')) throw new Error('bad channel');
    // notion:* lives in the main process (network + credential store), not sync.
    if (channel === 'notion:status') {
      return {
        configured: !!credentials!.getNotionToken(),
        hasClient: !!credentials!.getNotionClient(),
      };
    }
    if (channel === 'notion:board') {
      const token = credentials!.getNotionToken();
      return token ? fetchBoard(token) : null;
    }
    if (channel === 'notion:page') {
      const token = credentials!.getNotionToken();
      const { pageId } = args as { pageId: string };
      return token && /^[0-9a-f-]{32,36}$/i.test(pageId) ? fetchPageBlocks(token, pageId) : [];
    }
    if (channel === 'ai:status') {
      return ai!.status();
    }
    return bridge!.query(channel, args);
  });

  ipcMain.handle('command', async (event, channel: string, args: unknown) => {
    if (!validSender(event)) throw new Error('invalid sender');
    if (channel === 'settings:set' && (args as { key?: string } | null)?.key === 'notificationSound') {
      notifySoundCache = null;
    }
    switch (channel) {
      case 'ai:config':
        return ai!.config(args as { key?: string; model?: string });
      case 'ai:chat': {
        const params = args as { id: string; messages: AiMessage[]; system?: string };
        // Tokens stream back out-of-band on the `ai:chunk` push channel. If the
        // window goes away mid-turn, abort instead of streaming (and billing)
        // into the void.
        event.sender.once('destroyed', () => ai?.stop(params.id));
        return ai!.chat(params, (chunk) => {
          if (!event.sender.isDestroyed()) event.sender.send('ai:chunk', chunk);
        });
      }
      case 'ai:stop':
        return ai!.stop((args as { id: string }).id);
      case 'task:enqueue':
        return bridge!.enqueueTask(args as Task);
      case 'account:test':
        return bridge!.query('account:test', args);
      case 'account:add': {
        const { config, password } = args as { config: AccountConfig; password: string };
        const result = (await bridge!.query('account:add', { config, password })) as
          | { ok: true; accountId: string }
          | { ok: false; error: string };
        if (result.ok) credentials!.set(result.accountId, password);
        return result;
      }
      case 'account:google-status': {
        // Built-in wins over a saved client, so report builtIn whenever it exists.
        const saved = !!credentials!.getGoogleClient();
        return { hasClient: saved || !!builtInGoogleClient, builtIn: !!builtInGoogleClient };
      }
      case 'account:reconnect-google': {
        // Re-consent for an existing account: refreshes the granted scopes
        // (mail + calendar) and, for app-password Gmail accounts, upgrades the
        // auth scheme to OAuth without touching any synced data.
        const { accountId } = args as { accountId: string };
        const accounts = (await bridge!.query('accounts:list', undefined)) as Account[];
        const account = accounts.find((a) => a.id === accountId);
        if (!account) return { ok: false, error: 'Account not found.' };
        const record = credentials!.getRecord(accountId);
        const client =
          record?.type === 'oauth-google'
            ? { clientId: record.clientId, clientSecret: record.clientSecret }
            : (builtInGoogleClient ?? credentials!.getGoogleClient());
        if (!client) {
          return { ok: false, error: 'No Google OAuth client available — add one in onboarding first.' };
        }
        try {
          const tokens = await authorizeGoogle(client);
          if (tokens.email.toLowerCase() !== account.email.toLowerCase()) {
            return {
              ok: false,
              error: `You signed in as ${tokens.email} — sign in as ${account.email} instead.`,
            };
          }
          credentials!.setRecord(accountId, {
            type: 'oauth-google',
            clientId: client.clientId,
            clientSecret: client.clientSecret,
            refreshToken: tokens.refreshToken,
          });
          bridge!.primeToken(accountId, tokens.accessToken, tokens.expiresAt);
          if (account.authType !== 'oauth-google') {
            await bridge!.query('account:set-auth-type', { accountId, authType: 'oauth-google' });
          }
          // Scope verification: a calendarList that answers proves the grant took.
          const check = await fetch(
            'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250&fields=items(id)',
            { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
          );
          if (!check.ok) {
            return {
              ok: true,
              calendars: 0,
              warning: `Reconnected, but the calendar check failed (HTTP ${check.status}) — is the Google Calendar API enabled for this OAuth client's project?`,
            };
          }
          const list = (await check.json()) as { items?: unknown[] };
          return { ok: true, calendars: list.items?.length ?? 0 };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      case 'account:remove': {
        // Full disconnect: revoke the Google grant (best-effort), forget the
        // stored credential, then have the sync process stop the loop and drop
        // the account plus its cached mail/calendar.
        const { accountId } = args as { accountId: string };
        const record = credentials!.getRecord(accountId);
        if (record?.type === 'oauth-google') {
          await revokeGoogleToken(record.refreshToken);
        }
        credentials!.deleteRecord(accountId);
        bridge!.forgetToken(accountId);
        const result = (await bridge!.query('account:remove', { accountId })) as {
          ok: boolean;
          error?: string;
        };
        return result;
      }
      case 'account:add-google': {
        const supplied = args as { clientId?: string; clientSecret?: string };
        const pasted =
          supplied.clientId && supplied.clientSecret
            ? { clientId: supplied.clientId.trim(), clientSecret: supplied.clientSecret.trim() }
            : null;
        // Built-in (.env) client is the default; a saved global client is only
        // a fallback for builds shipped without one. This keeps a stale legacy
        // client (from the old paste-your-own onboarding) from shadowing it.
        const client = pasted ?? builtInGoogleClient ?? credentials!.getGoogleClient();
        if (!client) return { ok: false, error: 'Paste your Google OAuth client ID and secret first.' };
        try {
          const tokens = await authorizeGoogle(client);
          const config: AccountConfig = {
            email: tokens.email,
            displayName: tokens.email.split('@')[0],
            imap: { ...GMAIL_ENDPOINTS.imap },
            smtp: { ...GMAIL_ENDPOINTS.smtp },
            authType: 'oauth-google',
          };
          const result = (await bridge!.query('account:add', {
            config,
            password: tokens.accessToken,
          })) as { ok: true; accountId: string } | { ok: false; error: string };
          if (!result.ok) return result;
          credentials!.setRecord(result.accountId, {
            type: 'oauth-google',
            clientId: client.clientId,
            clientSecret: client.clientSecret,
            refreshToken: tokens.refreshToken,
          });
          // Persist only user-pasted clients: the saved slot means "custom
          // override" — freezing the built-in client into it would shadow a
          // future build's updated client.
          if (pasted) credentials!.setGoogleClient(client.clientId, client.clientSecret);
          bridge!.primeToken(result.accountId, tokens.accessToken, tokens.expiresAt);
          return { ok: true, accountId: result.accountId, email: tokens.email };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      case 'notify-sound:preview': {
        const { sound } = args as { sound: string };
        if (process.platform === 'darwin' && (NOTIFY_SOUNDS as readonly string[]).includes(sound)) {
          execFile('afplay', [`/System/Library/Sounds/${sound}.aiff`]);
        }
        return { ok: true };
      }
      case 'notion:set-status': {
        const { pageId, status } = args as { pageId: string; status: string };
        const token = credentials!.getNotionToken();
        if (!token) return { ok: false, error: 'Notion is not connected' };
        if (!/^[0-9a-f-]{32,36}$/i.test(pageId) || !(KANBAN_STATUSES as readonly string[]).includes(status)) {
          return { ok: false, error: 'invalid task or status' };
        }
        try {
          await setPageStatus(token, pageId, status);
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      case 'notion:connect': {
        const supplied = args as { clientId?: string; clientSecret?: string };
        const client =
          supplied.clientId && supplied.clientSecret
            ? { clientId: supplied.clientId.trim(), clientSecret: supplied.clientSecret.trim() }
            : credentials!.getNotionClient();
        if (!client) {
          return { ok: false, error: 'Paste your Notion OAuth client ID and secret first.' };
        }
        try {
          const grant = await authorizeNotion(client);
          // The grant screen decides page access; make sure the Sprint board made it in.
          const check = await validateToken(grant.accessToken);
          if (!check.ok) {
            console.error('[notion] board validation failed:', check.error);
            return {
              ok: false,
              error: `Authorized, but the app can't read the Sprint board (${check.error ?? 'unknown'}) — reconnect and tick the WebDev Hub / Sprint board pages in the grant screen.`,
            };
          }
          credentials!.setNotionToken(grant.accessToken);
          credentials!.setNotionClient(client.clientId, client.clientSecret);
          return { ok: true, workspace: grant.workspaceName ?? undefined };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      case 'notion:set-token': {
        const { token } = args as { token: string };
        const trimmed = token.trim();
        if (!trimmed) return { ok: false, error: 'Paste an integration token first.' };
        const check = await validateToken(trimmed);
        if (check.ok) credentials!.setNotionToken(trimmed);
        return check;
      }
      case 'attachment:preview': {
        const { localPath } = args as { localPath: string };
        const full = resolveAttachmentPath(localPath);
        if (!full) return { ok: false };
        const win = BrowserWindow.fromWebContents(event.sender);
        if (process.platform === 'darwin' && win) win.previewFile(full);
        // Off macOS there is no Quick Look: openPath would *run* a mailed .exe/.bat/.js.
        else if (EXECUTABLE_EXT.test(full)) shell.showItemInFolder(full);
        else await shell.openPath(full);
        return { ok: true };
      }
      case 'attachment:save': {
        const { localPath, filename } = args as { localPath: string; filename: string };
        const full = resolveAttachmentPath(localPath);
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!full || !win) return { ok: false };
        const res = await dialog.showSaveDialog(win, {
          defaultPath: join(app.getPath('downloads'), safeSaveName(filename)),
        });
        if (res.canceled || !res.filePath) return { ok: false };
        await copyFile(full, res.filePath);
        return { ok: true, path: res.filePath };
      }
      case 'attachment:save-all': {
        const { files } = args as { files: { localPath: string; filename: string }[] };
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win || !files.length) return { ok: false };
        const res = await dialog.showOpenDialog(win, {
          defaultPath: app.getPath('downloads'),
          properties: ['openDirectory', 'createDirectory'],
        });
        const dir = res.filePaths[0];
        if (res.canceled || !dir) return { ok: false };
        let saved = 0;
        let failed = 0;
        for (const f of files) {
          const full = resolveAttachmentPath(f.localPath);
          if (!full) continue;
          // "report.pdf" → "report (1).pdf" until the name is free in the folder.
          const name = safeSaveName(f.filename);
          const dot = name.lastIndexOf('.');
          const stem = dot > 0 ? name.slice(0, dot) : name;
          const ext = dot > 0 ? name.slice(dot) : '';
          let dest = join(dir, name);
          for (let n = 1; existsSync(dest); n++) dest = join(dir, `${stem} (${n})${ext}`);
          try {
            await copyFile(full, dest);
            saved++;
          } catch {
            failed++; // keep going: one bad file shouldn't drop the rest
          }
        }
        return { ok: saved > 0, path: dir, saved, failed };
      }
      case 'settings:set':
      case 'templates:save':
      case 'templates:delete':
      case 'signatures:save':
      case 'calendar:event:save':
      case 'calendar:event:patch':
      case 'calendar:setVisible':
      case 'calendar:event:delete':
      case 'calendar:subscribe':
      case 'calendar:unsubscribe':
        return bridge!.query(channel, args);
      default:
        throw new Error(`unknown command: ${channel}`);
    }
  });
}

void app.whenReady().then(() => {
  if (!isPrimaryInstance) return;
  const userData = app.getPath('userData');
  const attachmentsDir = join(userData, 'attachments');
  attachmentsRoot = attachmentsDir;

  credentials = new CredentialStore(userData);
  ai = new AiService(credentials);
  registerAppProtocol(attachmentsDir);

  bridge = new SyncBridge({
    dbPath: join(userData, 'mail.db'),
    attachmentsDir,
    credentials,
    onDelta: broadcastDelta,
  });
  bridge.start();

  // Sleep/wake: the sync utility process isn't subject to renderer
  // background throttling, so tell it to park its timers while suspended.
  powerMonitor.on('suspend', () => bridge?.power('suspend'));
  powerMonitor.on('resume', () => bridge?.power('resume'));

  registerIpc();
  buildMenu();
  applyAppIcon();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Spark parks in the tray/dock; for the MVP the sync process keeps running
  // on macOS (dock) and quits elsewhere.
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  bridge?.stop();
});

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});
