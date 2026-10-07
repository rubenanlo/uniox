import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { shell } from 'electron';
import { base64url } from './google-auth';

/**
 * Notion OAuth for the Sprint-board integration: Authorization Code with a
 * loopback redirect, like google-auth. Two Notion-specific differences:
 * the redirect URI must be pre-registered exactly (so the port is fixed, not
 * random), and the token exchange authenticates with HTTP Basic instead of
 * body params. Notion access tokens do not expire — no refresh flow needed.
 * The grant screen is where the user picks which pages the app may read, so
 * connecting replaces the manual "share page with integration" step.
 */

const AUTH_URL = 'https://api.notion.com/v1/oauth/authorize';
const TOKEN_URL = 'https://api.notion.com/v1/oauth/token';

/** Must match a redirect URI registered on the integration, character for character. */
export const NOTION_CALLBACK_PORT = 21847;
export const NOTION_REDIRECT_URI = `http://localhost:${NOTION_CALLBACK_PORT}/callback`;

export interface NotionClient {
  clientId: string;
  clientSecret: string;
}

export interface NotionGrant {
  accessToken: string;
  workspaceName: string | null;
}

export function authorizeNotion(client: NotionClient): Promise<NotionGrant> {
  return new Promise((resolve, reject) => {
    const state = base64url(randomBytes(16));
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.close();
      fn();
    };

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${NOTION_CALLBACK_PORT}`);
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
      // Check state first so a stray local request can't cancel the flow.
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400).end();
        return;
      }
      const err = url.searchParams.get('error');
      if (err) {
        respond('Authorization was cancelled.');
        finish(() => reject(new Error(`Notion authorization: ${err}`)));
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        respond('Authorization failed (no code).');
        finish(() => reject(new Error('no authorization code')));
        return;
      }
      respond('Notion connected ✔');
      finish(() => {
        void (async () => {
          try {
            const basic = Buffer.from(`${client.clientId}:${client.clientSecret}`).toString(
              'base64',
            );
            const res2 = await fetch(TOKEN_URL, {
              method: 'POST',
              signal: AbortSignal.timeout(20_000),
              headers: {
                Authorization: `Basic ${basic}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                grant_type: 'authorization_code',
                code,
                redirect_uri: NOTION_REDIRECT_URI,
              }),
            });
            const tok = (await res2.json()) as {
              access_token?: string;
              workspace_name?: string;
              error?: string;
            };
            if (!tok.access_token) throw new Error(tok.error || 'token exchange failed');
            resolve({ accessToken: tok.access_token, workspaceName: tok.workspace_name ?? null });
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        })();
      });
    });

    const timeout = setTimeout(
      () => finish(() => reject(new Error('Notion authorization timed out'))),
      5 * 60_000,
    );

    server.on('error', (e) =>
      finish(() =>
        reject(
          new Error(
            `could not open localhost:${NOTION_CALLBACK_PORT} (${e.message}) — is another connect attempt running?`,
          ),
        ),
      ),
    );

    server.listen(NOTION_CALLBACK_PORT, '127.0.0.1', () => {
      const params = new URLSearchParams({
        client_id: client.clientId,
        response_type: 'code',
        owner: 'user',
        redirect_uri: NOTION_REDIRECT_URI,
        state,
      });
      void shell.openExternal(`${AUTH_URL}?${params}`);
    });
  });
}
