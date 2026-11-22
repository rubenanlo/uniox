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

const confCache = new Map<string, string | null>();

/**
 * Server configuration: the Edge Function secret NAME if set, otherwise the
 * `app_config` row with the lower-case name. Null when neither exists.
 */
export async function conf(db: SupabaseClient, name: string): Promise<string | null> {
  const fromEnv = Deno.env.get(name);
  if (fromEnv) return fromEnv;
  if (confCache.has(name)) return confCache.get(name)!;
  const { data } = await db.from('app_config').select('value').eq('key', name.toLowerCase()).maybeSingle();
  const v = (data?.value as string | undefined) ?? null;
  if (v !== null) confCache.set(name, v);
  return v;
}
