-- Überarbeitung: jedes Ereignis nur einmal, nur wirklich Neues, deutsche Überschriften,
-- ausführliche Zusammenfassung mit Folgen und Einschätzung.
alter table public.stories add column if not exists title_de text;
alter table public.stories add column if not exists dup_of bigint references public.stories (id) on delete set null;
alter table public.stories add column if not exists deep jsonb;
alter table public.stories add column if not exists deep_at timestamptz;
create index if not exists stories_dup_idx on public.stories (dup_of) where dup_of is not null;

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
    'topics', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'emoji', t.emoji, 'kind', t.kind) order by t.priority desc, t.name), '[]'::jsonb)
               from public.topics t where t.id = any (s.matched))
  );
$$;

-- Startseite: Neues seit dem letzten Besuch (jedes Ereignis einmal), darunter schon Gesehenes
drop function if exists public.feed_today();
create or replace function public.feed_today(p_since timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.settings;
  v_since timestamptz;
  v_new jsonb; v_seen jsonb;
begin
  perform private.require_owner();
  select * into s from public.settings;
  -- höchstens drei Tage zurück, mindestens die letzten zwei Stunden
  v_since := greatest(coalesce(p_since, s.last_seen_at, now() - interval '24 hours'), now() - interval '3 days');
  v_since := least(v_since, now() - interval '5 minutes');
  select coalesce(jsonb_agg(private.story_json(x.st) order by x.rank desc), '[]'::jsonb) into v_new
    from (select st, (case when st.tier = 3 then 1000 else 0 end + st.importance * 0.6 + st.relevance * 0.4) as rank
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
    'last_tick_at', (select last_tick_at from private.state)
  );
end $$;

create or replace function public.feed_new_count(p_since timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_owner();
  return jsonb_build_object(
    'important', (select count(*) from public.stories where tier >= 2 and dup_of is null and first_seen_at > p_since and not backfill),
    'top', (select count(*) from public.stories where tier = 3 and dup_of is null and first_seen_at > p_since and not backfill),
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
    'articles', (
      select coalesce(jsonb_agg(jsonb_build_object('publisher', a.publisher, 'title', a.title, 'url', a.url, 'at', coalesce(a.published_at, a.fetched_at), 'lang', a.lang) order by coalesce(a.published_at, a.fetched_at)), '[]'::jsonb)
      from (select distinct on (coalesce(publisher_key, url_hash)) * from public.articles
             where story_id = p_id or story_id in (select id from public.stories where dup_of = p_id)
            order by coalesce(publisher_key, url_hash), coalesce(published_at, fetched_at)) a)
  );
end $$;

create or replace function public.apply_scores(p_rows jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_matched uuid[]; v_dup bigint;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_matched := array(select (jsonb_array_elements_text(coalesce(r -> 'matched', '[]'::jsonb)))::uuid);
    v_dup := nullif(r ->> 'dup_of', '')::bigint;
    -- keine Ketten und kein Verweis auf sich selbst
    if v_dup is not null then
      select coalesce(d.dup_of, d.id) into v_dup from public.stories d where d.id = v_dup;
      if v_dup = (r ->> 'id')::bigint then v_dup := null; end if;
    end if;
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
      dup_of = case when r ? 'dup_of' then v_dup else st.dup_of end
    where st.id = (r ->> 'id')::bigint;
    if coalesce((r ->> 'is_new')::boolean, false) and cardinality(v_matched) > 0 then
      update public.topics set last_matched_at = now(), match_count = match_count + 1 where id = any (v_matched);
    end if;
  end loop;
end $$;

-- Schon gemeldete Ereignisse der letzten Stunden (damit die KI Wiederholungen erkennt)
create or replace function public.recent_reported(p_limit int default 30) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', coalesce(nullif(x.title_de, ''), x.title), 'at', x.sort_at)), '[]'::jsonb)
    from (select id, title, title_de, sort_at from public.stories
           where tier >= 2 and dup_of is null and llm is not null and kind = 'news' and sort_at > now() - interval '48 hours'
           order by (case when tier = 3 then 100 else 0 end + importance) desc, sort_at desc limit p_limit) x;
$$;

do $$
begin
  revoke all on function public.recent_reported(int) from public, anon, authenticated;
  grant execute on function public.recent_reported(int) to service_role;
  revoke all on function public.feed_today(timestamptz) from public, anon;
  grant execute on function public.feed_today(timestamptz) to authenticated, service_role;
end $$;
