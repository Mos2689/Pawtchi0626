-- Down for 20260922030000_slow_community_cron.
--
-- There is deliberately no `cron.schedule('notify-dispatch-community', ...)`
-- here. Reverting this migration must not resurrect the job that took
-- production down on 22 Sep 2026, and nothing needs it to: the trigger from
-- 20260922050000 dispatches on enqueue, and the */15 notify-dispatch cron
-- delivers everything regardless.
--
-- If you are reverting because the TRIGGER is misbehaving, revert
-- 20260922050000 as well and accept up to fifteen minutes of latency from the
-- reaper. That is the safe degraded mode. A fast cron is not.
--
-- The sweep is left exactly as it is. 20260922000000 has been corrected in
-- place to */15, so the forward migration and this one now agree about it and
-- there is nothing to undo — reverting must not quietly speed it back up.

SELECT cron.unschedule('community-walk-reminders')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'community-walk-reminders');
SELECT cron.schedule(
  'community-walk-reminders',
  '*/15 * * * *',
  $cron$SELECT public.sweep_community_walk_reminders();$cron$
);
