-- Zeitplan: alle 15 Sekunden den Abrufdienst anstoßen (nur in der Supabase-Cloud)
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function private.kick() returns void
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  select value into v_url from private.secrets where key = 'function_url';
  select value into v_secret from private.secrets where key = 'cron_secret';
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(
    url := v_url || '?action=tick',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 4000);
end $$;

select cron.schedule('news-tick', '15 seconds', 'select private.kick()');
select cron.schedule('news-housekeeping', '17 3 * * *', 'select private.housekeeping()');
select cron.schedule('news-cron-cleanup', '*/20 * * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '1 hour'$$);

-- Wächter (siehe private.watchdog in der späteren Migration)
select cron.schedule('news-watchdog', '*/10 * * * *', 'select private.watchdog()');
