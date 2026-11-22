-- Server-only configuration the Edge Functions read with the service role:
-- app_url (comma-separated allowed app origins), cron_secret, and the VAPID
-- keys for Web Push. RLS on with no policies, so no client can read it.
-- A same-named Edge Function secret (APP_URL, CRON_SECRET, …) wins if set.
create table public.app_config (
  key text primary key,
  value text not null
);
alter table public.app_config enable row level security;

insert into public.app_config (key, value)
values ('cron_secret', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

-- Pull new mail and calendar changes every minute.
select cron.schedule(
  'uniox-sync',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://ffijcbzozucfyvtakacd.supabase.co/functions/v1/sync',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select value from public.app_config where key = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- Forget abandoned sign-in attempts.
select cron.schedule('uniox-oauth-cleanup', '17 * * * *',
  $$ delete from public.oauth_states where created_at < now() - interval '1 hour'; $$);
