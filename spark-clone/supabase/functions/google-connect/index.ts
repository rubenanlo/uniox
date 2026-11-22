import { admin, callerId, conf } from '../_shared/db.ts';
import { json, preflight } from '../_shared/cors.ts';
import { authUrl, exchangeCode, idTokenClaims } from '../_shared/google.ts';

const COLORS = ['#2f63e7', '#2db682', '#8a5cd6', '#e0883a', '#d4386c', '#3a8f8f'];

/**
 * Google sign-in and account linking for the phone app.
 *
 *  POST {mode:'signin', returnTo}        -> {url}  (no session yet)
 *  POST {mode:'link', returnTo} + JWT    -> {url}  (add another Gmail account)
 *  GET  ?code&state                      -> Google's redirect: stores tokens,
 *       then sends the browser back to the app with a one-time sign-in token.
 *
 * Sign-in is limited to ALLOWED_EMAILS (comma separated) when set; otherwise
 * only the first person to sign in can ever create the account.
 */
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const db = admin();
  const url = new URL(req.url);
  const allowed = ((await conf(db, 'APP_URL')) ?? '')
    .split(',')
    .map((u) => u.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  const home = allowed[0] ?? 'https://example.com';

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    // Only ever send the browser (and its one-time sign-in token) back to our own app.
    const returnTo = allowed.find((u) => u === String(body.returnTo ?? '').replace(/\/+$/, '')) ?? null;
    if (!returnTo) return json({ error: 'This app address is not allowed to sign in.' }, 400);
    let userId: string | null = null;
    if (body.mode === 'link') {
      userId = await callerId(req);
      if (!userId) return json({ error: 'unauthorized' }, 401);
    }
    const state = crypto.randomUUID();
    await db.from('oauth_states').insert({ state, user_id: userId, return_to: returnTo });
    return json({ url: authUrl(state) });
  }

  // Google redirect
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const fail = (msg: string, to?: string) =>
    Response.redirect(`${to || home}/#/welcome?error=${encodeURIComponent(msg)}`, 302);
  if (!code || !state) return fail(url.searchParams.get('error') ?? 'Sign-in was cancelled');

  const { data: st } = await db.from('oauth_states').select('*').eq('state', state).maybeSingle();
  await db.from('oauth_states').delete().eq('state', state);
  if (!st || Date.now() - new Date(st.created_at).getTime() > 15 * 60_000) return fail('Sign-in expired, try again');
  const returnTo = allowed.find((u) => u === st.return_to);
  if (!returnTo) return fail('Sign-in expired, try again');

  try {
    const tokens = await exchangeCode(code);
    const claims = tokens.id_token ? idTokenClaims(tokens.id_token) : {};
    const email = claims.email?.toLowerCase();
    if (!email) return fail('Google did not share the email address', returnTo);

    let userId: string | null = st.user_id;
    if (!userId) {
      userId = await signInUser(db, email);
      if (!userId) return fail(`${email} is not allowed to use this Uniox`, returnTo);
    }

    const { count } = await db.from('accounts').select('id', { count: 'exact', head: true }).eq('user_id', userId);
    const { data: acct, error } = await db
      .from('accounts')
      .upsert(
        { user_id: userId, email, display_name: claims.name ?? email, color: COLORS[(count ?? 0) % COLORS.length], status: 'syncing' },
        { onConflict: 'user_id,email' },
      )
      .select('id, user_id, email, history_id, calendar_synced_at')
      .single();
    if (error || !acct) throw new Error(error?.message ?? 'account upsert failed');

    const existing = await db.from('account_tokens').select('refresh_token').eq('account_id', acct.id).maybeSingle();
    const refresh = tokens.refresh_token ?? existing.data?.refresh_token;
    if (!refresh) return fail('Google did not return offline access; remove Uniox in your Google account permissions and retry', returnTo);
    await db.from('account_tokens').upsert({
      account_id: acct.id,
      refresh_token: refresh,
      access_token: tokens.access_token,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    });

    // First sync in the background so the redirect is quick.
    // The first sync starts when the app opens (it calls `sync`) and from the every-minute cron.

    if (st.user_id) return Response.redirect(`${returnTo}/#/settings?connected=${encodeURIComponent(email)}`, 302);
    const { data: link, error: linkErr } = await db.auth.admin.generateLink({ type: 'magiclink', email });
    if (linkErr || !link.properties?.hashed_token) throw new Error(linkErr?.message ?? 'could not create session');
    return Response.redirect(`${returnTo}/#/auth?token_hash=${link.properties.hashed_token}`, 302);
  } catch (e) {
    console.error(e);
    return fail((e as Error).message.slice(0, 200), returnTo);
  }
});

/** Finds or creates the Supabase user for a Google sign-in, enforcing the allow list. */
async function signInUser(db: ReturnType<typeof admin>, email: string): Promise<string | null> {
  const allowed = (Deno.env.get('ALLOWED_EMAILS') ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  // An account email already linked to a user signs that user in.
  const { data: linked } = await db.from('accounts').select('user_id').eq('email', email).limit(1).maybeSingle();
  if (linked) return linked.user_id;

  const { data: users } = await db.auth.admin.listUsers({ perPage: 50 });
  const found = users?.users.find((u) => u.email?.toLowerCase() === email);
  if (found) return found.id;
  if (allowed.length ? !allowed.includes(email) : (users?.users.length ?? 0) > 0) return null;
  const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw new Error(error.message);
  return data.user.id;
}
