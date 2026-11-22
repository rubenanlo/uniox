-- Each user's own Anthropic API key, encrypted at rest in Supabase Vault.
-- The phone sends the key once to the `ai` Edge Function; nothing here is
-- readable by a client: the table has RLS on with no policies, and the
-- helper functions can only be run by the service role.
create extension if not exists supabase_vault with schema vault;

create table public.user_ai_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  secret_id uuid not null,
  hint text not null, -- last 4 characters, to show "…abcd" in Settings
  updated_at timestamptz not null default now()
);
alter table public.user_ai_keys enable row level security;

create function public.set_ai_key(p_user uuid, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  select secret_id into sid from public.user_ai_keys where user_id = p_user;
  if sid is null then
    sid := vault.create_secret(p_key, 'anthropic:' || p_user::text);
    insert into public.user_ai_keys (user_id, secret_id, hint)
    values (p_user, sid, right(p_key, 4));
  else
    perform vault.update_secret(sid, p_key);
    update public.user_ai_keys
       set hint = right(p_key, 4), updated_at = now()
     where user_id = p_user;
  end if;
end $$;

create function public.get_ai_key(p_user uuid) returns text
language sql security definer set search_path = '' stable as $$
  select d.decrypted_secret
    from public.user_ai_keys k
    join vault.decrypted_secrets d on d.id = k.secret_id
   where k.user_id = p_user;
$$;

create function public.clear_ai_key(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  delete from public.user_ai_keys where user_id = p_user returning secret_id into sid;
  if sid is not null then
    delete from vault.secrets where id = sid;
  end if;
end $$;

revoke all on function public.set_ai_key(uuid, text) from public, anon, authenticated;
revoke all on function public.get_ai_key(uuid) from public, anon, authenticated;
revoke all on function public.clear_ai_key(uuid) from public, anon, authenticated;
grant execute on function public.set_ai_key(uuid, text) to service_role;
grant execute on function public.get_ai_key(uuid) to service_role;
grant execute on function public.clear_ai_key(uuid) to service_role;
