import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGoogleSenderName } from '../src/google-profile';

const page = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('fetchGoogleSenderName', () => {
  it('prefers the default send-as display name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        page({
          sendAs: [
            { sendAsEmail: 'x@x.com', isDefault: false, displayName: 'Wrong' },
            { sendAsEmail: 'me@x.com', isDefault: true, displayName: 'Ruben Andino' },
          ],
        }),
      ),
    );
    expect(await fetchGoogleSenderName('tok')).toBe('Ruben Andino');
  });

  it('falls back to the OAuth profile name when send-as has none', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(page({ sendAs: [{ isDefault: true, displayName: '' }] }))
        .mockResolvedValueOnce(page({ name: 'Ruben Andino' })),
    );
    expect(await fetchGoogleSenderName('tok')).toBe('Ruben Andino');
  });

  it('returns null when neither source has a name (never throws)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(page({}, 403)).mockResolvedValueOnce(page({ sub: '1' })),
    );
    expect(await fetchGoogleSenderName('tok')).toBeNull();
  });
});
