-- Atomic, retry-safe undo for a just-finished tracked walk.
--
-- The mobile sync pipeline can either claim a scheduled activity or insert an
-- activity of its own. Discard must reverse that distinction, decrement the
-- daily walk count exactly once, and delete the route as one transaction.
-- Existing clients are unaffected; only the new summary action calls this RPC.

create or replace function public.discard_walk_session(
  p_walk_session_id uuid,
  p_matched_activity_id uuid default null,
  p_walk_date date default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_pet_id uuid;
  v_started_at timestamptz;
  v_stored_match uuid;
  v_match uuid;
  v_activity_changed integer := 0;
begin
  select owner_id, pet_id, started_at, matched_activity_id
    into v_owner_id, v_pet_id, v_started_at, v_stored_match
    from public.walk_sessions
   where id = p_walk_session_id
   for update;

  -- A never-uploaded offline walk has no remote row. This is a successful
  -- no-op; the client will remove it from its local retry queue.
  if not found then
    return false;
  end if;

  if auth.uid() is null or auth.uid() <> v_owner_id then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- Prefer the server backlink. The client value covers the narrow partial-
  -- sync case where activity completion committed but the non-fatal backlink
  -- write failed. It is still constrained by walk_session_id below.
  v_match := coalesce(v_stored_match, p_matched_activity_id);

  if v_match is not null then
    update public.activities
       set status = 'pending',
           completed_at = null,
           walk_session_id = null,
           duration_minutes = null,
           active_minutes = null,
           distance_km = null
     where id = v_match
       and pet_id = v_pet_id
       and walk_session_id = p_walk_session_id;
    get diagnostics v_activity_changed = row_count;
  else
    delete from public.activities
     where pet_id = v_pet_id
       and walk_session_id = p_walk_session_id;
    get diagnostics v_activity_changed = row_count;
  end if;

  if v_activity_changed > 0 then
    update public.daily_logs
       set walks_count = greatest(0, coalesce(walks_count, 0) - 1),
           updated_at = now()
     where pet_id = v_pet_id
       and log_date = coalesce(p_walk_date, v_started_at::date);
  end if;

  delete from public.walk_sessions
   where id = p_walk_session_id
     and owner_id = v_owner_id;

  return true;
end;
$$;

revoke all on function public.discard_walk_session(uuid, uuid, date) from public;
grant execute on function public.discard_walk_session(uuid, uuid, date) to authenticated;

comment on function public.discard_walk_session(uuid, uuid, date) is
  'Atomically removes an owned walk and reverses only the activity/count it created.';

-- Make the RPC visible immediately instead of waiting for PostgREST's schema
-- cache refresh window (the client otherwise reports PGRST202 temporarily).
notify pgrst, 'reload schema';
