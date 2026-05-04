select
  cron.schedule(
    'daily-reminder-check', 
    '0 18 * * *', 
    $$
    select
      net.http_post(
          url:='https://mbvpjbwukhypvmgeuyyw.supabase.co/functions/v1/check-reminders',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer sb_publishable_fpBRIqLHJQoKydS0tMyzwg_hINKYOQ_"}'::jsonb,
          body:=concat('{"time": "', current_timestamp, '"}')::jsonb
      ) as request_id;
    $$
  );
