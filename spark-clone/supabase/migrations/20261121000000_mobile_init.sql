-- Uniox phone app backend: Gmail/Calendar cache, shared settings, push.
-- Every table is per-user with row-level security. Google tokens live in
-- account_tokens, which has RLS on and no policies: only the server
-- functions (service role) can read them, never the phone.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null default '',
  color text not null default '#2f63e7',
  status text not null default 'syncing' check (status in ('syncing', 'ok', 'error')),
  sync_error text,
  history_id text,
  calendar_synced_at timestamptz,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, email)
);

create table public.account_tokens (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  refresh_token text not null,
  access_token text,
  expires_at timestamptz
);

create table public.threads (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  gmail_thread_id text not null,
  subject text not null default '',
  snippet text not null default '',
  participants jsonb not null default '[]',
  last_from jsonb,
  last_message_at bigint not null default 0,
  message_count int not null default 0,
  unread_count int not null default 0,
  has_attachments boolean not null default false,
  pinned boolean not null default false,
  priority boolean not null default false,
  category text not null default 'personal',
  in_inbox boolean not null default true,
  snooze_until bigint,
  label_ids text[] not null default '{}',
  search tsvector generated always as (
    to_tsvector('simple', coalesce(subject, '') || ' ' || coalesce(snippet, '') || ' ' || coalesce(last_from ->> 'name', '') || ' ' || coalesce(last_from ->> 'email', ''))
  ) stored
);
create index threads_user_inbox on public.threads (user_id, in_inbox, last_message_at desc);
create index threads_search on public.threads using gin (search);
create index threads_snooze on public.threads (snooze_until) where snooze_until is not null;

create table public.messages (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  thread_id text not null references public.threads (id) on delete cascade,
  gmail_id text not null,
  rfc_message_id text,
  rfc_references text,
  from_addr jsonb,
  to_addrs jsonb not null default '[]',
  cc_addrs jsonb not null default '[]',
  date bigint not null,
  snippet text not null default '',
  html text,
  body_text text,
  from_me boolean not null default false,
  unread boolean not null default false,
  attachments jsonb not null default '[]',
  invite jsonb
);
create index messages_thread on public.messages (thread_id, date);

create table public.events (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  google_event_id text not null,
  calendar_id text not null,
  calendar_name text not null default '',
  ical_uid text,
  title text not null default '',
  start_ms bigint not null,
  end_ms bigint not null,
  all_day boolean not null default false,
  color text not null default '#2f63e7',
  location text,
  description text,
  meeting_url text,
  attendees jsonb not null default '[]',
  organizer jsonb,
  my_answer text,
  free boolean not null default false
);
create index events_user_range on public.events (user_id, start_ms);
create index events_ical on public.events (user_id, ical_uid);

-- Addresses the user has written to: drives "priority" (a human contact).
create table public.contacts (
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  sent_count int not null default 1,
  primary key (user_id, email)
);

-- Settings shared by the phone and (later, opt-in) the desktop app.
create table public.settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  keys jsonb not null,
  created_at timestamptz not null default now()
);

create table public.ai_cache (
  thread_id text primary key references public.threads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_message_id text not null,
  result jsonb not null
);

create table public.oauth_states (
  state text primary key,
  user_id uuid references auth.users (id) on delete cascade,
  return_to text,
  created_at timestamptz not null default now()
);

-- Row-level security
alter table public.accounts enable row level security;
alter table public.account_tokens enable row level security;
alter table public.threads enable row level security;
alter table public.messages enable row level security;
alter table public.events enable row level security;
alter table public.contacts enable row level security;
alter table public.settings enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.ai_cache enable row level security;
alter table public.oauth_states enable row level security;

create policy "own accounts" on public.accounts for select using (user_id = (select auth.uid()));
create policy "own threads" on public.threads for select using (user_id = (select auth.uid()));
create policy "own messages" on public.messages for select using (user_id = (select auth.uid()));
create policy "own events" on public.events for select using (user_id = (select auth.uid()));
create policy "own settings read" on public.settings for select using (user_id = (select auth.uid()));
create policy "own settings insert" on public.settings for insert with check (user_id = (select auth.uid()));
create policy "own settings update" on public.settings for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own push read" on public.push_subscriptions for select using (user_id = (select auth.uid()));
create policy "own push insert" on public.push_subscriptions for insert with check (user_id = (select auth.uid()));
create policy "own push delete" on public.push_subscriptions for delete using (user_id = (select auth.uid()));
-- account_tokens, contacts, ai_cache, oauth_states: no policies (server only).

-- Live updates to the phone.
alter publication supabase_realtime add table public.threads, public.events, public.accounts;
