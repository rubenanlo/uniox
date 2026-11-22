import { admin, callerId } from '../_shared/db.ts';
import { json, preflight } from '../_shared/cors.ts';
import { GMAIL, gfetch } from '../_shared/google.ts';
import { seal } from '../_shared/secretbox.ts';
import { ACCOUNT_COLORS, signInUser } from '../_shared/users.ts';

/**
 * The desktop app's side of "Sync with phone".
 *
 *  POST {mode:'link', accounts:[{clientId, clientSecret, refreshToken, displayName?, color?}]}
 *       -> {email, tokenHash, accounts:[{email, ok, error?}]}
 *       Each grant is proven against Google (refresh, then ask Gmail whose
 *       mailbox it is) before anything is stored, so a caller can only attach
 *       mailboxes it already controls. Proving a mailbox that belongs to a
 *       user signs the desktop in as that user, exactly like Google sign-in
 *       on the phone. Grants are stored server-only and never returned.
 *  POST {mode:'unlink'} + JWT -> removes the accounts the desktop handed over.
 */

const MAX_ACCOUNTS = 12;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

interface Grant {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  displayName?: string;
  color?: string;
}

interface Proven extends Grant {
  email: string;
  accessToken: string;
  expiresAt: string;
}

const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

async function prove(g: Grant): Promise<Proven> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: g.refreshToken,
      client_id: g.clientId,
      client_secret: g.clientSecret,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error('Google no longer accepts this sign-in');
  const t: { access_token: string; expires_in: number } = await res.json();
  const profile = await gfetch<{ emailAddress: string }>(t.access_token, `${GMAIL}/profile`);
  return {
    ...g,
    email: profile.emailAddress.toLowerCase(),
    accessToken: t.access_token,
    expiresAt: new Date(Date.now() + t.expires_in * 1000).toISOString(),
  };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const db = admin();
  const body = await req.json().catch(() => ({}));

  if (body.mode === 'unlink') {
    const userId = await callerId(req);
    if (!userId) return json({ error: 'unauthorized' }, 401);
    const { data: mine } = await db.from('accounts').select('id').eq('user_id', userId);
    const ids = (mine ?? []).map((a) => a.id as string);
    if (!ids.length) return json({ removed: 0 });
    const { data: handed } = await db.from('account_tokens').select('account_id').in('account_id', ids).eq('source', 'desktop');
    const gone = (handed ?? []).map((t) => t.account_id as string);
    if (gone.length) await db.from('accounts').delete().in('id', gone);
    return json({ removed: gone.length });
  }

  if (body.mode !== 'link') return json({ error: 'unknown mode' }, 400);
  const grants: Grant[] = (Array.isArray(body.accounts) ? body.accounts : [])
    .filter(
      (a: Record<string, unknown>) =>
        a && str(a.clientId, 300) && str(a.clientSecret, 300) && str(a.refreshToken, 2000),
    )
    .slice(0, MAX_ACCOUNTS)
    .map((a: Record<string, unknown>) => ({
      clientId: a.clientId as string,
      clientSecret: a.clientSecret as string,
      refreshToken: a.refreshToken as string,
      displayName: str(a.displayName, 200) ? a.displayName : undefined,
      color: typeof a.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(a.color) ? a.color : undefined,
    }));
  if (!grants.length) return json({ error: 'No Google accounts to share.' }, 400);

  const results: { email?: string; ok: boolean; error?: string }[] = [];
  const proven: Proven[] = [];
  for (const g of grants) {
    try {
      const p = await prove(g);
      if (!proven.some((x) => x.email === p.email)) proven.push(p);
    } catch (e) {
      results.push({ ok: false, error: (e as Error).message.slice(0, 160) });
    }
  }
  if (!proven.length) return json({ error: 'Google did not accept any of the accounts.', accounts: results }, 400);

  // Which Uniox user do these mailboxes belong to? At most one.
  const { data: owners } = await db
    .from('accounts')
    .select('user_id')
    .in(
      'email',
      proven.map((p) => p.email),
    );
  const users = [...new Set((owners ?? []).map((o) => o.user_id as string))];
  if (users.length > 1) return json({ error: 'These accounts belong to different Uniox users.' }, 409);
  let userId: string | null = users[0] ?? null;
  if (!userId) {
    userId = await signInUser(db, proven[0].email);
    if (!userId) return json({ error: `${proven[0].email} is not allowed to use this Uniox` }, 403);
  }

  const { data: existing } = await db.from('accounts').select('id, email, status').eq('user_id', userId);
  let count = existing?.length ?? 0;
  for (const p of proven) {
    try {
      const had = existing?.find((a) => a.email === p.email);
      let accountId = had?.id as string | undefined;
      if (!accountId) {
        const { data: row, error } = await db
          .from('accounts')
          .insert({
            user_id: userId,
            email: p.email,
            display_name: p.displayName ?? p.email,
            color: p.color ?? ACCOUNT_COLORS[count % ACCOUNT_COLORS.length],
            status: 'syncing',
          })
          .select('id')
          .single();
        if (error || !row) throw new Error(error?.message ?? 'could not add the account');
        accountId = row.id as string;
        count++;
      }
      // Keep a working phone sign-in; replace a missing, failing or earlier desktop grant.
      const { data: tok } = await db.from('account_tokens').select('source').eq('account_id', accountId).maybeSingle();
      if (!tok || tok.source === 'desktop' || had?.status === 'error') {
        const { error } = await db.from('account_tokens').upsert({
          account_id: accountId,
          refresh_token: await seal(p.refreshToken),
          access_token: await seal(p.accessToken),
          expires_at: p.expiresAt,
          client_id: p.clientId,
          client_secret: await seal(p.clientSecret),
          source: 'desktop',
        });
        if (error) throw new Error(error.message);
        if (had?.status === 'error') await db.from('accounts').update({ status: 'syncing', sync_error: null }).eq('id', accountId);
      }
      results.push({ email: p.email, ok: true });
    } catch (e) {
      console.error('desktop-link', p.email, e);
      results.push({ email: p.email, ok: false, error: (e as Error).message.slice(0, 160) });
    }
  }

  const { data: user } = await db.auth.admin.getUserById(userId);
  const email = user.user?.email;
  if (!email) return json({ error: 'could not create session' }, 500);
  const { data: link, error: linkErr } = await db.auth.admin.generateLink({ type: 'magiclink', email });
  if (linkErr || !link.properties?.hashed_token) return json({ error: 'could not create session' }, 500);
  return json({ email, tokenHash: link.properties.hashed_token, accounts: results });
});
