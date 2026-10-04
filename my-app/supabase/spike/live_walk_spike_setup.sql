-- Live Walk v2 — Phase A device spike: a temporary private Realtime room.
--
-- NOT a migration. Paste into the Supabase SQL editor, run once, and run
-- live_walk_spike_teardown.sql when the spike is over. Keeping it out of
-- supabase/migrations means `db push` history never has to know it existed.
--
-- What it allows, and to whom:
--   * Only accounts listed in private.live_spike_testers.
--   * Only topics named `spike:<1–64 lowercase letters, digits or dashes>`.
--   * Only the Broadcast and Presence extensions of realtime.messages.
-- Everyone else, including anon and every other signed-in account, is refused
-- a private join exactly as today (realtime.messages has RLS on and, before
-- this script, no policies at all).
--
-- Nothing here touches app tables. The spike app writes no rows of its own.

begin;

create table if not exists private.live_spike_testers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);
-- No grants: only the definer function below reads it.
revoke all on private.live_spike_testers from public, anon, authenticated;

create or replace function private.live_spike_can_join(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_topic ~ '^spike:[a-z0-9-]{1,64}$'
     and exists (
       select 1 from private.live_spike_testers t
       where t.user_id = (select auth.uid())
     );
$$;
revoke all on function private.live_spike_can_join(text) from public, anon;
grant execute on function private.live_spike_can_join(text) to authenticated;

drop policy if exists live_spike_read on realtime.messages;
create policy live_spike_read on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and private.live_spike_can_join((select realtime.topic()))
  );

drop policy if exists live_spike_write on realtime.messages;
create policy live_spike_write on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and private.live_spike_can_join((select realtime.topic()))
  );

commit;

-- Then add the two test accounts (edit the emails; run separately):
--
--   insert into private.live_spike_testers (user_id)
--   select id from auth.users where email in ('first@example.com', 'second@example.com')
--   on conflict do nothing;
--
-- Check: should list exactly the two policies above and two testers.
--
--   select polname from pg_policy where polrelid = 'realtime.messages'::regclass;
--   select count(*) from private.live_spike_testers;
