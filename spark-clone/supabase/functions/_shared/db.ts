import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.119.2';

export function env(name: string, fallback?: string): string {
  const v = Deno.env.get(name) ?? fallback;
  if (v === undefined) throw new Error(`Missing secret ${name}`);
  return v;
}

/** Service-role client: bypasses RLS. Only ever used server-side. */
export function admin(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Resolves the calling user from the request's Bearer JWT, or null. */
export async function callerId(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const { data } = await admin().auth.getUser(auth.slice(7));
  return data.user?.id ?? null;
}

const confCache = new Map<string, { value: string; at: number }>();
const CONF_TTL_MS = 60_000;

/**
 * Server configuration: the Edge Function secret NAME if set, otherwise the
 * `app_config` row with the lower-case name. Null when neither exists.
 * Rows are cached for a minute so an edit takes effect quickly.
 */
export async function conf(db: SupabaseClient, name: string): Promise<string | null> {
  const fromEnv = Deno.env.get(name);
  if (fromEnv) return fromEnv;
  const hit = confCache.get(name);
  if (hit && Date.now() - hit.at < CONF_TTL_MS) return hit.value;
  const { data } = await db.from('app_config').select('value').eq('key', name.toLowerCase()).maybeSingle();
  const v = (data?.value as string | undefined) ?? null;
  if (v !== null) confCache.set(name, { value: v, at: Date.now() });
  return v;
}
