-- Briefing (morgens/abends/Wochenrückblick), Terminvorschau, „Dranbleiben“, Selbstjustierung, Wächter
alter table public.stories add column if not exists followed boolean not null default false;
alter table public.stories add column if not exists followed_at timestamptz;
alter table public.stories add column if not exists follow_of bigint references public.stories (id) on delete set null;
create index if not exists stories_follow_idx on public.stories (follow_of) where follow_of is not null;
create index if not exists stories_followed_idx on public.stories (followed_at) where followed;

create table if not exists public.briefings (
  id bigint generated always as identity primary key,
  kind text not null default 'tag',           -- 'tag' | 'woche'
  created_at timestamptz not null default now(),
  since timestamptz,
  data jsonb not null,
  read_at timestamptz
);
create index if not exists briefings_created_idx on public.briefings (created_at desc);

create table if not exists public.events (
  id bigint generated always as identity primary key,
  day date not null,
  title text not null,
  key text not null unique,
  story_id bigint references public.stories (id) on delete set null,
  importance real not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists events_day_idx on public.events (day);

alter table private.state add column if not exists last_briefing_key text;
alter table private.state add column if not exists last_watchdog_at timestamptz;
alter table private.state add column if not exists last_tune_at timestamptz;

do $$
declare t text;
begin
  foreach t in array array['briefings', 'events'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'owner_all') then
      execute format('create policy owner_all on public.%I for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()))', t);
    end if;
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

create or replace function private.story_json(s public.stories) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id,
    'kind', s.kind,
    'title', coalesce(nullif(s.title_de, ''), s.title),
    'title_orig', case when coalesce(s.title_de, '') <> '' then s.title else null end,
    'summary', left(coalesce(nullif(s.summary_ai, ''), s.summary, ''), 420),
    'ai', coalesce(s.summary_ai, '') <> '',
    'image', s.image_url,
    'lang', s.lang,
    'category', s.category,
    'source', s.source_name,
    'sources', s.source_count + coalesce((select sum(d.source_count) from public.stories d where d.dup_of = s.id), 0),
    'more', (select count(*) from public.stories d where d.dup_of = s.id),
    'at', s.sort_at,
    'tier', s.tier,
    'imp', round(s.importance::numeric),
    'event', s.event,
    'url', s.url,
    'read', s.read_at is not null,
    'fb', s.feedback,
    'saved', s.saved,
    'pushed', s.pushed_at is not null,
    'deep', s.deep is not null,
    'followed', s.followed,
    'update_of', (select coalesce(nullif(f.title_de, ''), f.title) from public.stories f where f.id = s.follow_of),
    'topics', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'emoji', t.emoji, 'kind', t.kind) order by t.priority desc, t.name), '[]'::jsonb)
               from public.topics t where t.id = any (s.matched))
  );
$$;

drop function if exists public.feed_today(timestamptz);
create or replace function public.feed_today(p_since timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.settings;
  v_since timestamptz;
  v_new jsonb; v_seen jsonb; v_today date;
begin
  perform private.require_owner();
  select * into s from public.settings;
  v_since := greatest(coalesce(p_since, s.last_seen_at, now() - interval '24 hours'), now() - interval '3 days');
  v_since := least(v_since, now() - interval '5 minutes');
  v_today := (now() at time zone s.timezone)::date;
  select coalesce(jsonb_agg(private.story_json(x.st) order by x.rank desc), '[]'::jsonb) into v_new
    from (select st, (case when st.tier = 3 then 1000 else 0 end + case when st.follow_of is not null then 500 else 0 end + st.importance * 0.6 + st.relevance * 0.4) as rank
            from public.stories st
           where st.tier >= 2 and st.dup_of is null and st.sort_at > v_since
           order by rank desc limit 60) x;
  select coalesce(jsonb_agg(private.story_json(x.st) order by x.at desc), '[]'::jsonb) into v_seen
    from (select st, st.sort_at as at
            from public.stories st
           where st.tier >= 2 and st.dup_of is null and st.sort_at <= v_since and st.sort_at > now() - interval '36 hours'
           order by (case when st.tier = 3 then 1000 else 0 end + st.importance) desc limit 20) x;
  return jsonb_build_object(
    'new', v_new, 'seen', v_seen,
    'since', v_since,
    'last_seen_at', s.last_seen_at,
    'now', now(),
    'last_tick_at', (select last_tick_at from private.state),
    'briefing', (select jsonb_build_object('id', b.id, 'kind', b.kind, 'created_at', b.created_at, 'data', b.data, 'read', b.read_at is not null)
                   from public.briefings b order by b.created_at desc limit 1),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'day', e.day, 'title', e.title, 'story_id', e.story_id) order by e.day, e.importance desc), '[]'::jsonb)
                 from (select * from public.events where day >= v_today and day <= v_today + 10 order by day, importance desc limit 14) e),
    'following', (select coalesce(jsonb_agg(private.story_json(f) order by f.followed_at desc), '[]'::jsonb)
                    from (select * from public.stories where followed and followed_at > now() - interval '21 days' order by followed_at desc limit 10) f)
  );
end $$;

create or replace function public.story_detail(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare st public.stories; v jsonb;
begin
  perform private.require_owner();
  update public.stories set read_at = coalesce(read_at, now()) where id = p_id returning * into st;
  if not found then return null; end if;
  update public.stories set read_at = coalesce(read_at, now()) where dup_of = p_id;
  update public.topics set last_opened_at = now() where id = any (st.matched);
  v := private.story_json(st);
  return v || jsonb_build_object(
    'reasons', st.reasons,
    'push_reason', st.push_reason,
    'summary_full', coalesce(st.summary, ''),
    'summary_ai', coalesce(st.summary_ai, ''),
    'first_seen_at', st.first_seen_at,
    'deep_data', st.deep,
    'follow_of', st.follow_of,
    'updates', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'title', coalesce(nullif(u.title_de, ''), u.title), 'summary', left(coalesce(nullif(u.summary_ai, ''), u.summary, ''), 300), 'at', u.sort_at) order by u.sort_at desc), '[]'::jsonb)
                  from public.stories u where u.follow_of = p_id),
    'articles', (
      select coalesce(jsonb_agg(jsonb_build_object('publisher', a.publisher, 'title', a.title, 'url', a.url, 'at', coalesce(a.published_at, a.fetched_at), 'lang', a.lang) order by coalesce(a.published_at, a.fetched_at)), '[]'::jsonb)
      from (select distinct on (coalesce(publisher_key, url_hash)) * from public.articles
             where story_id = p_id or story_id in (select id from public.stories where dup_of = p_id)
            order by coalesce(publisher_key, url_hash), coalesce(published_at, fetched_at)) a)
  );
end $$;

create or replace function public.toggle_follow(p_id bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v boolean;
begin
  perform private.require_owner();
  update public.stories set followed = not followed, followed_at = case when followed then null else now() end
   where id = p_id returning followed into v;
  return v;
end $$;

create or replace function public.briefing_read(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_owner();
  update public.briefings set read_at = coalesce(read_at, now()) where id = p_id;
end $$;

-- Bewertungen zurückschreiben (jetzt auch: Update zu einem verfolgten Ereignis)
create or replace function public.apply_scores(p_rows jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_matched uuid[]; v_dup bigint; v_follow bigint;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_matched := array(select (jsonb_array_elements_text(coalesce(r -> 'matched', '[]'::jsonb)))::uuid);
    v_dup := nullif(r ->> 'dup_of', '')::bigint;
    if v_dup is not null then
      select coalesce(d.dup_of, d.id) into v_dup from public.stories d where d.id = v_dup;
      if v_dup = (r ->> 'id')::bigint then v_dup := null; end if;
    end if;
    v_follow := nullif(r ->> 'follow_of', '')::bigint;
    if v_follow = (r ->> 'id')::bigint then v_follow := null; end if;
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
      summary_ai = case when coalesce(r ->> 'summary_ai', '') <> '' then r ->> 'summary_ai' else st.summary_ai end,
      title_de = case when coalesce(r ->> 'title_de', '') <> '' then r ->> 'title_de' else st.title_de end,
      dup_of = case when r ? 'dup_of' then v_dup else st.dup_of end,
      follow_of = case when r ? 'follow_of' then v_follow else st.follow_of end
    where st.id = (r ->> 'id')::bigint;
    if coalesce((r ->> 'is_new')::boolean, false) and cardinality(v_matched) > 0 then
      update public.topics set last_matched_at = now(), match_count = match_count + 1 where id = any (v_matched);
    end if;
  end loop;
end $$;

-- Verfolgte Ereignisse (für die KI: Meldet diese Meldung eine neue Entwicklung dazu?)
create or replace function public.followed_list() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', coalesce(nullif(x.title_de, ''), x.title))), '[]'::jsonb)
    from (select id, title, title_de from public.stories where followed and followed_at > now() - interval '21 days' order by followed_at desc limit 12) x;
$$;

-- Was die KI noch einordnen soll: Wichtiges – und alles, was zu einem verfolgten Ereignis gehören könnte
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
    from (select s.*, w.hit from public.stories s
           cross join lateral (select exists (
               select 1 from public.stories f, unnest(f.tokens) a, unnest(s.tokens) b
                where f.followed and f.followed_at > now() - interval '21 days' and f.id <> s.id and s.first_seen_at > f.followed_at
                  and ((a = b and length(a) >= 4) or (length(a) >= 5 and length(b) >= 5 and (a like b || '%' or b like a || '%')))) as hit) w
           where s.llm is null and s.kind = 'news' and s.sort_at > now() - interval '6 hours'
             and (s.tier >= 2 or (s.tier >= 1 and w.hit))
           order by w.hit desc, s.score desc limit p_limit) st;
$$;

-- Stoff für das Briefing: das Wichtigste aus allen Bereichen, jedes Ereignis einmal
create or replace function public.briefing_material(p_since timestamptz, p_limit int default 70) returns jsonb
language sql stable security definer set search_path = '' as $$
  -- Zwei Töpfe: (1) worüber die meisten Medien berichten – das objektiv Große, egal ob eigenes Thema;
  -- (2) das Wichtigste zu den eigenen Themen.
  with base as (
    select st.* from public.stories st
     where st.kind = 'news' and st.tier >= 1 and st.dup_of is null and st.sort_at > p_since and length(st.title) > 20
  ), welt as (
    select id from base where source_count >= 3
     order by source_count desc, importance desc limit greatest(10, (p_limit * 0.6)::int)
  ), mein as (
    select id from base where tier >= 2 and id not in (select id from welt)
     order by (importance + least(source_count, 6) * 5 + case when tier >= 3 then 15 else 0 end) desc
     limit greatest(8, p_limit - (select count(*) from welt)::int)
  )
  select jsonb_build_object(
    'stories', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'titel', coalesce(nullif(x.title_de, ''), x.title), 'text', left(coalesce(nullif(x.summary_ai, ''), x.summary, ''), 380),
        'quelle', x.source_name, 'quellen', x.source_count, 'wichtigkeit', round(x.importance::numeric),
        'mein_thema', x.tier >= 2, 'zeit', x.sort_at) order by x.source_count desc, x.importance desc), '[]'::jsonb)
      from base x where x.id in (select id from welt union all select id from mein)),
    'termine', (select coalesce(jsonb_agg(jsonb_build_object('tag', e.day, 'was', e.title) order by e.day), '[]'::jsonb)
                  from (select * from public.events where day >= current_date and day <= current_date + 7 order by day, importance desc limit 10) e),
    'last_key', (select last_briefing_key from private.state)
  );
$$;

create or replace function public.briefing_save(p_kind text, p_since timestamptz, p_data jsonb, p_key text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v bigint;
begin
  insert into public.briefings (kind, since, data) values (p_kind, p_since, p_data) returning id into v;
  if p_key is not null then update private.state set last_briefing_key = p_key where id; end if;
  delete from public.briefings where created_at < now() - interval '30 days';
  return v;
end $$;

create or replace function public.service_set_briefing_key(p_key text) returns void
language sql security definer set search_path = '' as $$
  update private.state set last_briefing_key = p_key where id;
$$;

-- Selbstjustierung: Werden Pushes kaum geöffnet, die Schwelle behutsam anheben; werden fast alle geöffnet, leicht senken
create or replace function private.tune_push() returns void
language plpgsql security definer set search_path = '' as $$
declare r record; v_rate numeric;
begin
  if (select last_tune_at from private.state) > now() - interval '20 hours' then return; end if;
  for r in
    select case when exists (select 1 from public.topics t where t.id = any (s.matched) and t.kind = 'stock') then 'stocks'
                when cardinality(s.matched) > 0 then 'topics' else 'world' end as domain,
           count(*) as n, count(*) filter (where s.read_at is not null) as opened
      from public.stories s
     where s.pushed_at > now() - interval '7 days' and s.pushed_at < now() - interval '12 hours' and s.kind = 'news'
     group by 1
  loop
    if r.n < 6 then continue; end if;
    v_rate := r.opened::numeric / r.n;
    if v_rate < 0.3 then
      if r.domain = 'stocks' then update public.settings set thr_stocks = least(85, thr_stocks + 2) where id;
      elsif r.domain = 'topics' then update public.settings set thr_topics = least(85, thr_topics + 2) where id;
      else update public.settings set thr_world = least(92, thr_world + 2) where id; end if;
    elsif v_rate > 0.8 then
      if r.domain = 'stocks' then update public.settings set thr_stocks = thr_stocks - 1 where id;
      elsif r.domain = 'topics' then update public.settings set thr_topics = thr_topics - 1 where id;
      else update public.settings set thr_world = thr_world - 1 where id; end if;
    end if;
  end loop;
  update private.state set last_tune_at = now() where id;
end $$;

create or replace function private.housekeeping() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.stories
   where sort_at < now() - interval '10 days' and last_seen_at < now() - interval '7 days'
     and not saved and feedback is null and not followed;
  delete from public.push_log where sent_at < now() - interval '60 days';
  delete from public.events where day < current_date - 2;
  update public.stories set followed = false where followed and followed_at < now() - interval '21 days';
  update private.token_df set df = df * 0.75 where true;
  delete from private.token_df where df < 0.4;
  perform private.tune_push();
end $$;

-- Wächter: Steht der Abruf, den Dienst anstoßen, damit er dich warnt
create or replace function private.watchdog() returns void
language plpgsql security definer set search_path = '' as $$
declare st private.state; v_url text; v_secret text;
begin
  select * into st from private.state;
  if not exists (select 1 from private.owner) then return; end if;
  if st.last_tick_at is not null and st.last_tick_at > now() - interval '10 minutes' then return; end if;
  if st.last_watchdog_at is not null and st.last_watchdog_at > now() - interval '6 hours' then return; end if;
  select value into v_url from private.secrets where key = 'function_url';
  select value into v_secret from private.secrets where key = 'cron_secret';
  if v_url is null then return; end if;
  update private.state set last_watchdog_at = now(), lock_until = null where id;
  perform net.http_post(url := v_url || '?action=watchdog',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb, timeout_milliseconds := 8000);
end $$;

do $$
declare f text;
begin
  foreach f in array array['followed_list()', 'briefing_material(timestamptz,int)', 'briefing_save(text,timestamptz,jsonb,text)', 'service_set_briefing_key(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['feed_today(timestamptz)', 'toggle_follow(bigint)', 'briefing_read(bigint)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
