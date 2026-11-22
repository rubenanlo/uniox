import { describe, expect, it } from 'vitest';
import type { Account } from '@app/shared';
import { CloudSync, type CloudSyncDeps } from '../src/cloud-sync';

const jwt = `x.${Buffer.from(JSON.stringify({ sub: 'user-1' })).toString('base64url')}.y`;

function harness(remote: Record<string, unknown> | null) {
  const settings = new Map<string, unknown>([
    ['ui-prefs', { theme: 'dark', lightPalette: 'classic', darkPalette: 'ember', readingLayout: 'chat', accountColors: { a1: '#112233' } }],
  ]);
  const calls: { url: string; body: unknown; auth: string }[] = [];
  const applied: unknown[] = [];
  let row = remote;
  const fetchFake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body, auth: (init?.headers as Record<string, string>).Authorization });
    const ok = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
    if (url.endsWith('/functions/v1/desktop-link')) {
      if (body.mode === 'unlink') return ok({ removed: 1 });
      return ok({ email: 'me@example.com', tokenHash: 'hash', accounts: [{ email: 'me@example.com', ok: true }] });
    }
    if (url.endsWith('/auth/v1/verify')) return ok({ access_token: jwt, expires_in: 3600 });
    if (url.includes('/rest/v1/settings') && init?.method === 'POST') {
      row = body.data;
      return new Response(null, { status: 201 });
    }
    if (url.includes('/rest/v1/settings')) return ok(row ? [{ user_id: 'user-1', data: row }] : []);
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
  const deps: CloudSyncDeps = {
    env: {},
    accounts: async () =>
      [
        { id: 'a1', email: 'me@example.com', displayName: 'Me', authType: 'oauth-google' },
        { id: 'a2', email: 'imap@example.com', displayName: 'Imap', authType: 'password' },
      ] as unknown as Account[],
    credential: (id) =>
      id === 'a1'
        ? { type: 'oauth-google', clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt' }
        : { type: 'password', password: 'pw' },
    getSetting: async (k) => settings.get(k) ?? null,
    setSetting: async (k, v) => void settings.set(k, v),
    applyPrefs: (p) => {
      applied.push(p);
      return true;
    },
    fetch: fetchFake,
  };
  return { sync: new CloudSync(deps), settings, calls, applied, row: () => row, setRow: (r: Record<string, unknown>) => (row = r) };
}

describe('CloudSync', () => {
  it('hands over only Google accounts and never a password', async () => {
    const h = harness(null);
    const status = await h.sync.enable();
    expect(status).toMatchObject({ enabled: true, email: 'me@example.com' });
    const link = h.calls.find((c) => c.url.endsWith('desktop-link'))!;
    expect(link.body).toEqual({
      mode: 'link',
      accounts: [{ clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt', displayName: 'Me', color: '#112233' }],
    });
    expect(JSON.stringify(h.calls)).not.toContain('pw');
  });

  it('first sync pushes the desktop preferences, keeping other phone settings', async () => {
    const h = harness({ notifyMode: 'all', theme: 'light' });
    await h.sync.enable();
    expect(h.row()).toEqual({ notifyMode: 'all', theme: 'dark', palette: 'default', paletteDark: 'ember', threadLayout: 'chat' });
    expect(h.applied).toEqual([]);
    expect((h.settings.get('cloudSync') as { enabled: boolean }).enabled).toBe(true);
  });

  it('applies a later change made on the phone', async () => {
    const h = harness(null);
    await h.sync.enable();
    h.setRow({ ...h.row()!, threadLayout: 'cards' });
    await h.sync.syncPrefs();
    expect(h.applied).toEqual([{ readingLayout: 'classic' }]);
  });

  it('switching off asks the server to remove the handed-over accounts', async () => {
    const h = harness(null);
    await h.sync.enable();
    const status = await h.sync.disable();
    expect(status).toEqual({ enabled: false, error: undefined });
    const unlink = h.calls.find((c) => (c.body as { mode?: string } | null)?.mode === 'unlink')!;
    expect(unlink.auth).toBe(`Bearer ${jwt}`);
    expect((h.settings.get('cloudSync') as { enabled: boolean }).enabled).toBe(false);
  });

  it('reports a clear error when there is no Google account', async () => {
    const h = harness(null);
    const sync = new CloudSync({ ...(h.sync as unknown as { deps: CloudSyncDeps }).deps, accounts: async () => [] });
    expect((await sync.enable()).error).toMatch(/no Google account/);
  });
});
