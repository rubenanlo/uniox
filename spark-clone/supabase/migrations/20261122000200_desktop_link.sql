-- Accounts handed over by the desktop app keep the Google client they were
-- authorized with (a refresh token only works with the client that issued it).
-- Null client columns mean "the server's own web client" (phone sign-ins).
alter table public.account_tokens
  add column if not exists client_id text,
  add column if not exists client_secret text,
  add column if not exists source text not null default 'phone' check (source in ('phone', 'desktop'));
