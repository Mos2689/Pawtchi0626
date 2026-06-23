-- Schedule the proactive vet check-in dispatcher.
-- Runs daily; sends a push for any Second Opinion case whose check-in is due.
-- (Timezone note: fires at a fixed UTC hour for v1; per-user local timing is a later refinement.)
-- Set the CRON_SECRET header to match the function's CRON_SECRET env var.

select
  cron.schedule(
    'vet-checkins-daily',
    '0 17 * * *',
    $$
    select
      net.http_post(
          url:='https://mbvpjbwukhypvmgeuyyw.supabase.co/functions/v1/vet-checkins',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer sb_publishable_fpBRIqLHJQoKydS0tMyzwg_hINKYOQ_"}'::jsonb,
          body:=concat('{"time": "', current_timestamp, '"}')::jsonb
      ) as request_id;
    $$
  );
