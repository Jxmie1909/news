-- News: Schema, Sicherheit und Funktionen
-- Ein-Personen-App: genau ein Besitzer, alle Daten gehören ihm.

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Private Tabellen (nie über die API erreichbar)
-- ---------------------------------------------------------------------------
create table private.owner (
  id boolean primary key default true check (id),
  user_id uuid not null
);

create table private.secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table private.state (
  id boolean primary key default true check (id),
  lock_until timestamptz,
  config_version bigint not null default 1,
  last_tick_at timestamptz,
  last_tick_ms int,
  last_tick_info jsonb,
  llm_day date,
  llm_calls int not null default 0,
  llm_paused_until timestamptz,
  llm_last_error text,
  llm_last_ok_at timestamptz,
  last_digest_key text,
  profile_version bigint not null default 1,
  profile_changed_at timestamptz not null default now(),
  rescore_version bigint not null default 1
);
insert into private.state (id) values (true);

insert into private.secrets (key, value) values
  ('cron_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

create table private.token_df (
  token text primary key,
  df real not null default 0
);

-- ---------------------------------------------------------------------------
-- Öffentliche Tabellen (nur für den Besitzer, per RLS)
-- ---------------------------------------------------------------------------
create table public.settings (
  id boolean primary key default true check (id),
  onboarding_done boolean not null default false,
  languages text[] not null default '{de,en}',
  categories text[] not null default '{}',
  muted text[] not null default '{}',
  timezone text not null default 'Europe/Berlin',
  push_enabled boolean not null default true,
  thr_stocks int not null default 60,
  thr_topics int not null default 60,
  thr_world int not null default 82,
  world_push boolean not null default true,
  push_max_per_day int not null default 8,
  quiet_enabled boolean not null default true,
  quiet_start text not null default '23:00',
  quiet_end text not null default '07:00',
  quiet_allow_stocks boolean not null default false,
  ntfy_enabled boolean not null default false,
  ntfy_topic text not null default ('news-' || left(replace(gen_random_uuid()::text, '-', ''), 20)),
  digest_enabled boolean not null default true,
  digest_times text[] not null default '{07:30,18:30}',
  price_alerts boolean not null default true,
  price_move_pct numeric not null default 3,
  price_window_min int not null default 10,
  profile_text text not null default '',
  llm_enabled boolean not null default true,
  llm_model text not null default 'gemini-flash-lite-latest',
  llm_daily_budget int not null default 300,
  has_gemini_key boolean not null default false,
  sec_contact text not null default '',
  site_url text not null default '',
  last_seen_at timestamptz,
  last_check_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (true);

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'topic' check (kind in ('topic', 'stock')),
  name text not null,
  emoji text,
  category text,
  catalog_id text unique,
  keywords text[] not null default '{}',
  exclude text[] not null default '{}',
  priority smallint not null default 2 check (priority between 0 and 3),
  ticker text,
  events text[] not null default '{}',
  active boolean not null default true,
  origin text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_matched_at timestamptz,
  last_opened_at timestamptz,
  match_count int not null default 0
);

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  name text not null,
  kind text not null check (kind in ('rss', 'gnews', 'bluesky', 'yahoo', 'sec')),
  url text not null,
  lang text not null default 'de',
  category text,
  weight real not null default 1.0,
  breaking boolean not null default false,
  interval_sec int not null default 300,
  enabled boolean not null default true,
  core boolean not null default false,
  broken boolean not null default false,
  topic_id uuid references public.topics (id) on delete cascade,
  next_fetch_at timestamptz not null default now(),
  last_fetched_at timestamptz,
  last_ok_at timestamptz,
  last_new_at timestamptz,
  last_status int,
  last_error text,
  fail_count int not null default 0,
  etag text,
  last_modified text,
  item_count int
);
create index sources_due_idx on public.sources (next_fetch_at) where enabled and not broken;
create index sources_topic_idx on public.sources (topic_id);

create table public.stories (
  id bigint generated always as identity primary key,
  kind text not null default 'news',
  title text not null,
  summary text,
  summary_ai text,
  url text,
  image_url text,
  lang text,
  category text,
  source_name text,
  publishers text[] not null default '{}',
  source_count int not null default 1,
  article_count int not null default 1,
  max_weight real not null default 1,
  breaking boolean not null default false,
  backfill boolean not null default false,
  tokens text[] not null default '{}',
  hints uuid[] not null default '{}',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  published_at timestamptz,
  sort_at timestamptz not null default now(),
  event text,
  importance real not null default 0,
  relevance real not null default 0,
  score real not null default 0,
  tier smallint not null default 1,
  matched uuid[] not null default '{}',
  reasons jsonb not null default '[]',
  llm jsonb,
  llm_at timestamptz,
  pushed_at timestamptz,
  push_reason text,
  feedback smallint,
  feedback_at timestamptz,
  saved boolean not null default false,
  saved_at timestamptz,
  read_at timestamptz
);
create index stories_tier_sort_idx on public.stories (tier, sort_at desc);
create index stories_sort_idx on public.stories (sort_at desc, id desc);
create index stories_saved_idx on public.stories (saved_at desc) where saved;
create index stories_matched_idx on public.stories using gin (matched);
create index stories_first_seen_idx on public.stories (first_seen_at desc);

create table public.articles (
  id bigint generated always as identity primary key,
  story_id bigint not null references public.stories (id) on delete cascade,
  source_id uuid references public.sources (id) on delete set null,
  publisher text,
  publisher_key text,
  url text not null,
  url_hash text not null unique,
  title text not null,
  title_key text,
  summary text,
  image_url text,
  lang text,
  tokens text[] not null default '{}',
  published_at timestamptz,
  fetched_at timestamptz not null default now()
);
create index articles_story_idx on public.articles (story_id);
create index articles_tokens_idx on public.articles using gin (tokens);
create index articles_fetched_idx on public.articles (fetched_at desc);
create index articles_title_key_idx on public.articles (title_key);

create table public.push_subscriptions (
  id bigint generated always as identity primary key,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  ua text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  fail_count int not null default 0
);

create table public.push_log (
  id bigint generated always as identity primary key,
  story_id bigint references public.stories (id) on delete set null,
  kind text not null default 'story',
  title text,
  body text,
  reason text,
  sent_at timestamptz not null default now(),
  web_ok int not null default 0,
  web_fail int not null default 0,
  ntfy_ok boolean,
  error text
);
create index push_log_sent_idx on public.push_log (sent_at desc);

create table public.term_weights (
  term text primary key,
  display text,
  pos int not null default 0,
  neg int not null default 0,
  updated_at timestamptz not null default now()
);

create table public.price_state (
  ticker text primary key,
  topic_id uuid references public.topics (id) on delete cascade,
  price numeric,
  prev_close numeric,
  currency text,
  day_alert_dir smallint,
  day_alert_date date,
  last_alert_at timestamptz,
  last_alert_price numeric,
  next_check_at timestamptz not null default now(),
  error text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Zugriffsschutz
-- ---------------------------------------------------------------------------
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.owner o where o.user_id = (select auth.uid()));
$$;

do $$
declare t text;
begin
  foreach t in array array['settings','topics','sources','stories','articles','push_subscriptions','push_log','term_weights','price_state'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy owner_all on public.%I for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()))', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Sobald es einen Besitzer gibt, kann sich niemand sonst mehr registrieren
create or replace function private.block_signups() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from private.owner) then
    raise exception 'Registrierung ist geschlossen' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists news_block_signups on auth.users;
create trigger news_block_signups before insert on auth.users
for each row execute function private.block_signups();

-- ---------------------------------------------------------------------------
-- Hilfsfunktionen
-- ---------------------------------------------------------------------------
create or replace function private.bump_config() returns void
language sql security definer set search_path = '' as $$
  update private.state set config_version = config_version + 1;
$$;

-- Profil geändert (Themen, Schwellen, Sprachen …): Konfiguration neu laden und Meldungen neu bewerten
create or replace function private.bump_profile() returns void
language sql security definer set search_path = '' as $$
  update private.state set config_version = config_version + 1,
         profile_version = profile_version + 1, profile_changed_at = now();
$$;

create or replace function private.gnews_query(p_keywords text[]) returns text
language sql immutable set search_path = '' as $$
  select string_agg('"' || replace(k, '"', '') || '"', ' OR ')
  from (select k from unnest(p_keywords) with ordinality as u(k, ord)
        where length(trim(k)) >= 2 order by ord limit 6) q;
$$;

-- Quellen eines Themas anlegen/aktualisieren (Google-News-Suche, Yahoo-Finanzfeed)
create or replace function private.sync_topic_sources(p_topic public.topics) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_langs text[];
  v_q text;
  v_iv int;
  v_keep text[] := '{}';
  v_lang text;
  v_key text;
begin
  select languages into v_langs from public.settings;
  if not p_topic.active or p_topic.priority = 0 then
    delete from public.sources where topic_id = p_topic.id;
    delete from public.price_state where topic_id = p_topic.id;
    return;
  end if;
  v_iv := case p_topic.priority when 3 then 75 when 2 then 300 else 900 end;
  v_q := private.gnews_query(p_topic.keywords);
  if v_q is not null then
    foreach v_lang in array v_langs loop
      v_key := 'gnews:' || p_topic.id || ':' || v_lang;
      v_keep := v_keep || v_key;
      insert into public.sources (key, name, kind, url, lang, category, weight, interval_sec, topic_id)
      values (v_key, 'Google News · ' || p_topic.name, 'gnews', v_q || ' when:2d', v_lang, p_topic.category, 1.0, v_iv, p_topic.id)
      on conflict (key) do update set
        name = excluded.name, url = excluded.url, category = excluded.category,
        interval_sec = excluded.interval_sec, enabled = true,
        broken = false, fail_count = 0,
        next_fetch_at = least(public.sources.next_fetch_at, now() + make_interval(secs => excluded.interval_sec)),
        last_ok_at = case when public.sources.url is distinct from excluded.url then null else public.sources.last_ok_at end;
    end loop;
  end if;
  if p_topic.kind = 'stock' and coalesce(p_topic.ticker, '') <> '' then
    v_key := 'yahoo:' || p_topic.id;
    v_keep := v_keep || v_key;
    insert into public.sources (key, name, kind, url, lang, category, weight, interval_sec, topic_id)
    values (v_key, 'Yahoo Finance · ' || p_topic.name, 'yahoo', p_topic.ticker, 'en', 'boerse', 1.0,
            case p_topic.priority when 3 then 45 when 2 then 240 else 900 end, p_topic.id)
    on conflict (key) do update set
      name = excluded.name, url = excluded.url, interval_sec = excluded.interval_sec, enabled = true,
      broken = false, fail_count = 0,
      last_ok_at = case when public.sources.url is distinct from excluded.url then null else public.sources.last_ok_at end;
    insert into public.price_state (ticker, topic_id) values (p_topic.ticker, p_topic.id)
    on conflict (ticker) do update set topic_id = excluded.topic_id;
    delete from public.price_state where topic_id = p_topic.id and ticker <> p_topic.ticker;
  else
    delete from public.price_state where topic_id = p_topic.id;
  end if;
  delete from public.sources where topic_id = p_topic.id and not (key = any (v_keep));
end $$;

create or replace function private.topics_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'DELETE' then
    perform private.sync_topic_sources(new);
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'updated_at' - 'last_matched_at' - 'last_opened_at' - 'match_count')
       = (to_jsonb(old) - 'updated_at' - 'last_matched_at' - 'last_opened_at' - 'match_count') then
    return null;
  end if;
  perform private.bump_profile();
  return null;
end $$;

create trigger topics_sync after insert or update or delete on public.topics
for each row execute function private.topics_trigger();

create or replace function private.topics_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.keywords := array(select distinct trim(k) from unnest(new.keywords) k where trim(k) <> '');
  new.exclude := array(select distinct trim(k) from unnest(new.exclude) k where trim(k) <> '');
  if new.ticker is not null then new.ticker := upper(trim(new.ticker)); end if;
  return new;
end $$;

-- Reihenfolge der Stichwörter erhalten (wichtig für die Suchanfrage)
create or replace function private.topics_touch_ordered() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  -- fehlende Angaben auffüllen (z. B. wenn mehrere Themen auf einmal angelegt werden)
  new.kind := coalesce(new.kind, 'topic');
  new.keywords := coalesce(new.keywords, '{}');
  new.exclude := coalesce(new.exclude, '{}');
  new.events := coalesce(new.events, '{}');
  new.priority := coalesce(new.priority, 2);
  new.active := coalesce(new.active, true);
  new.origin := coalesce(new.origin, 'manual');
  new.match_count := coalesce(new.match_count, 0);
  new.created_at := coalesce(new.created_at, now());
  if new.id is null then new.id := gen_random_uuid(); end if;
  new.keywords := array(
    select k from (
      select trim(k) as k, min(ord) as ord from unnest(new.keywords) with ordinality as u(k, ord)
      where trim(k) <> '' group by trim(k)) q order by ord);
  new.exclude := array(select distinct trim(k) from unnest(new.exclude) k where trim(k) <> '');
  if new.ticker is not null then new.ticker := nullif(upper(trim(new.ticker)), ''); end if;
  return new;
end $$;
drop function private.topics_touch();

create trigger topics_touch before insert or update on public.topics
for each row execute function private.topics_touch_ordered();

-- Gewicht eines Wortes: selten = 1, sehr häufig = nahe 0
create or replace function private.idf(p_df real) returns real
language sql immutable set search_path = '' as $$
  select greatest(0.08, 1.0 - ln(1.0 + greatest(p_df, 0)) / ln(2000.0))::real;
$$;

-- Das ausgeschriebene Wort zu einer gekürzten Wortform aus einer Schlagzeile heraussuchen (für Vorschläge)
create or replace function private.token_display(p_title text, p_token text) returns text
language sql immutable set search_path = '' as $$
  select coalesce((
    select w from regexp_split_to_table(coalesce(p_title, ''), '[^[:alnum:]äöüÄÖÜß]+') as w
     where length(w) >= 3
       and left(replace(replace(replace(replace(lower(w), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss'), 6) = p_token
     limit 1), p_token);
$$;

-- Feste Quellen je nach gewählten Bereichen und Sprachen ein-/ausschalten
create or replace function private.apply_source_flags() returns void
language plpgsql security definer set search_path = '' as $$
declare s public.settings;
begin
  select * into s from public.settings;
  update public.sources src
     set enabled = (src.core or src.category = any (s.categories)) and src.lang = any (s.languages)
   where src.topic_id is null
     and src.enabled is distinct from ((src.core or src.category = any (s.categories)) and src.lang = any (s.languages));
end $$;

create or replace function private.settings_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t public.topics;
begin
  if new.languages is distinct from old.languages or new.categories is distinct from old.categories then
    perform private.apply_source_flags();
  end if;
  if new.languages is distinct from old.languages then
    for t in select * from public.topics loop
      perform private.sync_topic_sources(t);
    end loop;
  end if;
  if (to_jsonb(new) - 'last_seen_at' - 'updated_at' - 'last_check_at' - 'site_url')
     is distinct from (to_jsonb(old) - 'last_seen_at' - 'updated_at' - 'last_check_at' - 'site_url') then
    if (new.languages, new.categories, new.muted, new.thr_stocks, new.thr_topics, new.thr_world, new.world_push, new.profile_text)
       is distinct from (old.languages, old.categories, old.muted, old.thr_stocks, old.thr_topics, old.thr_world, old.world_push, old.profile_text) then
      perform private.bump_profile();
    else
      perform private.bump_config();
    end if;
  end if;
  return null;
end $$;

create trigger settings_sync after update on public.settings
for each row execute function private.settings_trigger();

create or replace function private.settings_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if cardinality(new.languages) = 0 then new.languages := '{de}'; end if;
  new.thr_stocks := greatest(20, least(98, new.thr_stocks));
  new.thr_topics := greatest(20, least(98, new.thr_topics));
  new.thr_world := greatest(30, least(99, new.thr_world));
  new.push_max_per_day := greatest(0, least(100, new.push_max_per_day));
  new.muted := array(select distinct lower(trim(k)) from unnest(new.muted) k where trim(k) <> '');
  -- nur der Dienst darf dieses Kennzeichen setzen
  if tg_op = 'UPDATE' and (select auth.role()) = 'authenticated' then
    new.has_gemini_key := old.has_gemini_key;
  end if;
  return new;
end $$;

create trigger settings_touch before update on public.settings
for each row execute function private.settings_touch();

create or replace function private.story_json(s public.stories) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id,
    'kind', s.kind,
    'title', s.title,
    'summary', left(coalesce(nullif(s.summary_ai, ''), s.summary, ''), 320),
    'ai', coalesce(s.summary_ai, '') <> '',
    'image', s.image_url,
    'lang', s.lang,
    'category', s.category,
    'source', s.source_name,
    'sources', s.source_count,
    'at', s.sort_at,
    'tier', s.tier,
    'imp', round(s.importance::numeric),
    'event', s.event,
    'url', s.url,
    'read', s.read_at is not null,
    'fb', s.feedback,
    'saved', s.saved,
    'pushed', s.pushed_at is not null,
    'topics', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'emoji', t.emoji, 'kind', t.kind) order by t.priority desc, t.name), '[]'::jsonb)
               from public.topics t where t.id = any (s.matched))
  );
$$;

create or replace function private.require_owner() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_owner() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Funktionen für die App (nur Besitzer)
-- ---------------------------------------------------------------------------
create or replace function public.app_bootstrap() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  st private.state;
  s public.settings;
  v_day_start timestamptz;
begin
  perform private.require_owner();
  select * into st from private.state;
  select * into s from public.settings;
  v_day_start := date_trunc('day', now() at time zone s.timezone) at time zone s.timezone;
  return jsonb_build_object(
    'settings', to_jsonb(s),
    'topics', (select coalesce(jsonb_agg(to_jsonb(t) order by t.priority desc, t.kind, t.name), '[]'::jsonb) from public.topics t),
    'vapid_public_key', (select value from private.secrets where key = 'vapid_public_key'),
    'push_devices', (select count(*) from public.push_subscriptions),
    'pushes_today', (select count(*) from public.push_log where sent_at >= v_day_start and kind in ('story', 'price')),
    'status', jsonb_build_object(
      'last_tick_at', st.last_tick_at,
      'last_tick_ms', st.last_tick_ms,
      'llm_calls_today', case when st.llm_day = (now() at time zone 'UTC')::date then st.llm_calls else 0 end,
      'llm_paused_until', st.llm_paused_until,
      'llm_last_error', st.llm_last_error,
      'llm_last_ok_at', st.llm_last_ok_at,
      'sources_total', (select count(*) from public.sources where enabled),
      'sources_broken', (select count(*) from public.sources where enabled and (broken or fail_count >= 5)),
      'stories_24h', (select count(*) from public.stories where sort_at > now() - interval '24 hours')
    )
  );
end $$;

create or replace function public.feed_today() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.settings;
  v_top jsonb; v_for jsonb; v_more jsonb;
begin
  perform private.require_owner();
  select * into s from public.settings;
  select coalesce(jsonb_agg(private.story_json(x) order by x.sort_at desc), '[]'::jsonb) into v_top
    from (select * from public.stories where tier = 3 and sort_at > now() - interval '24 hours'
          order by sort_at desc limit 12) x;
  select coalesce(jsonb_agg(private.story_json(x.st) order by x.rank desc), '[]'::jsonb) into v_for
    from (select st, (st.score - extract(epoch from now() - st.sort_at) / 3600.0 * 1.2) as rank
            from public.stories st
           where st.tier = 2 and st.sort_at > now() - interval '24 hours'
           order by rank desc limit 30) x;
  select coalesce(jsonb_agg(private.story_json(x.st) order by x.rank desc), '[]'::jsonb) into v_more
    from (select st, (st.score - extract(epoch from now() - st.sort_at) / 3600.0 * 2.5) as rank
            from public.stories st
           where st.tier = 1 and st.sort_at > now() - interval '12 hours'
           order by rank desc limit 15) x;
  return jsonb_build_object(
    'top', v_top, 'foryou', v_for, 'more', v_more,
    'last_seen_at', s.last_seen_at,
    'now', now(),
    'last_tick_at', (select last_tick_at from private.state)
  );
end $$;

create or replace function public.feed_ticker(
  p_before timestamptz default null,
  p_before_id bigint default null,
  p_limit int default 30,
  p_topic uuid default null,
  p_q text default null,
  p_min_tier int default 1,
  p_saved boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform private.require_owner();
  if p_saved then
    select coalesce(jsonb_agg(private.story_json(x) order by x.saved_at desc), '[]'::jsonb) into v
      from (select * from public.stories where saved order by saved_at desc limit 200) x;
    return v;
  end if;
  select coalesce(jsonb_agg(private.story_json(x) order by x.sort_at desc, x.id desc), '[]'::jsonb) into v
    from (select * from public.stories st
           where st.tier >= p_min_tier
             and (p_before is null or (st.sort_at, st.id) < (p_before, coalesce(p_before_id, 9223372036854775807)))
             and (p_topic is null or st.matched @> array[p_topic])
             and (coalesce(p_q, '') = '' or st.title ilike '%' || replace(replace(p_q, '%', '\%'), '_', '\_') || '%')
           order by st.sort_at desc, st.id desc
           limit least(greatest(p_limit, 1), 100)) x;
  return v;
end $$;

create or replace function public.feed_new_count(p_since timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_owner();
  return jsonb_build_object(
    'important', (select count(*) from public.stories where tier >= 2 and first_seen_at > p_since and not backfill),
    'top', (select count(*) from public.stories where tier = 3 and first_seen_at > p_since and not backfill),
    'last_tick_at', (select last_tick_at from private.state)
  );
end $$;

create or replace function public.story_detail(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare st public.stories; v jsonb;
begin
  perform private.require_owner();
  update public.stories set read_at = coalesce(read_at, now()) where id = p_id returning * into st;
  if not found then return null; end if;
  update public.topics set last_opened_at = now() where id = any (st.matched);
  v := private.story_json(st);
  return v || jsonb_build_object(
    'reasons', st.reasons,
    'push_reason', st.push_reason,
    'summary_full', coalesce(st.summary, ''),
    'summary_ai', coalesce(st.summary_ai, ''),
    'first_seen_at', st.first_seen_at,
    'articles', (
      select coalesce(jsonb_agg(jsonb_build_object('publisher', a.publisher, 'title', a.title, 'url', a.url, 'at', coalesce(a.published_at, a.fetched_at), 'lang', a.lang) order by coalesce(a.published_at, a.fetched_at)), '[]'::jsonb)
      from (select distinct on (coalesce(publisher_key, url_hash)) * from public.articles where story_id = p_id
            order by coalesce(publisher_key, url_hash), coalesce(published_at, fetched_at)) a)
  );
end $$;

-- Rückmeldung: 2 = sofort wissen wollen, 1 = interessant, -1 = egal, -2 = nie wieder, null = zurücknehmen
create or replace function public.set_feedback(p_id bigint, p_value int, p_learn_only boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  st public.stories;
  v_old int;
  v_terms text[];
  v_domain text;
  v_adjust int := 0;
  s public.settings;
begin
  perform private.require_owner();
  if p_value is not null and p_value not in (2, 1, -1, -2) then
    raise exception 'invalid value';
  end if;
  select * into st from public.stories where id = p_id for update;
  if not found then return null; end if;
  v_old := st.feedback;
  if v_old is not distinct from p_value then
    return jsonb_build_object('fb', p_value);
  end if;
  v_terms := st.tokens
    || case when st.source_name is not null then array['src:' || lower(st.source_name)] else '{}'::text[] end
    || case when st.category is not null then array['cat:' || st.category] else '{}'::text[] end;

  if v_old is not null then
    update public.term_weights w
       set pos = greatest(0, pos - case when v_old > 0 then v_old else 0 end),
           neg = greatest(0, neg - case when v_old < 0 then -v_old else 0 end),
           updated_at = now()
     where w.term = any (v_terms);
  end if;
  if p_value is not null then
    insert into public.term_weights (term, display, pos, neg)
    select t, private.token_display(st.title, t), case when p_value > 0 then p_value else 0 end, case when p_value < 0 then -p_value else 0 end
      from unnest(v_terms) t
    on conflict (term) do update set
      pos = public.term_weights.pos + excluded.pos,
      neg = public.term_weights.neg + excluded.neg,
      display = case when public.term_weights.display is null or public.term_weights.display = public.term_weights.term
                     then excluded.display else public.term_weights.display end,
      updated_at = now();
  end if;
  update public.stories set feedback = p_value, feedback_at = now(),
         read_at = coalesce(read_at, now()) where id = p_id;

  -- Push-Schwellen behutsam nachjustieren
  select * into s from public.settings;
  if st.kind = 'news' and p_value is not null and not p_learn_only then
    select case when bool_or(t.kind = 'stock') then 'stocks' when count(*) > 0 then 'topics' else 'world' end
      into v_domain from public.topics t where t.id = any (st.matched);
    v_domain := coalesce(v_domain, 'world');
    if p_value < 0 and st.pushed_at is not null then v_adjust := 3;
    elsif p_value = 2 and st.pushed_at is null and not st.backfill then v_adjust := -3;
    end if;
    if v_adjust <> 0 then
      if v_domain = 'stocks' then update public.settings set thr_stocks = thr_stocks + v_adjust;
      elsif v_domain = 'topics' then update public.settings set thr_topics = thr_topics + v_adjust;
      else update public.settings set thr_world = thr_world + v_adjust;
      end if;
    end if;
  end if;
  perform private.bump_config();
  return jsonb_build_object('fb', p_value, 'adjust', v_adjust, 'domain', v_domain);
end $$;

create or replace function public.toggle_saved(p_id bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v boolean;
begin
  perform private.require_owner();
  update public.stories set saved = not saved, saved_at = case when saved then null else now() end
   where id = p_id returning saved into v;
  return v;
end $$;

create or replace function public.mark_seen() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_owner();
  update public.settings set last_seen_at = now();
end $$;

create or replace function public.mark_read(p_ids bigint[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_owner();
  update public.stories set read_at = now() where id = any (p_ids) and read_at is null;
end $$;

-- Beispiel-Schlagzeilen für den Interessen-Test
create or replace function public.onboarding_samples(p_count int default 40) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.settings; v jsonb;
begin
  perform private.require_owner();
  select * into s from public.settings;
  select coalesce(jsonb_agg(private.story_json(x.st) order by x.rn, x.rnd), '[]'::jsonb) into v
    from (
      select st, random() as rnd,
             row_number() over (partition by coalesce(st.category, 'x'), (cardinality(st.matched) > 0) order by st.importance desc, random()) as rn
        from public.stories st
       where st.kind = 'news' and st.feedback is null and st.tier > 0
         and st.sort_at > now() - interval '4 days'
         and st.lang = any (s.languages)
         and length(st.title) between 25 and 160
       order by rn, rnd
       limit least(greatest(p_count, 1), 80)
    ) x;
  return v;
end $$;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_owner();
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 then raise exception 'invalid endpoint'; end if;
  insert into public.push_subscriptions (endpoint, p256dh, auth, ua)
  values (p_endpoint, p_p256dh, p_auth, left(p_ua, 300))
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua, fail_count = 0;
end $$;

create or replace function public.delete_push_subscription(p_endpoint text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_owner();
  delete from public.push_subscriptions where endpoint = p_endpoint;
end $$;

create or replace function public.system_status() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare st private.state;
begin
  perform private.require_owner();
  select * into st from private.state;
  return jsonb_build_object(
    'last_tick_at', st.last_tick_at,
    'last_tick_ms', st.last_tick_ms,
    'last_tick_info', st.last_tick_info,
    'llm', jsonb_build_object(
      'calls_today', case when st.llm_day = (now() at time zone 'UTC')::date then st.llm_calls else 0 end,
      'paused_until', st.llm_paused_until, 'last_error', st.llm_last_error, 'last_ok_at', st.llm_last_ok_at),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'kind', kind, 'lang', lang, 'category', category, 'enabled', enabled, 'broken', broken,
        'core', core, 'topic', topic_id is not null, 'interval', interval_sec, 'last_ok_at', last_ok_at,
        'last_new_at', last_new_at, 'last_status', last_status, 'last_error', last_error, 'fail_count', fail_count)
        order by (topic_id is not null), category nulls first, name), '[]'::jsonb) from public.sources),
    'pushes', (select coalesce(jsonb_agg(to_jsonb(p) order by p.sent_at desc), '[]'::jsonb)
                 from (select id, story_id, kind, title, body, reason, sent_at, web_ok, web_fail, ntfy_ok, error
                         from public.push_log order by sent_at desc limit 30) p),
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'ua', ua, 'created_at', created_at, 'last_ok_at', last_ok_at, 'fail_count', fail_count)), '[]'::jsonb)
                  from public.push_subscriptions),
    'counts', jsonb_build_object(
      'stories', (select count(*) from public.stories),
      'articles', (select count(*) from public.articles),
      'stories_24h', (select count(*) from public.stories where sort_at > now() - interval '24 hours'),
      'feedback', (select count(*) from public.stories where feedback is not null)),
    'suggestions', (
      select coalesce(jsonb_agg(jsonb_build_object('term', w.term, 'display', w.display, 'pos', w.pos) order by w.pos desc), '[]'::jsonb)
        from (select tw.* from public.term_weights tw
               where tw.pos >= 3 and tw.neg = 0 and tw.term not like 'src:%' and tw.term not like 'cat:%'
                 and tw.display is not null and tw.display <> tw.term and tw.display ~ '^[A-ZÄÖÜ]' and length(tw.display) >= 4
                 and not exists (select 1 from public.topics t, unnest(t.keywords) k where lower(k) like '%' || lower(tw.display) || '%' or lower(tw.display) like '%' || lower(k) || '%')
                 and not (lower(tw.display) = any ((select muted from public.settings)::text[]))
               order by tw.pos desc limit 6) w),
    'stale_topics', (
      select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'emoji', t.emoji, 'priority', t.priority)), '[]'::jsonb)
        from public.topics t
       where t.active and t.priority >= 2 and t.created_at < now() - interval '21 days'
         and coalesce(t.last_opened_at, t.created_at) < now() - interval '21 days'
         and t.match_count > 5)
  );
end $$;

-- Bereiche speichern und Quellen passend schalten
create or replace function public.set_categories(p_categories text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_owner();
  update public.settings set categories = coalesce(p_categories, '{}');
end $$;

-- ---------------------------------------------------------------------------
-- Funktionen für den Abrufdienst (nur service_role)
-- ---------------------------------------------------------------------------
create or replace function private.build_config() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'settings', (select to_jsonb(s) from public.settings s),
    'topics', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'kind', t.kind, 'name', t.name, 'keywords', t.keywords, 'exclude', t.exclude,
        'priority', t.priority, 'ticker', t.ticker, 'events', t.events)), '[]'::jsonb)
      from public.topics t where t.active),
    'weights', (select coalesce(jsonb_object_agg(w.term, round(ln((w.pos + 1.0) / (w.neg + 1.0))::numeric, 3)), '{}'::jsonb)
      from (select * from public.term_weights where pos + neg >= 2 order by (pos + neg) desc limit 400) w),
    'secrets', (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from private.secrets
                 where key in ('gemini_api_key', 'vapid_public_key', 'vapid_private_jwk'))
  );
$$;

create or replace function public.tick_begin(p_secret text, p_version bigint default 0, p_limit int default 20, p_lock_secs int default 55) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  st private.state;
  s public.settings;
  v_sources jsonb;
  v_prices jsonb;
  v_cfg jsonb;
  v_day_start timestamptz;
begin
  if p_secret is distinct from (select value from private.secrets where key = 'cron_secret') then
    return jsonb_build_object('denied', true);
  end if;
  if not exists (select 1 from private.owner) then
    return jsonb_build_object('idle', true);
  end if;
  update private.state set lock_until = now() + make_interval(secs => p_lock_secs)
   where lock_until is null or lock_until < now()
  returning * into st;
  if not found then
    return jsonb_build_object('busy', true);
  end if;
  select * into s from public.settings;

  with due as (
    select id from public.sources
     where enabled and not broken and next_fetch_at <= now()
     order by next_fetch_at
     limit p_limit
     for update skip locked
  ), upd as (
    update public.sources src
       set next_fetch_at = now() + make_interval(secs => src.interval_sec * (0.9 + random() * 0.2)),
           last_fetched_at = now()
      from due where src.id = due.id
    returning src.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'key', key, 'name', name, 'kind', kind, 'url', url, 'lang', lang, 'category', category,
      'weight', weight, 'breaking', breaking, 'etag', etag, 'last_modified', last_modified,
      'first', last_ok_at is null, 'topic_id', topic_id, 'fail_count', fail_count)), '[]'::jsonb)
    into v_sources from upd;

  if s.price_alerts then
    with due as (
      select ps.ticker from public.price_state ps
        join public.topics t on t.id = ps.topic_id and t.active and t.priority >= 2
       where ps.next_check_at <= now()
       order by ps.next_check_at limit 6
       for update of ps skip locked
    ), upd as (
      update public.price_state ps set next_check_at = now() + interval '55 seconds'
        from due where ps.ticker = due.ticker
      returning ps.*
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'ticker', u.ticker, 'topic_id', u.topic_id, 'price', u.price, 'prev_close', u.prev_close,
        'last_alert_at', u.last_alert_at, 'last_alert_price', u.last_alert_price,
        'day_alert_dir', u.day_alert_dir, 'day_alert_date', u.day_alert_date,
        'name', (select name from public.topics where id = u.topic_id),
        'priority', (select priority from public.topics where id = u.topic_id))), '[]'::jsonb)
      into v_prices from upd u;
  end if;

  if st.config_version <> p_version then
    v_cfg := private.build_config();
  end if;
  v_day_start := date_trunc('day', now() at time zone s.timezone) at time zone s.timezone;

  return jsonb_build_object(
    'version', st.config_version,
    'config', v_cfg,
    'sources', v_sources,
    'prices', coalesce(v_prices, '[]'::jsonb),
    'state', jsonb_build_object(
      'now', now(),
      'pushes_today', (select count(*) from public.push_log where sent_at >= v_day_start and kind in ('story', 'price')),
      'devices', (select count(*) from public.push_subscriptions),
      'llm_calls', case when st.llm_day = (now() at time zone 'UTC')::date then st.llm_calls else 0 end,
      'llm_paused_until', st.llm_paused_until,
      'last_digest_key', st.last_digest_key,
      'profile_version', st.profile_version,
      'rescore_pending', st.rescore_version < st.profile_version and st.profile_changed_at < now() - interval '20 seconds'
    )
  );
end $$;

create or replace function public.tick_end(p_secret text, p_results jsonb, p_info jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_ok boolean;
begin
  if p_secret is distinct from (select value from private.secrets where key = 'cron_secret') then
    raise exception 'forbidden';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    v_ok := coalesce((r ->> 'ok')::boolean, false);
    update public.sources src set
      last_status = (r ->> 'status')::int,
      last_error = case when v_ok then null else left(r ->> 'error', 300) end,
      fail_count = case when v_ok then 0 else src.fail_count + 1 end,
      broken = case when v_ok then false else (src.fail_count + 1 >= 40) end,
      last_ok_at = case when v_ok then now() else src.last_ok_at end,
      last_new_at = case when coalesce((r ->> 'new')::int, 0) > 0 then now() else src.last_new_at end,
      etag = case when v_ok and r ? 'etag' then r ->> 'etag' else src.etag end,
      last_modified = case when v_ok and r ? 'last_modified' then r ->> 'last_modified' else src.last_modified end,
      item_count = coalesce((r ->> 'items')::int, src.item_count),
      next_fetch_at = case when v_ok then src.next_fetch_at
        else now() + make_interval(secs => least(3600, src.interval_sec * power(2, least(src.fail_count + 1, 6)))) end
    where src.id = (r ->> 'id')::uuid;
  end loop;
  update private.state set lock_until = null, last_tick_at = now(),
    last_tick_ms = (p_info ->> 'ms')::int, last_tick_info = p_info;
end $$;

create or replace function public.known_hashes(p_hashes text[]) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(url_hash), '{}') from public.articles where url_hash = any (p_hashes);
$$;

-- Neue Artikel aufnehmen und zu Meldungen bündeln
create or replace function public.ingest(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  it jsonb;
  v_tokens text[];
  v_n int;
  v_story bigint;
  v_pub timestamptz;
  v_pubkey text;
  v_title_key text;
  v_backfill boolean;
  v_new boolean;
  v_touched bigint[] := '{}';
  v_created bigint[] := '{}';
  v_sim real;
  v_topic uuid;
begin
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if exists (select 1 from public.articles where url_hash = it ->> 'url_hash') then
      continue;
    end if;
    v_tokens := array(select jsonb_array_elements_text(coalesce(it -> 'tokens', '[]'::jsonb)));
    v_n := cardinality(v_tokens);
    v_pubkey := nullif(it ->> 'publisher_key', '');
    v_title_key := nullif(it ->> 'title_key', '');
    v_backfill := coalesce((it ->> 'backfill')::boolean, false);
    v_topic := nullif(it ->> 'topic_id', '')::uuid;
    begin
      v_pub := nullif(it ->> 'published_at', '')::timestamptz;
    exception when others then
      v_pub := null;
    end;
    if v_pub is not null and v_pub > now() + interval '5 minutes' then v_pub := now(); end if;
    v_story := null;
    v_new := false;

    -- 1) gleiche Schlagzeile vom selben Anbieter (z. B. über zwei Wege gefunden)
    if v_title_key is not null then
      select a.story_id into v_story from public.articles a
       where a.title_key = v_title_key and a.fetched_at > now() - interval '4 days' limit 1;
    end if;

    -- 2) ähnliche Schlagzeile: seltene gemeinsame Wörter zählen viel, Allerweltswörter wenig
    if v_story is null and v_n >= 2 then
      with w as (
        select t as token, private.idf(coalesce(d.df, 0)) as wt
          from unnest(v_tokens) t left join private.token_df d on d.token = t
      ), cand as (
        select a.id, a.story_id, a.tokens, a.published_at, a.fetched_at,
               (select count(*) from unnest(a.tokens) x where x = any (v_tokens)) as cnt
          from public.articles a
          join public.stories st on st.id = a.story_id
         where a.fetched_at > now() - interval '48 hours'
           and st.first_seen_at > now() - interval '48 hours'
           and st.kind = 'news'
           and a.tokens && v_tokens
      ), top as (
        select * from cand where cnt >= 2 order by cnt desc, fetched_at desc limit 40
      ), scored as (
        select top.story_id, top.cnt,
               abs(extract(epoch from (coalesce(top.published_at, top.fetched_at) - coalesce(v_pub, now())))) as dt,
               (select coalesce(sum(w.wt), 0) from w where w.token = any (top.tokens)) as s,
               (select coalesce(sum(private.idf(coalesce(d.df, 0))), 0)
                  from unnest(top.tokens) x left join private.token_df d on d.token = x) as wa,
               (select sum(wt) from w) as wb
          from top
      )
      select sc.story_id, (sc.s / nullif(least(sc.wa, sc.wb), 0))::real
        into v_story, v_sim
        from scored sc
       where (
              -- fast deckungsgleich
              (sc.cnt >= 3 and sc.s / nullif(least(sc.wa, sc.wb), 0) >= 0.8 and sc.dt < 36 * 3600)
              -- genügend seltene gemeinsame Wörter und zeitlich nah
              or (sc.s >= 1.2 and sc.s / nullif(least(sc.wa, sc.wb), 0) >= 0.5 and sc.dt < 12 * 3600)
             )
       order by sc.s desc, sc.cnt desc
       limit 1;
    end if;

    if v_story is null then
      insert into public.stories (title, summary, url, image_url, lang, category, source_name, publishers,
                                  max_weight, breaking, backfill, tokens, hints, published_at, sort_at)
      values (it ->> 'title', nullif(it ->> 'summary', ''), it ->> 'url', nullif(it ->> 'image', ''), it ->> 'lang',
              nullif(it ->> 'category', ''), it ->> 'publisher',
              case when v_pubkey is null then '{}'::text[] else array[v_pubkey] end,
              coalesce((it ->> 'weight')::real, 1), coalesce((it ->> 'breaking')::boolean, false), v_backfill,
              v_tokens, case when v_topic is null then '{}'::uuid[] else array[v_topic] end, v_pub,
              case when v_backfill then least(coalesce(v_pub, now()), now()) else now() end)
      returning id into v_story;
      v_new := true;
      v_created := v_created || v_story;
    else
      update public.stories st set
        article_count = st.article_count + 1,
        last_seen_at = now(),
        publishers = case when v_pubkey is null or v_pubkey = any (st.publishers) then st.publishers else st.publishers || v_pubkey end,
        source_count = greatest(1, cardinality(case when v_pubkey is null or v_pubkey = any (st.publishers) then st.publishers else st.publishers || v_pubkey end)),
        max_weight = greatest(st.max_weight, coalesce((it ->> 'weight')::real, 1)),
        breaking = st.breaking or coalesce((it ->> 'breaking')::boolean, false),
        backfill = st.backfill and v_backfill,
        image_url = coalesce(st.image_url, nullif(it ->> 'image', '')),
        summary = coalesce(nullif(st.summary, ''), nullif(it ->> 'summary', '')),
        category = coalesce(st.category, nullif(it ->> 'category', '')),
        hints = case when v_topic is null or v_topic = any (st.hints) then st.hints else st.hints || v_topic end
      where st.id = v_story;
    end if;

    insert into public.articles (story_id, source_id, publisher, publisher_key, url, url_hash, title, title_key,
                                 summary, image_url, lang, tokens, published_at)
    values (v_story, nullif(it ->> 'source_id', '')::uuid, it ->> 'publisher', v_pubkey, it ->> 'url', it ->> 'url_hash',
            it ->> 'title', v_title_key, nullif(it ->> 'summary', ''), nullif(it ->> 'image', ''), it ->> 'lang', v_tokens, v_pub)
    on conflict (url_hash) do nothing;

    insert into private.token_df (token, df)
    select t, 1 from unnest(v_tokens) t
    on conflict (token) do update set df = private.token_df.df + 1;

    if not (v_story = any (v_touched)) then v_touched := v_touched || v_story; end if;
  end loop;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', st.id, 'is_new', st.id = any (v_created), 'kind', st.kind, 'title', st.title, 'summary', st.summary,
      'lang', st.lang, 'category', st.category, 'source_name', st.source_name, 'publishers', st.publishers,
      'source_count', st.source_count, 'article_count', st.article_count, 'max_weight', st.max_weight,
      'breaking', st.breaking, 'backfill', st.backfill, 'tokens', st.tokens, 'hints', st.hints,
      'first_seen_at', st.first_seen_at, 'published_at', st.published_at, 'sort_at', st.sort_at,
      'importance', st.importance, 'relevance', st.relevance, 'tier', st.tier, 'matched', st.matched,
      'llm', st.llm, 'pushed_at', st.pushed_at, 'feedback', st.feedback, 'url', st.url)), '[]'::jsonb)
      from public.stories st where st.id = any (v_touched)
  );
end $$;

-- Bewertungen zurückschreiben
create or replace function public.apply_scores(p_rows jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_matched uuid[];
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_matched := array(select (jsonb_array_elements_text(coalesce(r -> 'matched', '[]'::jsonb)))::uuid);
    update public.stories st set
      importance = (r ->> 'importance')::real,
      relevance = (r ->> 'relevance')::real,
      score = (r ->> 'score')::real,
      tier = (r ->> 'tier')::smallint,
      event = r ->> 'event',
      matched = v_matched,
      reasons = coalesce(r -> 'reasons', '[]'::jsonb),
      llm = case when r ? 'llm' and jsonb_typeof(r -> 'llm') = 'object' then r -> 'llm' else st.llm end,
      llm_at = case when r ? 'llm' and jsonb_typeof(r -> 'llm') = 'object' and st.llm is null then now() else st.llm_at end,
      summary_ai = case when coalesce(r ->> 'summary_ai', '') <> '' then r ->> 'summary_ai' else st.summary_ai end
    where st.id = (r ->> 'id')::bigint;
    if coalesce((r ->> 'is_new')::boolean, false) and cardinality(v_matched) > 0 then
      update public.topics set last_matched_at = now(), match_count = match_count + 1 where id = any (v_matched);
    end if;
  end loop;
end $$;

-- Kandidaten für die KI-Bewertung, die noch offen sind
create or replace function public.llm_pending(p_limit int default 12) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', st.id, 'is_new', false, 'kind', st.kind, 'title', st.title, 'summary', st.summary,
      'lang', st.lang, 'category', st.category, 'source_name', st.source_name, 'publishers', st.publishers,
      'source_count', st.source_count, 'article_count', st.article_count, 'max_weight', st.max_weight,
      'breaking', st.breaking, 'backfill', st.backfill, 'tokens', st.tokens, 'hints', st.hints,
      'first_seen_at', st.first_seen_at, 'published_at', st.published_at, 'sort_at', st.sort_at,
      'importance', st.importance, 'relevance', st.relevance, 'tier', st.tier, 'matched', st.matched,
      'llm', st.llm, 'pushed_at', st.pushed_at, 'feedback', st.feedback, 'url', st.url)), '[]'::jsonb)
    from (select * from public.stories
           where llm is null and kind = 'news' and tier >= 2 and sort_at > now() - interval '6 hours'
           order by score desc limit p_limit) st;
$$;

-- Meldungen stapelweise neu bewerten (nach geänderten Einstellungen)
create or replace function public.rescore_batch(p_after_id bigint default 0, p_limit int default 400) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', st.id, 'is_new', false, 'kind', st.kind, 'title', st.title, 'summary', st.summary,
      'lang', st.lang, 'category', st.category, 'source_name', st.source_name, 'publishers', st.publishers,
      'source_count', st.source_count, 'article_count', st.article_count, 'max_weight', st.max_weight,
      'breaking', st.breaking, 'backfill', st.backfill, 'tokens', st.tokens, 'hints', st.hints,
      'first_seen_at', st.first_seen_at, 'published_at', st.published_at, 'sort_at', st.sort_at,
      'importance', st.importance, 'relevance', st.relevance, 'tier', st.tier, 'matched', st.matched,
      'llm', st.llm, 'pushed_at', st.pushed_at, 'feedback', st.feedback, 'url', st.url) order by st.id), '[]'::jsonb)
    from (select * from public.stories
           where id > p_after_id and kind = 'news' and sort_at > now() - interval '48 hours'
           order by id limit p_limit) st;
$$;

create or replace function public.rescore_done(p_version bigint) returns void
language sql security definer set search_path = '' as $$
  update private.state set rescore_version = greatest(rescore_version, p_version);
$$;

create or replace function public.service_config() returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.build_config() || jsonb_build_object(
    'version', (select config_version from private.state),
    'profile_version', (select profile_version from private.state),
    'cron_secret', (select value from private.secrets where key = 'cron_secret'),
    'has_owner', exists (select 1 from private.owner),
    'owner_id', (select user_id from private.owner));
$$;

create or replace function public.service_set_secret(p_key text, p_value text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_value is null or p_value = '' then
    delete from private.secrets where key = p_key;
  else
    insert into private.secrets (key, value) values (p_key, p_value)
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  if p_key = 'gemini_api_key' then
    update public.settings set has_gemini_key = coalesce(p_value, '') <> '';
    update private.state set llm_paused_until = null, llm_last_error = null;
  end if;
  perform private.bump_config();
end $$;

create or replace function public.service_claim_owner(p_user_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.owner (id, user_id) values (true, p_user_id) on conflict (id) do nothing;
  return (select user_id = p_user_id from private.owner);
end $$;

create or replace function public.service_llm_note(p_calls int, p_paused_until timestamptz default null, p_error text default null, p_ok boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare v_day date := (now() at time zone 'UTC')::date;
begin
  update private.state set
    llm_calls = case when llm_day = v_day then llm_calls + p_calls else p_calls end,
    llm_day = v_day,
    llm_paused_until = case when p_paused_until is not null then p_paused_until when p_ok then null else llm_paused_until end,
    llm_last_error = case when p_error is not null then left(p_error, 300) when p_ok then null else llm_last_error end,
    llm_last_ok_at = case when p_ok then now() else llm_last_ok_at end;
end $$;

create or replace function public.service_set_digest_key(p_key text) returns void
language sql security definer set search_path = '' as $$
  update private.state set last_digest_key = p_key;
$$;

create or replace function public.service_digest(p_since timestamptz) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'count', (select count(*) from public.stories where tier >= 2 and sort_at > p_since and read_at is null and kind = 'news'),
    'titles', (select coalesce(jsonb_agg(x.title), '[]'::jsonb) from (
        select title from public.stories where tier >= 2 and sort_at > p_since and read_at is null and kind = 'news'
        order by tier desc, score desc limit 3) x));
$$;

-- Tägliches Aufräumen
create or replace function private.housekeeping() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.stories
   where sort_at < now() - interval '10 days' and last_seen_at < now() - interval '7 days'
     and not saved and feedback is null;
  delete from public.push_log where sent_at < now() - interval '60 days';
  update private.token_df set df = df * 0.75;
  delete from private.token_df where df < 0.4;
end $$;

-- ---------------------------------------------------------------------------
-- Rechte
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  -- Dienst-Funktionen: nur service_role
  foreach f in array array[
    'tick_begin(text,bigint,int,int)', 'tick_end(text,jsonb,jsonb)', 'known_hashes(text[])', 'ingest(jsonb)',
    'apply_scores(jsonb)', 'llm_pending(int)', 'rescore_batch(bigint,int)', 'rescore_done(bigint)',
    'service_config()', 'service_set_secret(text,text)', 'service_claim_owner(uuid)',
    'service_llm_note(int,timestamptz,text,boolean)', 'service_set_digest_key(text)', 'service_digest(timestamptz)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- App-Funktionen: nur angemeldete Nutzer (und dort nur der Besitzer)
  foreach f in array array[
    'app_bootstrap()', 'feed_today()', 'feed_ticker(timestamptz,bigint,int,uuid,text,int,boolean)',
    'feed_new_count(timestamptz)', 'story_detail(bigint)', 'set_feedback(bigint,int,boolean)', 'toggle_saved(bigint)',
    'mark_seen()', 'mark_read(bigint[])', 'onboarding_samples(int)',
    'save_push_subscription(text,text,text,text)', 'delete_push_subscription(text)', 'system_status()',
    'set_categories(text[])', 'is_owner()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
