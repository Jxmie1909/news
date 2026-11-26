// Ein Durchlauf: fällige Quellen abrufen → neue Artikel bündeln → bewerten → Push senden.
import { admin, rpc } from "./db.ts";
import { fetchSource, type FetchResult, isGoogleNewsUrl, type RawItem, type SourceRow } from "./feeds.ts";
import { LlmError, listModels, pickModel, scoreStories } from "./llm.ts";
import { evaluateChart, fetchChart, pctText, type PriceDue, priceText } from "./prices.ts";
import { deliver, type PushMessage } from "./push.ts";
import {
  analyze, type Analysis, compile, type Compiled, EVENT_LABELS, finalize, inQuietHours, type LlmVerdict, localParts,
  parseHHMM, type Story, type Verdict,
} from "./score.ts";
import { hash, normalize, normalizeUrl, publisherKeyFromName, publisherKeyFromUrl, titleKey, tokenize, truncate } from "./text.ts";

interface TickState {
  now: string;
  pushes_today: number;
  devices: number;
  llm_calls: number;
  llm_paused_until: string | null;
  last_digest_key: string | null;
  profile_version: number;
  rescore_pending: boolean;
}

const cache: { version: number; cfg: Compiled | null; seen: Set<string>; lastLlmAt: number; tickNo: number } = {
  version: 0, cfg: null, seen: new Set(), lastLlmAt: 0, tickNo: 0,
};

export function resetCache(): void {
  cache.version = 0;
  cache.cfg = null;
}

const SECTION_SUFFIX = /\s+(Inland|Ausland|Politik|Wirtschaft|Börse|Wissen|Amerika|Verbraucher|Gesundheit|Markets|Technology|Business|World|Politics|Sport|Health|AI|KI|Autos|Eilmeldungen|US & Canada|F1|Schlagzeilen|Top Stories|\(EN\)|\(Top\))$/;

export function displayPublisher(name: string): string {
  return name.replace(/^Google News · /, "").replace(SECTION_SUFFIX, "").trim();
}

export interface IngestItem {
  source_id: string;
  topic_id: string | null;
  publisher: string;
  publisher_key: string;
  url: string;
  url_hash: string;
  title: string;
  title_key: string;
  summary: string;
  image: string | null;
  published_at: string | null;
  lang: string;
  category: string | null;
  weight: number;
  breaking: boolean;
  backfill: boolean;
  tokens: string[];
}

const BREAKING_PREFIX = /^\s*(\+\+\+|eil\b|eilmeldung\b|breaking\b|just in\b)/i;

export function buildItem(src: SourceRow, raw: RawItem, nowMs = Date.now()): IngestItem | null {
  const url = normalizeUrl(raw.url);
  let title = raw.title.replace(/^\s*\+\+\+\s*/, "").replace(/\s*\+\+\+\s*$/, "").replace(/\s+/g, " ").trim();
  if (title.length < 12) return null;
  title = truncate(title, 240);
  // Suchtreffer und Google-News-Einträge nennen den eigentlichen Anbieter selbst
  const viaGoogle = src.kind === "gnews" || isGoogleNewsUrl(url);
  let publisher = raw.publisher || displayPublisher(src.name);
  let pkey = "";
  if (viaGoogle) {
    pkey = (raw.publisher_url ? publisherKeyFromUrl(raw.publisher_url) : "") || publisherKeyFromName(raw.publisher || "");
    if (!raw.publisher && raw.publisher_url) publisher = pkey || publisher;
  } else if (src.kind === "sec") {
    pkey = "sec";
  } else if (src.kind === "bluesky") {
    publisher = displayPublisher(src.name);
    pkey = publisherKeyFromName(publisher);
  } else {
    publisher = displayPublisher(src.name);
    pkey = publisherKeyFromName(publisher) || publisherKeyFromUrl(url);
  }
  if (!pkey) pkey = publisherKeyFromName(publisher) || "unbekannt";
  const tokens = tokenize(title);
  if (tokens.length === 0) return null;
  let backfill = !!src.first;
  if (raw.published_at) {
    const age = nowMs - Date.parse(raw.published_at);
    if (age > 4 * 86400_000) return null;
    if (age > 6 * 3600_000) backfill = true;
  }
  return {
    source_id: src.id,
    topic_id: src.topic_id,
    publisher,
    publisher_key: pkey,
    url,
    url_hash: hash(url),
    title,
    title_key: titleKey(pkey, title),
    summary: raw.summary || "",
    image: raw.image,
    published_at: raw.published_at,
    lang: src.lang,
    category: src.category && src.category !== "top" ? src.category : null,
    weight: src.weight,
    breaking: src.breaking || BREAKING_PREFIX.test(raw.title),
    backfill,
    tokens,
  };
}

function freshForPush(st: Story, nowMs: number): boolean {
  if (st.backfill || st.pushed_at || st.kind !== "news") return false;
  if (nowMs - Date.parse(st.first_seen_at) > 120 * 60_000) return false;
  if (st.published_at && nowMs - Date.parse(st.published_at) > 6 * 3600_000) return false;
  return true;
}

/** Bei gleicher Wichtigkeit die Fassung in der bevorzugten Sprache zuerst. */
function langRank(st: Story, cfg: Compiled): number {
  const i = (cfg.settings.languages ?? []).indexOf(st.lang ?? "");
  return i < 0 ? 9 : i;
}

/** Wurde zu diesem Ereignis gerade schon ein Push gesendet? */
export function sameEvent(prev: { matched: string[]; event: string | null; tokens: string[] }, st: Story, v: Verdict): boolean {
  const shared = (st.tokens ?? []).filter((t) => (prev.tokens ?? []).includes(t)).length;
  if (shared >= 3) return true;
  const sameTopic = v.matched.some((id) => (prev.matched ?? []).includes(id));
  if (sameTopic && prev.event === v.event) return true;
  if (sameTopic && shared >= 2) return true;
  // Großes Ereignis ohne eigenes Thema: gleiche Art kurz hintereinander ist fast immer dieselbe Nachricht
  if (!v.matched.length && !(prev.matched ?? []).length && v.event && prev.event === v.event) return true;
  return false;
}

function pushAllowed(cfg: Compiled, state: TickState, domain: string, importance: number): string | null {
  const s = cfg.settings;
  if (!s.push_enabled) return "Push ist ausgeschaltet";
  if (state.devices === 0 && !s.ntfy_enabled) return "kein Gerät angemeldet";
  // Ruhezeit gilt ohne Ausnahme (außer Aktien, wenn ausdrücklich erlaubt)
  if (inQuietHours(s) && !(domain === "stocks" && s.quiet_allow_stocks)) return "Ruhezeit";
  // Tageslimit: ganz große Ereignisse kommen trotzdem durch, außer das Limit steht auf 0
  if (state.pushes_today >= s.push_max_per_day && (s.push_max_per_day === 0 || importance < 92)) return "Tageslimit erreicht";
  return null;
}

function storyMessage(st: Story, v: Verdict): PushMessage {
  const label = v.event && EVENT_LABELS[v.event] ? EVENT_LABELS[v.event] : null;
  const head = v.pushTopic ? v.pushTopic.name : "Eilmeldung";
  const title = label ? `${head} · ${label}` : head;
  const src = st.source_count >= 2 ? `${st.source_name ?? ""} + ${st.source_count - 1} weitere`.trim() : (st.source_name ?? "");
  const reason = v.pushTopic
    ? `Thema „${v.pushTopic.name}“, Wichtigkeit ${Math.round(v.importance)}`
    : `Großes Ereignis, Wichtigkeit ${Math.round(v.importance)}`;
  return {
    kind: "story",
    title: truncate(title, 60),
    body: truncate(st.title, 170) + (src ? ` (${src})` : ""),
    storyId: st.id,
    reason,
    urgent: v.importance >= 85,
  };
}

function llmState(cfg: Compiled, state: TickState): { usable: boolean; key: string } {
  const key = cfg.raw.secrets?.gemini_api_key ?? "";
  const s = cfg.settings;
  const paused = state.llm_paused_until && Date.parse(state.llm_paused_until) > Date.now();
  return { usable: !!key && s.llm_enabled && !paused && state.llm_calls < s.llm_daily_budget, key };
}

function nextPacificMidnight(): Date {
  const p = localParts("America/Los_Angeles");
  const minsLeft = 24 * 60 - p.minutes + 2;
  return new Date(Date.now() + minsLeft * 60_000);
}

async function runLlm(cfg: Compiled, state: TickState, batch: Story[]): Promise<Map<number, LlmVerdict>> {
  const { key } = llmState(cfg, state);
  try {
    const map = await scoreStories(key, cfg.settings.llm_model, cfg, batch);
    cache.lastLlmAt = Date.now();
    state.llm_calls++;
    await rpc("service_llm_note", { p_calls: 1, p_ok: true });
    return map;
  } catch (e) {
    const err = e instanceof LlmError ? e : new LlmError(e instanceof Error ? e.message : String(e), 0);
    let until = new Date(Date.now() + 120_000);
    let note = err.message;
    if (err.status === 429) {
      until = err.daily ? nextPacificMidnight() : new Date(Date.now() + Math.min(900, Math.max(30, err.retryAfterSec ?? 60)) * 1000);
      note = err.daily ? "Tageskontingent bei Gemini aufgebraucht, weiter ab morgen" : "Gemini kurz gedrosselt";
    } else if (err.status === 404) {
      // Modell gibt es nicht (mehr): ein passendes suchen
      try {
        const model = pickModel(await listModels(key));
        if (model && model !== cfg.settings.llm_model) {
          await admin.from("settings").update({ llm_model: model }).eq("id", true);
          note = `Modell gewechselt auf ${model}`;
          until = new Date(Date.now() + 20_000);
        }
      } catch { /* bleibt pausiert */ }
    } else if (err.status === 400 || err.status === 401 || err.status === 403) {
      until = new Date(Date.now() + 30 * 60_000);
      note = "Gemini-Schlüssel wird nicht akzeptiert: " + err.message;
    }
    state.llm_paused_until = until.toISOString();
    await rpc("service_llm_note", { p_calls: 1, p_paused_until: until.toISOString(), p_error: note });
    return new Map();
  }
}

/** Meldungen bewerten (mit KI, wenn sinnvoll und verfügbar) und zurückschreiben. */
async function scoreAndApply(cfg: Compiled, state: TickState, affected: Story[], opts: { allowLlm: boolean; allowPush: boolean }): Promise<{ pushed: number; llm: number }> {
  const nowMs = Date.now();
  const analyses = new Map<number, Analysis>();
  const prelim = new Map<number, Verdict>();
  for (const st of affected) {
    const a = analyze(st, cfg);
    analyses.set(st.id, a);
    prelim.set(st.id, finalize(st, a, cfg));
  }

  let llmMap = new Map<number, LlmVerdict>();
  let llmCalls = 0;
  const ls = llmState(cfg, state);
  if (opts.allowLlm && ls.usable) {
    const open = affected.filter((st) => !st.llm && st.kind === "news" && nowMs - Date.parse(st.sort_at) < 6 * 3600_000 && prelim.get(st.id)!.tier > 0);
    const urgent = open.filter((st) => {
      const v = prelim.get(st.id)!, a = analyses.get(st.id)!;
      if (!freshForPush(st, nowMs)) return false;
      return v.pushEligible || a.matches.some((m) => m.topic.priority === 3 && m.strength === "title") || v.importance >= cfg.settings.thr_world - 10;
    });
    const normal = open.filter((st) => !urgent.includes(st) && (prelim.get(st.id)!.tier >= 2 || st.source_count >= 3));
    const s = cfg.settings;
    const dayFrac = (new Date().getUTCHours() * 60 + new Date().getUTCMinutes()) / 1440;
    const paceOk = state.llm_calls < s.llm_daily_budget * Math.min(1, dayFrac + 0.2) && nowMs - cache.lastLlmAt > 40_000;
    let batch: Story[] = [];
    if (urgent.length) {
      urgent.sort((a, b) => prelim.get(b.id)!.importance - prelim.get(a.id)!.importance);
      batch = urgent.slice(0, 12);
      if (batch.length < 12) batch = batch.concat(normal.slice(0, 12 - batch.length));
    } else if (paceOk && normal.length) {
      normal.sort((a, b) => prelim.get(b.id)!.score - prelim.get(a.id)!.score);
      batch = normal.slice(0, 12);
    }
    if (batch.length) {
      llmMap = await runLlm(cfg, state, batch);
      llmCalls = 1;
    }
  }

  const verdicts: Verdict[] = affected.map((st) => (llmMap.has(st.id) ? finalize(st, analyses.get(st.id)!, cfg, llmMap.get(st.id)) : prelim.get(st.id)!));
  for (let i = 0; i < verdicts.length; i += 200) {
    await rpc("apply_scores", { p_rows: verdicts.slice(i, i + 200) });
  }

  let pushed = 0;
  if (opts.allowPush) {
    const byId = new Map(affected.map((s) => [s.id, s]));
    const cands = verdicts.filter((v) => v.tier === 3 && v.pushEligible && freshForPush(byId.get(v.id)!, nowMs))
      .sort((a, b) => (b.importance - a.importance) || (langRank(byId.get(a.id)!, cfg) - langRank(byId.get(b.id)!, cfg))).slice(0, 3);
    if (cands.length) {
      // Dasselbe Ereignis nicht doppelt melden (z. B. einmal deutsch, einmal englisch)
      const { data: recentRows } = await admin.from("stories").select("id,matched,event,tokens")
        .gt("pushed_at", new Date(nowMs - 45 * 60_000).toISOString()).eq("kind", "news");
      const recent: { id: number; matched: string[]; event: string | null; tokens: string[] }[] = recentRows ?? [];
      for (const v of cands) {
        const st = byId.get(v.id)!;
        if (recent.some((r) => r.id !== st.id && sameEvent(r, st, v))) continue;
        const blocked = pushAllowed(cfg, state, v.domain, v.importance);
        if (blocked) continue;
        await deliver(cfg, storyMessage(st, v));
        recent.push({ id: st.id, matched: v.matched, event: v.event, tokens: st.tokens });
        state.pushes_today++;
        pushed++;
      }
    }
  }
  return { pushed, llm: llmCalls };
}

async function checkPrices(cfg: Compiled, state: TickState, due: PriceDue[]): Promise<number> {
  let alerts = 0;
  const s = cfg.settings;
  await Promise.all(due.map(async (d) => {
    try {
      const json = await fetchChart(d.ticker);
      const r = evaluateChart(json, d, Number(s.price_move_pct) || 3, s.price_window_min || 10);
      // deno-lint-ignore no-explicit-any
      const upd: Record<string, any> = { updated_at: new Date().toISOString(), error: r.ok ? null : (r.error ?? "Fehler") };
      if (r.price != null) upd.price = r.price;
      if (r.prev_close != null) upd.prev_close = r.prev_close;
      if (r.currency) upd.currency = r.currency;
      if (r.alert && r.price != null) {
        const al = r.alert;
        const arrow = al.dir < 0 ? "📉" : "📈";
        const title = al.kind === "move"
          ? `${arrow} ${d.name} ${pctText(al.movePct)} in ${al.windowMin} Min`
          : `${arrow} ${d.name} heute ${pctText(al.movePct)}`;
        const body = `Kurs ${priceText(r.price, r.currency ?? "")}` + (al.kind === "move" && al.dayPct != null ? ` · heute ${pctText(al.dayPct)}` : "");
        if (al.kind === "move") {
          upd.last_alert_at = new Date().toISOString();
          upd.last_alert_price = r.price;
        }
        // Ist die Tagesbewegung schon groß, gilt sie mit diesem Alarm als gemeldet
        const dayCovered = al.kind === "day" || (al.dayPct != null && Math.abs(al.dayPct) >= (Number(s.price_move_pct) || 3) * 2 && Math.sign(al.dayPct) === al.dir);
        upd.day_alert_dir = dayCovered ? al.dir : d.day_alert_dir;
        upd.day_alert_date = dayCovered ? al.date : d.day_alert_date;
        const { data: story } = await admin.from("stories").insert({
          kind: "price", title, summary: body + ". Kursdaten von Yahoo Finance, ohne Gewähr.", url: `https://finance.yahoo.com/quote/${encodeURIComponent(d.ticker)}`,
          lang: "de", category: "boerse", source_name: "Kursalarm", importance: 80, relevance: 95, score: 88, tier: 3,
          matched: [d.topic_id], event: "price", reasons: [`Kursalarm für „${d.name}“`], tokens: [normalize(d.ticker)],
        }).select("id").single();
        const blocked = d.priority < 3 ? "nur in der App" : pushAllowed(cfg, state, "stocks", 80);
        if (!blocked && story) {
          await deliver(cfg, { kind: "price", title, body, storyId: story.id, reason: `Kursalarm ab ${s.price_move_pct} %`, urgent: true });
          state.pushes_today++;
        }
        alerts++;
      }
      await admin.from("price_state").update(upd).eq("ticker", d.ticker);
    } catch (e) {
      await admin.from("price_state").update({ error: (e instanceof Error ? e.message : String(e)).slice(0, 200), updated_at: new Date().toISOString() }).eq("ticker", d.ticker);
    }
  }));
  return alerts;
}

async function maybeDigest(cfg: Compiled, state: TickState): Promise<boolean> {
  const s = cfg.settings;
  if (!s.digest_enabled || !s.push_enabled || !(s.digest_times ?? []).length) return false;
  if (state.devices === 0 && !s.ntfy_enabled) return false;
  const lp = localParts(s.timezone);
  for (const t of s.digest_times) {
    const m = parseHHMM(t);
    if (m == null) continue;
    if (lp.minutes >= m && lp.minutes < m + 20) {
      const key = `${lp.date} ${t}`;
      if (state.last_digest_key === key) return false;
      await rpc("service_set_digest_key", { p_key: key });
      state.last_digest_key = key;
      const d = await rpc("service_digest", { p_since: new Date(Date.now() - 14 * 3600_000).toISOString() });
      if (!d || d.count === 0) return false;
      const titles: string[] = d.titles ?? [];
      await deliver(cfg, {
        kind: "digest",
        title: d.count === 1 ? "Dein Digest: 1 wichtige Meldung" : `Dein Digest: ${d.count} wichtige Meldungen`,
        body: titles.map((x) => "• " + truncate(x, 80)).join("\n"),
        reason: `Digest ${t} Uhr`,
      });
      return true;
    }
  }
  return false;
}

/** Nach geänderten Themen/Einstellungen: Meldungen der letzten 2 Tage neu einordnen (ohne Push). */
export async function rescoreAll(cfg: Compiled, state: TickState): Promise<number> {
  let after = 0, total = 0;
  for (let i = 0; i < 30; i++) {
    const rows: Story[] = await rpc("rescore_batch", { p_after_id: after, p_limit: 400 });
    if (!rows?.length) break;
    await scoreAndApply(cfg, state, rows, { allowLlm: false, allowPush: false });
    total += rows.length;
    after = rows[rows.length - 1].id;
    if (rows.length < 400) break;
  }
  await rpc("rescore_done", { p_version: state.profile_version });
  return total;
}

export async function loadConfig(): Promise<{ cfg: Compiled; version: number; profile_version: number; cron_secret: string; has_owner: boolean; owner_id: string | null }> {
  const raw = await rpc("service_config");
  const cfg = compile(raw);
  return { cfg, version: raw.version, profile_version: raw.profile_version, cron_secret: raw.cron_secret, has_owner: raw.has_owner, owner_id: raw.owner_id };
}

export interface TickReport {
  status: "ok" | "denied" | "busy" | "idle" | "error";
  ms?: number;
  sources?: number;
  failed?: number;
  items?: number;
  stories?: number;
  pushed?: number;
  llm?: number;
  alerts?: number;
  rescored?: number;
  error?: string;
}

export async function runTick(secret: string): Promise<TickReport> {
  const t0 = Date.now();
  cache.tickNo++;
  // deno-lint-ignore no-explicit-any
  const begin: any = await rpc("tick_begin", { p_secret: secret, p_version: cache.version, p_limit: 20 });
  if (begin?.denied) return { status: "denied" };
  if (begin?.busy) return { status: "busy" };
  if (begin?.idle) return { status: "idle" };

  const report: TickReport = { status: "ok", sources: 0, failed: 0, items: 0, stories: 0, pushed: 0, llm: 0, alerts: 0 };
  let results: FetchResult[] = [];
  try {
    if (begin.config) {
      cache.cfg = compile(begin.config);
      cache.version = begin.version;
    }
    const cfg = cache.cfg!;
    const state: TickState = begin.state;
    const sources: SourceRow[] = begin.sources ?? [];
    report.sources = sources.length;

    results = await Promise.all(sources.map((s) => fetchSource(s, { secContact: cfg.settings.sec_contact })));
    report.failed = results.filter((r) => !r.ok).length;

    // Einträge vorbereiten
    const nowMs = Date.now();
    const items: IngestItem[] = [];
    const perSource = new Map<string, IngestItem[]>();
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i], res = results[i];
      if (!res.ok || !res.items.length) continue;
      let built: IngestItem[] = [];
      for (const raw of res.items) {
        if (src.kind === "sec") {
          // Nur Pflichtmeldungen zu beobachteten Aktien
          const company = normalize(String(raw.extra?.company ?? ""));
          const hit = cfg.topics.some((t) => t.kind === "stock" && t.priority > 0 && t.keywords.some((k) => {
            const n = normalize(k).replace(/[^a-z0-9 ]/g, "").trim();
            return n.length >= 4 && company.includes(n);
          }));
          if (!hit) continue;
        }
        const it = buildItem(src, raw, nowMs);
        if (!it || cache.seen.has(it.url_hash)) continue;
        built.push(it);
      }
      if (src.first) {
        built.sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
        built = built.slice(0, 20);
      } else {
        built = built.slice(0, 40);
      }
      perSource.set(src.id, built);
      items.push(...built);
    }

    let fresh: IngestItem[] = [];
    if (items.length) {
      const known: string[] = await rpc("known_hashes", { p_hashes: items.map((i) => i.url_hash) });
      const knownSet = new Set(known);
      const dedup = new Set<string>();
      for (const it of items) {
        if (knownSet.has(it.url_hash) || dedup.has(it.url_hash)) continue;
        dedup.add(it.url_hash);
        fresh.push(it);
      }
      if (cache.seen.size > 30000) cache.seen.clear();
      for (const it of items) cache.seen.add(it.url_hash);
    }
    fresh = fresh.slice(0, 250);
    report.items = fresh.length;
    for (let i = 0; i < results.length; i++) {
      const own = perSource.get(results[i].id) ?? [];
      results[i].new = own.filter((x) => fresh.includes(x)).length;
    }

    // Bündeln und bewerten
    const affected = new Map<number, Story>();
    for (let i = 0; i < fresh.length; i += 50) {
      const rows: Story[] = await rpc("ingest", { p_items: fresh.slice(i, i + 50) });
      for (const r of rows ?? []) affected.set(r.id, { ...r, is_new: r.is_new || (affected.get(r.id)?.is_new ?? false) });
    }
    report.stories = affected.size;
    if (affected.size) {
      const r = await scoreAndApply(cfg, state, [...affected.values()], { allowLlm: true, allowPush: true });
      report.pushed! += r.pushed;
      report.llm! += r.llm;
    } else if (llmState(cfg, state).usable && cache.tickNo % 3 === 0 && Date.now() - cache.lastLlmAt > 40_000) {
      // Ruhiger Moment: offene Meldungen von der KI einordnen lassen
      const pending: Story[] = await rpc("llm_pending", { p_limit: 12 });
      if (pending?.length) {
        const r = await scoreAndApply(cfg, state, pending, { allowLlm: true, allowPush: true });
        report.pushed! += r.pushed;
        report.llm! += r.llm;
      }
    }

    if (cfg.settings.price_alerts && (begin.prices ?? []).length) {
      report.alerts = await checkPrices(cfg, state, begin.prices);
    }
    await maybeDigest(cfg, state);
    if (state.rescore_pending && Date.now() - t0 < 25_000) {
      report.rescored = await rescoreAll(cfg, state);
    }
  } catch (e) {
    report.status = "error";
    report.error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    console.error("tick error", e);
  } finally {
    report.ms = Date.now() - t0;
    try {
      await rpc("tick_end", {
        p_secret: secret,
        p_results: results.map((r) => ({ id: r.id, ok: r.ok, status: r.status, error: r.error ?? null, etag: r.etag, last_modified: r.last_modified, items: r.items.length, new: r.new ?? 0 })),
        p_info: report,
      });
    } catch (e) {
      console.error("tick_end error", e);
    }
  }
  return report;
}
