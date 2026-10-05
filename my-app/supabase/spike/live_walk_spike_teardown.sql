-- Live Walk v2 — Phase A device spike: remove the temporary room.
-- Paste into the Supabase SQL editor once the spike reports are saved.

begin;

drop policy if exists live_spike_read on realtime.messages;
drop policy if exists live_spike_write on realtime.messages;
drop function if exists private.live_spike_can_join(text);
drop table if exists private.live_spike_testers;

commit;

-- Check: realtime.messages is back to no policies at all.
--
--   select polname from pg_policy where polrelid = 'realtime.messages'::regclass;
