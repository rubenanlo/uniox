import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.2';

/**
 * Finds or creates the Supabase user for a proven Google address, enforcing
 * the allow list: ALLOWED_EMAILS (comma separated) when set; otherwise only
 * the first person to sign in can ever create the account.
 */
export async function signInUser(db: SupabaseClient, email: string): Promise<string | null> {
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

export const ACCOUNT_COLORS = ['#2f63e7', '#2db682', '#8a5cd6', '#e0883a', '#d4386c', '#3a8f8f'];
