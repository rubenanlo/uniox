import {
  CLOUD_PREF_KEYS,
  DARK_PALETTES,
  LIGHT_PALETTES,
  mergeCloudPrefs,
  toCloudPrefs,
  toDesktopPrefs,
  type Account,
  type CloudSharedPrefs,
  type CloudSyncStatus,
  type DesktopSharedPrefs,
} from '@app/shared';
import type { CredentialRecord } from './credentials';

/**
 * "Sync with phone" (Settings → Accounts). Off until switched on.
 *
 * When on, the desktop hands its Google accounts to the Uniox cloud backend
 * (the Supabase project behind the phone app) so they appear on the phone
 * without signing in again, and keeps the shared view preferences (theme,
 * color themes, reading layout) the same on both.
 *
 * The hand-over sends each account's refresh token plus the OAuth client it
 * was issued to, once, over HTTPS, to the `desktop-link` function. The server
 * proves each one against Google, stores it server-only and never returns it.
 * Its answer signs this desktop in as the Uniox cloud user, which is what lets
 * it read and write that user's settings row. Nothing is stored here beyond
 * the on/off state: the session lives in memory and is renewed by linking again.
 */

/** Public values: the same pair ships inside the phone web app. */
const DEFAULT_URL = 'https://ffijcbzozucfyvtakacd.supabase.co';
const DEFAULT_KEY = 'sb_publishable_pIMYF-U41806L0a6I3xcPg_LtRUBf3q';

export const CLOUD_SYNC_KEY = 'cloudSync';
const UI_PREFS_KEY = 'ui-prefs';
const PREFS_EVERY_MS = 5 * 60_000;
const PREFS_DEBOUNCE_MS = 2_000;

interface Stored {
  enabled: boolean;
  email?: string;
  /** Shared preferences both sides agreed on at the last sync. */
  base?: Partial<CloudSharedPrefs>;
}

interface Session {
  accessToken: string;
  expiresAt: number;
}

export interface CloudSyncDeps {
  env: Record<string, string | undefined>;
  accounts(): Promise<Account[]>;
  credential(accountId: string): CredentialRecord | null;
  getSetting(key: string): Promise<unknown>;
  setSetting(key: string, value: unknown): Promise<void>;
  /** Hand preferences changed on the phone to the open window; false if none is listening. */
  applyPrefs(prefs: Partial<DesktopSharedPrefs>): boolean;
  fetch?: typeof fetch;
}

export class CloudSync {
  private readonly url: string;
  private readonly key: string;
  private readonly fetch: typeof fetch;
  private session: Session | null = null;
  private linking: Promise<Session> | null = null;
  private status: CloudSyncStatus = { enabled: false };
  private timer: ReturnType<typeof setInterval> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private syncing = false;

  constructor(private readonly deps: CloudSyncDeps) {
    this.url = (deps.env['MAIN_VITE_UNIOX_CLOUD_URL']?.trim() || DEFAULT_URL).replace(/\/+$/, '');
    this.key = deps.env['MAIN_VITE_UNIOX_CLOUD_KEY']?.trim() || DEFAULT_KEY;
    this.fetch = deps.fetch ?? fetch;
  }

  private async stored(): Promise<Stored> {
    const v = (await this.deps.getSetting(CLOUD_SYNC_KEY).catch(() => null)) as Stored | null;
    return v && typeof v === 'object' ? v : { enabled: false };
  }

  private async save(patch: Partial<Stored>): Promise<Stored> {
    const next = { ...(await this.stored()), ...patch };
    await this.deps.setSetting(CLOUD_SYNC_KEY, next);
    return next;
  }

  /** Called once at launch: resume syncing if it was left on. */
  async start(): Promise<void> {
    const s = await this.stored();
    this.status = { enabled: s.enabled, email: s.email };
    if (!s.enabled) return;
    this.schedule();
    void this.refresh();
  }

  getStatus(): CloudSyncStatus {
    return this.status;
  }

  async enable(): Promise<CloudSyncStatus> {
    try {
      this.session = null;
      await this.link();
      await this.save({ enabled: true, email: this.status.email });
      this.status = { ...this.status, enabled: true, error: undefined };
      this.schedule();
      await this.syncPrefs();
    } catch (err) {
      this.status = { ...this.status, enabled: false, error: message(err) };
    }
    return this.status;
  }

  /** Switch off and take the handed-over accounts back off the server. */
  async disable(): Promise<CloudSyncStatus> {
    let error: string | undefined;
    try {
      const session = await this.ensureSession();
      const res = await this.fetch(`${this.url}/functions/v1/desktop-link`, {
        method: 'POST',
        headers: this.headers(session.accessToken),
        body: JSON.stringify({ mode: 'unlink' }),
      });
      if (!res.ok) error = `The cloud copy could not be removed (HTTP ${res.status}). Switch on and off again to retry.`;
    } catch (err) {
      error = `The cloud copy could not be removed: ${message(err)}`;
    }
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.session = null;
    await this.save({ enabled: false, base: undefined });
    this.status = { enabled: false, error };
    return this.status;
  }

  /** Accounts were added or removed here: hand the current set over again. */
  accountsChanged(): void {
    if (!this.status.enabled) return;
    this.session = null;
    void this.refresh();
  }

  /** The desktop's view preferences were saved: push what changed, soon. */
  prefsChanged(): void {
    if (!this.status.enabled) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.syncPrefs().catch(() => {}), PREFS_DEBOUNCE_MS);
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.syncPrefs().catch(() => {}), PREFS_EVERY_MS);
  }

  private async refresh(): Promise<void> {
    try {
      await this.ensureSession();
      await this.syncPrefs();
      this.status = { ...this.status, error: undefined };
    } catch (err) {
      this.status = { ...this.status, error: message(err) };
    }
  }

  private headers(token?: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      apikey: this.key,
      Authorization: `Bearer ${token ?? this.key}`,
    };
  }

  private ensureSession(): Promise<Session> {
    if (this.session && this.session.expiresAt > Date.now() + 60_000) return Promise.resolve(this.session);
    this.linking ??= this.link().finally(() => {
      this.linking = null;
    });
    return this.linking;
  }

  /** Hand the Google accounts over and sign in as the cloud user they belong to. */
  private async link(): Promise<Session> {
    const accounts = await this.deps.accounts();
    const ui = ((await this.deps.getSetting(UI_PREFS_KEY).catch(() => null)) ?? {}) as {
      accountColors?: Record<string, string>;
      accountLabels?: Record<string, string>;
    };
    const grants = accounts.flatMap((a) => {
      const rec = this.deps.credential(a.id);
      if (a.authType !== 'oauth-google' || rec?.type !== 'oauth-google') return [];
      return [
        {
          clientId: rec.clientId,
          clientSecret: rec.clientSecret,
          refreshToken: rec.refreshToken,
          displayName: ui.accountLabels?.[a.id] || a.displayName || undefined,
          color: ui.accountColors?.[a.id],
        },
      ];
    });
    if (!grants.length) throw new Error('There is no Google account to share yet. Add one first.');

    const res = await this.fetch(`${this.url}/functions/v1/desktop-link`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ mode: 'link', accounts: grants }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      email?: string;
      tokenHash?: string;
      accounts?: CloudSyncStatus['accounts'];
      error?: string;
    };
    if (!res.ok || !body.tokenHash) throw new Error(body.error ?? `Uniox cloud answered HTTP ${res.status}`);

    const verify = await this.fetch(`${this.url}/auth/v1/verify`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ type: 'magiclink', token_hash: body.tokenHash }),
    });
    const tok = (await verify.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!verify.ok || !tok.access_token) throw new Error(`Uniox cloud sign-in failed (HTTP ${verify.status})`);

    this.session = { accessToken: tok.access_token, expiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000 };
    this.status = { ...this.status, email: body.email, accounts: body.accounts, lastSyncAt: Date.now() };
    return this.session;
  }

  /** Two-way sync of the shared view preferences. */
  async syncPrefs(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const session = await this.ensureSession();
      const stored = await this.stored();
      const ui = ((await this.deps.getSetting(UI_PREFS_KEY).catch(() => null)) ?? {}) as Partial<DesktopSharedPrefs>;
      const local = toCloudPrefs(ui);

      const res = await this.fetch(`${this.url}/rest/v1/settings?select=user_id,data`, {
        headers: this.headers(session.accessToken),
      });
      if (!res.ok) throw new Error(`Reading shared settings failed (HTTP ${res.status})`);
      const rows = (await res.json()) as { user_id: string; data: Record<string, unknown> }[];
      const data = rows[0]?.data ?? {};
      const remote: Partial<CloudSharedPrefs> = {};
      for (const k of CLOUD_PREF_KEYS) if (data[k] !== undefined) (remote as Record<string, unknown>)[k] = data[k];

      const { merged, push, apply } = mergeCloudPrefs(local, remote, stored.base ?? null);

      if (Object.keys(push).length) {
        const userId = rows[0]?.user_id ?? userIdOf(session.accessToken);
        const up = await this.fetch(`${this.url}/rest/v1/settings?on_conflict=user_id`, {
          method: 'POST',
          headers: { ...this.headers(session.accessToken), Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ user_id: userId, data: { ...data, ...push }, updated_at: new Date().toISOString() }),
        });
        if (!up.ok) throw new Error(`Saving shared settings failed (HTTP ${up.status})`);
      }

      if (Object.keys(apply).length) {
        const patch = toDesktopPrefs(apply, { light: LIGHT_PALETTES, dark: DARK_PALETTES });
        if (Object.keys(patch).length && !this.deps.applyPrefs(patch)) {
          // No window to apply it: write the stored blob so the next launch has it.
          const current = ((await this.deps.getSetting(UI_PREFS_KEY).catch(() => null)) ?? {}) as object;
          await this.deps.setSetting(UI_PREFS_KEY, { ...current, ...patch });
        }
      }

      await this.save({ base: merged });
      this.status = { ...this.status, lastSyncAt: Date.now(), error: undefined };
    } finally {
      this.syncing = false;
    }
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The `sub` claim of a Supabase access token (our own session; not a trust decision). */
function userIdOf(jwt: string): string {
  const part = jwt.split('.')[1] ?? '';
  return (JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { sub: string }).sub;
}
