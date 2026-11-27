// Bewertung: Themen-Treffer, Art des Ereignisses, Wichtigkeit, persönliche Relevanz, Stufe.
import { escapeRegex, normalize } from "./text.ts";

export interface Topic {
  id: string;
  kind: "topic" | "stock";
  name: string;
  keywords: string[];
  exclude: string[];
  priority: number; // 3 = Push, 2 = wichtig, 1 = nur in der App, 0 = ausblenden
  ticker: string | null;
  events: string[];
}

export interface Settings {
  languages: string[];
  muted: string[];
  timezone: string;
  push_enabled: boolean;
  thr_stocks: number;
  thr_topics: number;
  thr_world: number;
  world_push: boolean;
  push_max_per_day: number;
  quiet_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  quiet_allow_stocks: boolean;
  ntfy_enabled: boolean;
  ntfy_topic: string;
  digest_enabled: boolean;
  digest_times: string[];
  price_alerts: boolean;
  price_move_pct: number;
  price_window_min: number;
  profile_text: string;
  llm_enabled: boolean;
  llm_model: string;
  llm_daily_budget: number;
  sec_contact: string;
  site_url: string;
}

export interface RawConfig {
  settings: Settings;
  topics: Topic[];
  weights: Record<string, number>;
  secrets: Record<string, string>;
}

interface Matcher {
  topic: Topic;
  res: { re: RegExp; cased: boolean }[];
  exclude: RegExp[];
}

export interface Compiled {
  raw: RawConfig;
  settings: Settings;
  topics: Topic[];
  byId: Map<string, Topic>;
  matchers: Matcher[];
  muted: RegExp[];
  weights: Record<string, number>;
}

export interface Story {
  id: number;
  is_new: boolean;
  kind: string;
  title: string;
  summary: string | null;
  lang: string | null;
  category: string | null;
  source_name: string | null;
  publishers: string[];
  source_count: number;
  article_count: number;
  max_weight: number;
  breaking: boolean;
  backfill: boolean;
  tokens: string[];
  hints: string[];
  first_seen_at: string;
  published_at: string | null;
  sort_at: string;
  importance: number;
  relevance: number;
  tier: number;
  matched: string[];
  // deno-lint-ignore no-explicit-any
  llm: any;
  pushed_at: string | null;
  feedback: number | null;
  url: string | null;
  sec_event?: string | null;
}

export interface LlmVerdict {
  importance: number;
  relevance: number;
  event?: string;
  summary?: string;
}

export interface Match {
  topic: Topic;
  strength: "title" | "summary" | "hint";
}

export interface Analysis {
  matches: Match[];
  muted: boolean;
  event: string | null;
  eventBase: number;
  opinion: boolean;
  rumor: boolean;
  heur: number;
  learned: number;
}

export interface Verdict {
  id: number;
  is_new: boolean;
  importance: number;
  relevance: number;
  score: number;
  tier: number;
  event: string | null;
  matched: string[];
  reasons: string[];
  domain: "stocks" | "topics" | "world";
  pushEligible: boolean;
  pushTopic: Topic | null;
  // deno-lint-ignore no-explicit-any
  llm?: any;
  summary_ai?: string;
}

/**
 * Stichwort → Suchmuster.
 * - Kurzes Wort komplett in Großbuchstaben (AMD, KI, EZB): exakte Schreibweise, ganzes Wort.
 * - Bis 4 Zeichen: ganzes Wort.
 * - Länger: Wortanfang genügt ("Bundestag" findet auch "Bundestagswahl", "Nvidia" auch "Nvidias").
 */
export function keywordRegex(kw: string): { re: RegExp; cased: boolean } | null {
  const k = kw.trim();
  if (k.length < 2) return null;
  const cased = k.length <= 5 && /^[A-ZÄÖÜ0-9&.\-]+$/.test(k) && /[A-ZÄÖÜ]/.test(k);
  if (cased) {
    return { re: new RegExp(`(^|[^A-Za-zÄÖÜäöüß0-9])${escapeRegex(k)}(?![A-Za-zÄÖÜäöüß0-9])`), cased: true };
  }
  const n = normalize(k).replace(/[^a-z0-9]+/g, " ").trim();
  if (!n) return null;
  const body = n.split(" ").map(escapeRegex).join("[^a-z0-9]+");
  const lastWord = n.split(" ").pop() ?? "";
  // Kurze Wörter: ganzes Wort, Mehrzahl-s erlaubt ("E-Auto" findet "E-Autos", aber "Meta" nicht "Metadaten")
  const tail = lastWord.length >= 5 ? "" : "s?(?![a-z0-9])";
  return { re: new RegExp(`(^|[^a-z0-9])${body}${tail}`), cased: false };
}

export function compile(raw: RawConfig): Compiled {
  const topics = (raw.topics ?? []).filter((t) => (t.keywords ?? []).length > 0);
  const matchers: Matcher[] = topics.map((t) => ({
    topic: t,
    res: t.keywords.map(keywordRegex).filter((x): x is { re: RegExp; cased: boolean } => !!x),
    exclude: (t.exclude ?? []).map(keywordRegex).filter((x): x is { re: RegExp; cased: boolean } => !!x).map((x) => x.re),
  }));
  const muted = (raw.settings.muted ?? []).map(keywordRegex).filter((x): x is { re: RegExp; cased: boolean } => !!x).map((x) => x.re);
  return {
    raw,
    settings: raw.settings,
    topics,
    byId: new Map(topics.map((t) => [t.id, t])),
    matchers,
    muted,
    weights: raw.weights ?? {},
  };
}

// Ereignisarten mit Grundwert für die Wichtigkeit (0–100). Geprüft wird auf normalisiertem Text.
const EVENTS: { key: string; base: number; re: RegExp }[] = [
  {
    key: "leadership", base: 84,
    re: /(tritt (ueberraschend |sofort |mit sofortiger wirkung )?zurueck|ruecktritt|zurueckgetreten|legt (sein|ihr) amt nieder|abberufen|gefeuert|entlaesst (ceo|chef|vorstand|trainer)|(neuer|neue) (ceo|chef|chefin|vorstandschef|vorstandsvorsitzende|trainer|kanzler|praesident)|chefwechsel|fuehrungswechsel|wechsel im vorstand|kehrt (als )?(ceo|chef|an die spitze)?.{0,20}zurueck|steps? down|stepping down|resigns?\b|resignation|ousted|fired as|to depart as|departure of|names? new (ceo|chief)|new ceo|appoints? .{0,40}(ceo|chief executive)|returns? as (ceo|chief)|ceo .{0,25}(to leave|leaving|exits?|out\b)|replaces? .{0,30}as ceo)/,
  },
  {
    key: "election", base: 80,
    re: /(wahlergebnis|hochrechnung|prognose zur wahl|wahlsieg|gewinnt die wahl|wahlsieger|neuwahl|misstrauensvotum|vertrauensfrage|koalition (geplatzt|zerbricht|am ende)|zum (kanzler|praesidenten|ministerpraesidenten) gewaehlt|vereidigt|election results?|wins? (the )?(election|presidency|senate|house)|projected (winner|to win)|concedes?\b|impeach|no.confidence|snap election|sworn in|election called)/,
  },
  {
    key: "death", base: 78,
    re: /(ist tot|ist gestorben|gestorben|verstorben|stirbt|tot aufgefunden|ums leben gekommen|\bdied\b|dead at|has died|passes away|passed away|assassinat|ermordet|erschossen)/,
  },
  {
    key: "war", base: 76,
    re: /(kriegserklaerung|erklaert .{0,20}krieg|invasion|einmarsch|marschiert .{0,20}ein|waffenstillstand|waffenruhe|friedensabkommen|friedensvertrag|atomwaffe|atomtest|nuklearschlag|luftangriff|raketenangriff|grossangriff|bodenoffensive|kriegsrecht|generalmobilmachung|declares? war|invades?\b|invasion|ceasefire|peace (deal|agreement|treaty)|nuclear (test|strike|weapon)|air ?strikes?|missile (strike|attack)|martial law|ground offensive)/,
  },
  {
    key: "disaster", base: 74,
    re: /(erdbeben|tsunami|vulkanausbruch|hurrikan|flugzeugabsturz|abgestuerzt|zugunglueck|explosion|anschlag|attentat|terror|amoklauf|geiselnahme|schiesserei|massenpanik|grossbrand|flutkatastrophe|jahrhunderthochwasser|notstand ausgerufen|earthquake|tsunami|plane crash|train crash|explosion|terror attack|mass shooting|shooting|bombing|hostage|state of emergency|wildfire)/,
  },
  {
    key: "ma", base: 74,
    re: /(uebernahme|uebernimmt|uebernehmen|fusion(iert)?|zusammenschluss|kauft .{0,50}(fuer|milliarden|mrd)|kaufangebot|uebernahmeangebot|boersengang|geht an die boerse|\bipo\b|to acquire|acquires?\b|acquisition|merger|merges? with|takeover|buyout|to buy .{0,50}(billion|bn|\$)|goes public|files for ipo|spin.?off|abspaltung)/,
  },
  {
    key: "market_move", base: 64,
    re: /(stuerzt ab|kurssturz|kursrutsch|bricht ein|einbruch|crash|ausverkauf|rekordhoch|allzeithoch|rekordtief|springt (um|auf)|schiesst (hoch|nach oben)|kurssprung|kursrally|kursfeuerwerk|handel ausgesetzt|plunges?|tumbles?|soars?|surges?|skyrockets?|record high|all.time high|slumps?|sell.?off|trading halted|wipes? out|rallies|nosedives?)/,
  },
  {
    key: "earnings", base: 62,
    re: /(quartalszahlen|quartalsbericht|quartalsergebnis|geschaeftszahlen|jahreszahlen|bilanz|gewinnwarnung|gewinneinbruch|gewinnsprung|umsatzsprung|umsatzrekord|rekordumsatz|rekordgewinn|prognose (angehoben|gesenkt|erhoeht|gekappt)|hebt prognose|senkt prognose|uebertrifft (die )?erwartungen|verfehlt (die )?erwartungen|earnings|quarterly results|revenue (beats?|miss|jumps?|falls?|rises?)|profit warning|guidance|beats? (estimates|expectations)|miss(es)? (estimates|expectations)|q[1-4] (results|earnings|revenue)|raises? (forecast|outlook)|cuts? (forecast|outlook))/,
  },
  {
    key: "legal", base: 60,
    re: /(klage|verklagt|kartell|ermittlung|ermittelt gegen|razzia|durchsuchung|anklage|verurteilt|urteil|strafe|bussgeld|milliardenstrafe|verbot|verbietet|sanktion|exportbeschraenk|exportverbot|strafzoll|zoelle|zollstreit|insolvenz|pleite|stellenabbau|streicht .{0,15}stellen|entlaesst .{0,15}mitarbeiter|rueckruf|datenleck|hackerangriff|cyberangriff|lawsuit|sues?\b|sued\b|antitrust|probe\b|investigat|indict|convicted|ruling|fine[ds]?\b|\bban(s|ned)?\b|sanctions?|export (curbs?|restrictions?|controls?|ban)|tariffs?|bankruptcy|layoffs?|lays? off|job cuts|recall|data breach|hacked|cyberattack)/,
  },
  {
    key: "product", base: 50,
    re: /(stellt .{0,40}vor\b|vorgestellt|praesentiert|enthuellt|angekuendigt|kuendigt .{0,60}an\b|releasedatum|release.?termin|erscheinungsdatum|erscheinungstermin|erscheint am|startet am|ab sofort verfuegbar|veroeffentlicht|verschoben|verschiebt|verschiebung|verspaetet sich|verzoegert sich|kommt spaeter|bestaetigt .{0,40}(termin|release|datum|start)|confirms? .{0,30}(date|release|launch)|neuer trailer|erster trailer|launch(es|ed)?\b|unveils?|unveiled|announces?|announced|release date|reveals?|revealed|rolls? out|now available|delayed|delays?\b|postponed?|pushed back|new trailer|first trailer|gameplay trailer)/,
  },
  {
    key: "analyst", base: 28,
    re: /(kursziel|analyst|hochgestuft|herabgestuft|hochstufung|abstufung|kaufempfehlung|verkaufsempfehlung|price target|upgrades?|downgrades?|outperform|overweight|underweight|buy rating|sell rating|initiates? coverage)/,
  },
];

const OPINION = /(^| )(kommentar|meinung|kolumne|glosse|essay|gastbeitrag|interview|podcast|newsletter|quiz|ratgeber|tipps?|test:|im test|review|rezension|liveblog|newsblog|presseschau|faktencheck|erklaert:|was wir wissen|opinion|op.?ed|analysis:|explainer|how to|what to know|takeaways|things to know|live updates|watch:|photos:|in pictures|horoskop|gewinnspiel|sudoku|kreuzwortraetsel|wordle|angebot|rabatt|deal:|black friday|gutschein)(:| |$)/;
const RUMOR = /(geruecht|angeblich|offenbar|leak|insider|soll .{0,40}(planen|erwaegen|pruefen)|rumou?rs?|reportedly|sources say|said to be|is said to|considering|weighs|mulls)/;
const BREAKING = /^(\+\+\+|eil\b|eilmeldung|breaking|just in|urgent|developing)|(\+\+\+)/;

export const EVENT_LABELS: Record<string, string> = {
  leadership: "Führungswechsel",
  election: "Wahl",
  death: "Todesfall",
  war: "Konflikt",
  disaster: "Unglück",
  ma: "Übernahme",
  market_move: "Kursbewegung",
  earnings: "Geschäftszahlen",
  legal: "Recht & Regulierung",
  product: "Ankündigung",
  analyst: "Analysten",
  price: "Kursalarm",
};

function matchText(m: Matcher, titleN: string, titleO: string, sumN: string, sumO: string): "title" | "summary" | null {
  for (const ex of m.exclude) if (ex.test(titleN) || ex.test(sumN)) return null;
  let inSummary = false;
  for (const r of m.res) {
    if (r.re.test(r.cased ? titleO : titleN)) return "title";
    if (!inSummary && r.re.test(r.cased ? sumO : sumN)) inSummary = true;
  }
  return inSummary ? "summary" : null;
}

export function analyze(st: Story, cfg: Compiled): Analysis {
  const titleO = st.title || "";
  const sumO = st.summary || "";
  const titleN = normalize(titleO);
  const sumN = normalize(sumO);
  const both = titleN + " . " + sumN;

  const matches: Match[] = [];
  for (const m of cfg.matchers) {
    const s = matchText(m, titleN, titleO, sumN, sumO);
    if (s) matches.push({ topic: m.topic, strength: s });
    else if ((st.hints ?? []).includes(m.topic.id)) matches.push({ topic: m.topic, strength: "hint" });
  }
  const muted = cfg.muted.some((re) => re.test(both)) || matches.some((m) => m.topic.priority === 0 && m.strength !== "hint");

  const opinion = OPINION.test(titleN);
  const rumor = RUMOR.test(titleN);
  let event: string | null = null;
  let eventBase = 32;
  if (st.sec_event) {
    const e = EVENTS.find((x) => x.key === st.sec_event);
    if (e) {
      event = e.key;
      eventBase = e.base;
    }
  }
  // "dies" ist auf Deutsch ein gewöhnliches Wort, deshalb nur in englischen Schlagzeilen werten
  if (!event && st.lang === "en" && /\bdies\b/.test(titleN)) {
    event = "death";
    eventBase = 78;
  }
  if (!event) {
    for (const e of EVENTS) {
      if (e.re.test(titleN)) {
        event = e.key;
        eventBase = e.base;
        break;
      }
    }
  }
  if (!event) {
    for (const e of EVENTS) {
      if (e.base >= 60 && e.re.test(sumN)) {
        event = e.key;
        eventBase = Math.round(e.base * 0.8);
        break;
      }
    }
  }
  // Analystenmeinungen sind selten ein Ereignis, auch wenn Zahlen erwähnt werden
  if (event && event !== "leadership" && event !== "ma" && EVENTS[EVENTS.length - 1].re.test(titleN)) {
    event = "analyst";
    eventBase = 28;
  }
  // Ereignisse ohne Bezug zu Firmen/Politik (z. B. "Trainer tritt zurück") bleiben, werden aber nicht überhöht

  let heur = eventBase;
  const c = Math.max(1, st.source_count || 1);
  heur += Math.min(30, 9 * (c - 1));
  const ageMin = (Date.now() - Date.parse(st.first_seen_at)) / 60000;
  if (c >= 3 && ageMin <= 45) heur += 8;
  heur += Math.round(((st.max_weight || 1) - 1) * 20);
  if (st.breaking || BREAKING.test(titleN)) heur += 12;
  if (rumor) heur -= 8;
  if (opinion) heur = Math.min(heur - 15, 40);
  heur = Math.max(0, Math.min(100, heur));

  let learned = 0;
  const terms = [...(st.tokens ?? [])];
  if (st.source_name) terms.push("src:" + st.source_name.toLowerCase());
  if (st.category) terms.push("cat:" + st.category);
  for (const t of terms) {
    const w = cfg.weights[t];
    if (w) learned += w * 5;
  }
  learned = Math.max(-20, Math.min(20, learned));

  return { matches, muted, event, eventBase, opinion, rumor, heur, learned };
}

const BASE_REL: Record<number, number> = { 3: 95, 2: 76, 1: 56 };
export const PUSH_FLOOR = { stocks: 45, topics: 45, world: 72 };

export function finalize(st: Story, a: Analysis, cfg: Compiled, llmNew?: LlmVerdict | null): Verdict {
  const s = cfg.settings;
  const llm: LlmVerdict | null = llmNew ?? (st.llm && typeof st.llm === "object" && typeof st.llm.importance === "number" ? st.llm : null);
  const reasons: string[] = [];

  let importance = a.heur;
  if (llm) {
    importance = Math.round(0.7 * clamp(llm.importance) + 0.3 * a.heur);
    // KI sieht ein großes Ereignis, das die Stichwortregeln nicht kennen: nicht kleinrechnen
    if (llm.importance >= 80 && importance < llm.importance - 8) importance = Math.round(llm.importance - 8);
  }
  importance = clamp(importance);

  let event = a.event;
  if (llm?.event && llm.event !== "other" && llm.event !== "none" && EVENT_LABELS[llm.event]) event = llm.event;

  const active = a.matches.filter((m) => m.topic.priority > 0);
  const order = { title: 3, summary: 2, hint: 1 } as const;
  active.sort((x, y) => (y.topic.priority - x.topic.priority) || (order[y.strength] - order[x.strength]));
  const best = active[0] ?? null;

  let relevance = 25;
  if (best) {
    const f = best.strength === "title" ? 1 : best.strength === "summary" ? 0.82 : 0.6;
    relevance = BASE_REL[best.topic.priority] * f;
  }
  if (llm) {
    const r = clamp(llm.relevance);
    relevance = best ? Math.max(relevance * 0.75 + r * 0.25, Math.min(relevance, r + 25)) : relevance * 0.4 + r * 0.6;
  }
  relevance = clamp(relevance + a.learned);

  const hasStock = active.some((m) => m.topic.kind === "stock" && m.strength !== "hint");
  const hasTopic = active.some((m) => m.strength !== "hint");
  const domain: Verdict["domain"] = hasStock ? "stocks" : hasTopic ? "topics" : "world";

  // Untergrenzen: Meinungen, Analystenstimmen und Gerüchte sind nie einen Push wert, egal wie die Regler stehen
  const thrStocks = Math.max(s.thr_stocks, PUSH_FLOOR.stocks);
  const thrTopics = Math.max(s.thr_topics, PUSH_FLOOR.topics);
  const thrWorld = Math.max(s.thr_world, PUSH_FLOOR.world);
  let pushEligible = false;
  let pushTopic: Topic | null = null;
  const langOk = !st.lang || (s.languages ?? []).includes(st.lang);
  const pushMatches = active.filter((m) => m.topic.priority === 3 && m.strength === "title");
  for (const m of pushMatches) {
    if (m.topic.kind === "stock") {
      const evOk = !m.topic.events?.length || (event != null && m.topic.events.includes(event)) || importance >= thrStocks + 15;
      if (importance >= thrStocks && evOk && !a.opinion) {
        pushEligible = true;
        pushTopic = m.topic;
        break;
      }
    } else if (importance >= thrTopics && !a.opinion) {
      pushEligible = true;
      pushTopic = m.topic;
      break;
    }
  }
  if (!pushEligible && s.world_push && langOk && importance >= thrWorld && !a.opinion && !a.rumor) {
    // Ohne Themenbezug nur bei wirklich großen Ereignissen: mehrere Quellen UND (falls vorhanden) Bestätigung der KI.
    // Nachrufe nur bei ganz großen Namen.
    const enoughSources = st.source_count >= 3;
    const llmOk = llm ? llm.importance >= thrWorld - 3 : true;
    const obituary = event === "death" && importance < 90;
    if (enoughSources && llmOk && !obituary) pushEligible = true;
  }

  let tier = 1;
  if (a.muted) tier = 0;
  else if (pushEligible) tier = 3;
  else if (
    (best && best.topic.priority >= 2 && best.strength !== "hint" && importance >= 35) ||
    (best && best.topic.priority === 3 && best.strength === "title") ||
    importance >= thrWorld - 12 ||
    (relevance >= 70 && importance >= 45)
  ) tier = 2;
  if (!langOk && tier > 0 && !best) tier = 0;
  if (a.muted) pushEligible = false;

  for (const m of active.slice(0, 3)) {
    reasons.push(m.strength === "hint" ? `Gefunden über dein Thema „${m.topic.name}“` : `Passt zu „${m.topic.name}“`);
  }
  if (event && EVENT_LABELS[event]) reasons.push(`Art: ${EVENT_LABELS[event]}`);
  if (st.source_count >= 3) reasons.push(`${st.source_count} Quellen berichten`);
  if (llm) reasons.push("Von der KI eingeordnet");
  if (a.learned >= 6) reasons.push("Ähnelt Meldungen, die dir gefallen haben");
  if (a.learned <= -6) reasons.push("Ähnelt Meldungen, die du abgelehnt hast");

  const score = Math.round((0.55 * relevance + 0.45 * importance) * 10) / 10;
  const v: Verdict = {
    id: st.id,
    is_new: !!st.is_new,
    importance,
    relevance: Math.round(relevance),
    score,
    tier,
    event,
    matched: active.map((m) => m.topic.id),
    reasons,
    domain,
    pushEligible,
    pushTopic,
  };
  if (llmNew) {
    v.llm = { importance: clamp(llmNew.importance), relevance: clamp(llmNew.relevance), event: llmNew.event ?? null };
    if (llmNew.summary) v.summary_ai = llmNew.summary;
  }
  return v;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
}

/** Ortszeit in einer Zeitzone als Teile. */
export function localParts(tz: string, d = new Date()): { date: string; minutes: number; hhmm: string } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(d);
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Berlin", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(d);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hh = get("hour") === "24" ? "00" : get("hour");
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: parseInt(hh) * 60 + parseInt(get("minute")), hhmm: `${hh}:${get("minute")}` };
}

export function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s || "").trim());
  if (!m) return null;
  const h = parseInt(m[1]), mi = parseInt(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

export function inQuietHours(s: Settings, d = new Date()): boolean {
  if (!s.quiet_enabled) return false;
  const a = parseHHMM(s.quiet_start), b = parseHHMM(s.quiet_end);
  if (a == null || b == null || a === b) return false;
  const now = localParts(s.timezone, d).minutes;
  return a < b ? now >= a && now < b : now >= a || now < b;
}
