import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { shell } from 'electron';

/**
 * Google OAuth for a desktop app (report §3.2): Authorization Code + PKCE
 * with a loopback redirect. No secret can hide in a distributed Electron
 * app; Google's "Desktop app" client type expects its (non-confidential)
 * client_secret in the token exchange anyway. Scope `https://mail.google.com/`
 * is what IMAP/SMTP XOAUTH2 requires; openid+email identifies the account.
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_SCOPES =
  'https://mail.google.com/ https://www.googleapis.com/auth/calendar openid email profile';

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

/**
 * Built-in OAuth client baked into the build from `.env`
 * (MAIN_VITE_GOOGLE_CLIENT_ID / MAIN_VITE_GOOGLE_CLIENT_SECRET). Lets end
 * users sign in without creating their own Cloud project; absent vars fall
 * back to the paste-your-own-client onboarding.
 */
export function defaultGoogleClient(
  env: Record<string, string | undefined>,
): GoogleClient | null {
  const clientId = env['MAIN_VITE_GOOGLE_CLIENT_ID']?.trim();
  const clientSecret = env['MAIN_VITE_GOOGLE_CLIENT_SECRET']?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email: string;
}

export function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function makePkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function buildAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    code_challenge: opts.challenge,
    code_challenge_method: 'S256',
    state: opts.state,
    access_type: 'offline',
    // select_account forces the chooser so a second account isn't silently
    // authorized as whichever Google session the browser already has active;
    // consent guarantees a refresh_token on repeat authorizations.
    prompt: 'select_account consent',
  });
  return `${AUTH_URL}?${params}`;
}

/** Extract the email claim from an id_token without verification (display only). */
export function emailFromIdToken(idToken: string): string | null {
  try {
    const payload = idToken.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    return typeof json.email === 'string' ? json.email : null;
  } catch {
    return null;
  }
}

/** A stalled token endpoint must not leave the sign-in spinner hanging. */
const NETWORK_TIMEOUT_MS = 20_000;

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  });
  return (await res.json()) as TokenResponse;
}

/**
 * Interactive flow: loopback server on a random port, system browser for
 * consent, code → tokens. Rejects after 5 minutes if the user abandons it.
 */
export function authorizeGoogle(client: GoogleClient): Promise<GoogleTokens> {
  return new Promise((resolve, reject) => {
    const { verifier, challenge } = makePkcePair();
    const state = base64url(randomBytes(16));
    let settled = false;
    let redirectUri = '';

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.close();
      fn();
    };

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const respond = (message: string) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          `<html><body style="font-family:sans-serif;padding:40px;text-align:center">
             <h2>${message}</h2><p>You can close this tab and return to the app.</p>
           </body></html>`,
        );
      };
      // Check state first: a request without our state (any local process or
      // web page can hit the loopback port) must not cancel the real flow.
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400).end();
        return;
      }
      const err = url.searchParams.get('error');
      if (err) {
        respond('Sign-in was cancelled.');
        finish(() => reject(new Error(`Google sign-in: ${err}`)));
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        respond('Sign-in failed (no code).');
        finish(() => reject(new Error('no authorization code')));
        return;
      }
      respond('Connected ✔');
      finish(() => {
        void (async () => {
          try {
            const tok = await tokenRequest({
              client_id: client.clientId,
              client_secret: client.clientSecret,
              code,
              code_verifier: verifier,
              grant_type: 'authorization_code',
              redirect_uri: redirectUri,
            });
            if (!tok.access_token || !tok.refresh_token) {
              throw new Error(tok.error_description || tok.error || 'token exchange failed');
            }
            const email = tok.id_token ? emailFromIdToken(tok.id_token) : null;
            if (!email) throw new Error('Google did not return the account email');
            resolve({
              accessToken: tok.access_token,
              refreshToken: tok.refresh_token,
              expiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000,
              email,
            });
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        })();
      });
    });

    server.on('error', (e) => finish(() => reject(e)));
    const timeout = setTimeout(
      () => finish(() => reject(new Error('Google sign-in timed out'))),
      5 * 60_000,
    );

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        finish(() => reject(new Error('could not open loopback port')));
        return;
      }
      const redirectUriLocal = `http://127.0.0.1:${address.port}/callback`;
      redirectUri = redirectUriLocal;
      void shell.openExternal(
        buildAuthUrl({ clientId: client.clientId, redirectUri: redirectUriLocal, challenge, state }),
      );
    });
  });
}

/**
 * Revoke a Google grant so the app drops out of the account's
 * myaccount.google.com/permissions list. Best-effort: a failed or already-dead
 * token must not block account removal.
 */
export async function revokeGoogleToken(token: string): Promise<void> {
  try {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    });
  } catch {
    /* offline or already revoked — nothing to clean up */
  }
}

export async function refreshGoogleToken(
  client: GoogleClient,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: number }> {
  const tok = await tokenRequest({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  if (!tok.access_token) {
    throw new Error(tok.error_description || tok.error || 'token refresh failed');
  }
  return { accessToken: tok.access_token, expiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000 };
}
