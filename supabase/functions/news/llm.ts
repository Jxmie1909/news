// Gemini (kostenloses Kontingent): Meldungen einordnen, Themen aus Freitext vorschlagen.
import { xfetch } from "./http.ts";
import type { Compiled, LlmVerdict, Story } from "./score.ts";
import { truncate } from "./text.ts";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
export const MODEL_PREFERENCE = ["gemini-flash-lite-latest", "gemini-flash-latest"];

export class LlmError extends Error {
  status: number;
  retryAfterSec: number | null;
  daily: boolean;
  constructor(msg: string, status: number, retryAfterSec: number | null = null, daily = false) {
    super(msg);
    this.status = status;
    this.retryAfterSec = retryAfterSec;
    this.daily = daily;
  }
}

// deno-lint-ignore no-explicit-any
async function generate(key: string, model: string, system: string, user: string, schema: any, maxTokens = 3000, timeoutMs = 12000): Promise<any> {
  const r = await xfetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens, responseMimeType: "application/json", responseSchema: schema },
    }),
    timeoutMs,
  });
  const text = await r.text();
  if (!r.ok) {
    let msg = text.slice(0, 300);
    let retry: number | null = null;
    let daily = false;
    try {
      const j = JSON.parse(text);
      msg = j?.error?.message ?? msg;
      for (const d of j?.error?.details ?? []) {
        if (typeof d?.retryDelay === "string") retry = Math.ceil(parseFloat(d.retryDelay));
        for (const v of d?.violations ?? []) {
          if (/PerDay/i.test(String(v?.quotaId ?? "")) || /per.?day/i.test(String(v?.quotaMetric ?? ""))) daily = true;
        }
      }
      if (/per day|daily/i.test(msg)) daily = true;
    } catch { /* Text bleibt Fehlermeldung */ }
    throw new LlmError(String(msg).slice(0, 300), r.status, retry, daily);
  }
  const j = JSON.parse(text);
  // deno-lint-ignore no-explicit-any
  const out = (j?.candidates?.[0]?.content?.parts ?? []).filter((p: any) => !p.thought).map((p: any) => p.text ?? "").join("");
  if (!out) throw new LlmError("Leere Antwort" + (j?.candidates?.[0]?.finishReason ? ` (${j.candidates[0].finishReason})` : ""), 200);
  return parseLoose(out);
}

// deno-lint-ignore no-explicit-any
export function parseLoose(out: string): any {
  try {
    return JSON.parse(out);
  } catch {
    const a = out.indexOf("["), o = out.indexOf("{");
    const start = a >= 0 && (o < 0 || a < o) ? a : o;
    const end = Math.max(out.lastIndexOf("]"), out.lastIndexOf("}"));
    if (start >= 0 && end > start) return JSON.parse(out.slice(start, end + 1));
    throw new LlmError("Antwort nicht lesbar", 200);
  }
}

export async function listModels(key: string): Promise<string[]> {
  const r = await xfetch(`${BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": key }, timeoutMs: 10000 });
  const text = await r.text();
  if (!r.ok) {
    let msg = text.slice(0, 200);
    try {
      msg = JSON.parse(text)?.error?.message ?? msg;
    } catch { /* ignore */ }
    throw new LlmError(msg, r.status);
  }
  const j = JSON.parse(text);
  // deno-lint-ignore no-explicit-any
  return (j.models ?? []).filter((m: any) => (m.supportedGenerationMethods ?? []).includes("generateContent")).map((m: any) => String(m.name).replace(/^models\//, ""));
}

/** Passendes, sparsames Modell wählen: zuerst Flash-Lite, dann Flash. */
export function pickModel(models: string[]): string | null {
  for (const pref of MODEL_PREFERENCE) if (models.includes(pref)) return pref;
  const ok = models.filter((m) => /^gemini-/.test(m) && !/(image|tts|audio|live|embedding|vision|exp|computer|robot)/i.test(m));
  const ver = (m: string) => parseFloat(m.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? "0");
  const rank = (m: string) => (/flash-lite/.test(m) ? 2 : /flash/.test(m) ? 1 : 0) * 100 + ver(m) - (/preview/.test(m) ? 0.05 : 0);
  ok.sort((a, b) => rank(b) - rank(a));
  return ok[0] ?? null;
}

export async function testKey(key: string): Promise<{ model: string }> {
  const models = await listModels(key);
  const model = pickModel(models);
  if (!model) throw new LlmError("Kein passendes Gemini-Modell verfügbar", 404);
  await generate(key, model, "Antworte nur mit JSON.", 'Gib {"ok": true} zurück.', { type: "OBJECT", properties: { ok: { type: "BOOLEAN" } }, required: ["ok"] }, 200, 15000);
  return { model };
}

const SCORE_SYSTEM = `Du ordnest Nachrichten für genau eine Person ein. Antworte ausschließlich mit JSON.

"importance" (0–100): Wie groß und folgenreich ist das Ereignis objektiv?
90–100: Historisch oder Schock. Staatschef tritt zurück oder stirbt, Kriegsausbruch, Chef eines Weltkonzerns tritt überraschend zurück oder kehrt überraschend zurück, Übernahme über 50 Mrd., schwerer Anschlag.
70–89: Sehr wichtig. Wahlergebnis, große Übernahme, Quartalszahlen mit starker Überraschung, offiziell bestätigter oder verschobener Termin eines Großprodukts, schweres Unglück, Leitzinsentscheid mit Überraschung.
50–69: Wichtig. Neues Produkt offiziell angekündigt, Klage oder Regulierung gegen einen Konzern, Gesetz beschlossen, Quartalszahlen wie erwartet, bedeutender Transfer.
30–49: Normale Nachricht. Analystenmeinung, Interview, kleines Update, Gerücht, Vorbericht.
0–29: Unwichtig. Meinung, Ratgeber, Werbung, Rabattaktion, Wiederholung, Clickbait, Liveticker ohne neues Ereignis.
Mehrere unabhängige Quellen sprechen für ein echtes Ereignis. Gerüchte und Meinungen niedriger einstufen.

"relevance" (0–100): Wie sehr interessiert das DIESE Person laut Profil? 90+ nur bei direktem Bezug zu ihren Themen oder Aktien. Ohne Bezug höchstens 40, außer das Ereignis ist für alle wichtig. Beachte ihre eigene Beschreibung und ihre Vorlieben genau.

"neuigkeit" (0–100): Steckt hier etwas wirklich NEUES, das heute passiert ist oder bekannt wurde?
80–100: frisches Ereignis oder neue Tatsache. 50–79: neue Entwicklung in einer laufenden Geschichte. 20–49: Nachbericht, Einordnung, Hintergrund, Rückblick zu etwas, das schon Tage alt ist. 0–19: zeitloser Inhalt, Ratgeber, Aufgewärmtes.

"doppelt": Unter "schon_gemeldet" stehen Ereignisse, die der Person bereits gezeigt wurden. Behandelt die Meldung DASSELBE Ereignis (nur andere Quelle, andere Sprache, andere Formulierung, kein wesentlicher neuer Fakt), gib dessen Nummer "n" an. Sonst -1. Gleiches Thema, aber neues Ereignis ist NICHT doppelt. Behandeln zwei Meldungen in "meldungen" dasselbe Ereignis, gib bei der zweiten den Wert -2 minus den Index "i" der ersten an (also -2 für i=0, -3 für i=1 …).

"event": eines von leadership, election, death, war, disaster, ma, market_move, earnings, legal, product, analyst, other.

"titel": Schlagzeile auf Deutsch, sachlich, höchstens 95 Zeichen. Deutsche Schlagzeilen unverändert übernehmen, englische übersetzen. Eigennamen bleiben.

"summary": 2–3 Sätze auf Deutsch, sachlich und konkret, höchstens 320 Zeichen: Was ist passiert, und warum ist es von Belang? Nur was in Titel und Text steht, nichts dazuerfinden.`;

const SCORE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      i: { type: "INTEGER" },
      importance: { type: "INTEGER" },
      relevance: { type: "INTEGER" },
      neuigkeit: { type: "INTEGER" },
      doppelt: { type: "INTEGER" },
      event: { type: "STRING" },
      titel: { type: "STRING" },
      summary: { type: "STRING" },
    },
    required: ["i", "importance", "relevance", "neuigkeit", "doppelt", "event", "titel", "summary"],
  },
};

export function profileForPrompt(cfg: Compiled): Record<string, unknown> {
  const t = cfg.topics.filter((x) => x.priority > 0);
  const label = (p: number) => (p === 3 ? "sehr wichtig" : p === 2 ? "wichtig" : "interessant");
  return {
    aktien: t.filter((x) => x.kind === "stock").slice(0, 40).map((x) => `${x.name}${x.ticker ? ` (${x.ticker})` : ""} – ${label(x.priority)}`),
    themen: t.filter((x) => x.kind !== "stock").slice(0, 60).map((x) => `${x.name} – ${label(x.priority)}`),
    nicht_interessiert: [...(cfg.settings.muted ?? []), ...cfg.topics.filter((x) => x.priority === 0).map((x) => x.name)].slice(0, 40),
    eigene_beschreibung_und_vorlieben: truncate(cfg.settings.profile_text ?? "", 900),
  };
}

export interface Reported {
  id: number;
  title: string;
}

export async function scoreStories(key: string, model: string, cfg: Compiled, stories: Story[], reported: Reported[] = []): Promise<Map<number, LlmVerdict>> {
  const items = stories.map((s, i) => ({
    i,
    titel: truncate(s.title, 220),
    text: truncate(s.summary ?? "", 300),
    quelle: s.source_name ?? "",
    anzahl_quellen: s.source_count,
    sprache: s.lang ?? "",
  }));
  const ownIds = new Set(stories.map((s) => s.id));
  const known = reported.filter((r) => !ownIds.has(r.id)).slice(0, 30);
  const user = JSON.stringify({ profil: profileForPrompt(cfg), schon_gemeldet: known.map((r, n) => ({ n, titel: truncate(r.title, 140) })), meldungen: items });
  const out = await generate(key, model, SCORE_SYSTEM, user, SCORE_SCHEMA, 500 + 260 * stories.length, 15000);
  const map = new Map<number, LlmVerdict>();
  if (!Array.isArray(out)) throw new LlmError("Antwort hat falsches Format", 200);
  for (const r of out) {
    const st = stories[Number(r?.i)];
    if (!st) continue;
    const imp = Number(r.importance), rel = Number(r.relevance);
    if (!Number.isFinite(imp) || !Number.isFinite(rel)) continue;
    const nov = Number(r.neuigkeit);
    const d = Number(r.doppelt);
    let dupOf: number | null = null;
    if (Number.isInteger(d) && d >= 0 && known[d]) dupOf = known[d].id;
    else if (Number.isInteger(d) && d <= -2) {
      const first = stories[-d - 2];
      if (first && first.id !== st.id && Number(r.i) > -d - 2) dupOf = first.id;
    }
    const titel = typeof r.titel === "string" ? r.titel.trim() : "";
    map.set(st.id, {
      importance: Math.max(0, Math.min(100, Math.round(imp))),
      relevance: Math.max(0, Math.min(100, Math.round(rel))),
      novelty: Number.isFinite(nov) ? Math.max(0, Math.min(100, Math.round(nov))) : undefined,
      dup_of: dupOf,
      title_de: titel.length >= 8 && titel.length <= 160 && titel !== st.title ? titel : undefined,
      event: typeof r.event === "string" ? r.event.toLowerCase().trim() : undefined,
      summary: typeof r.summary === "string" ? truncate(r.summary.trim(), 360) : undefined,
    });
  }
  return map;
}

const SUGGEST_SYSTEM = `Du hilfst, aus einer freien Beschreibung konkrete Nachrichten-Themen zu machen. Antworte ausschließlich mit JSON.
Erzeuge 1 bis 8 Themen. Jedes Thema:
- "name": kurzer deutscher Name (höchstens 30 Zeichen)
- "emoji": ein passendes Emoji
- "keywords": 2 bis 6 Suchbegriffe, wie sie in Schlagzeilen vorkommen (deutsch und englisch, Eigennamen, keine ganzen Sätze, keine allgemeinen Wörter wie "News")
- "kind": "stock" wenn es um ein börsennotiertes Unternehmen als Geldanlage geht, sonst "topic"
- "ticker": Börsenkürzel nur wenn kind = "stock" und du sicher bist, sonst leerer Text
- "priority": 3 wenn die Person es sofort wissen will, 2 wenn wichtig, 1 wenn nur interessant
- "exclude": Begriffe, die ausdrücklich NICHT gemeint sind (oft leer)
Nur Themen, die wirklich aus dem Text hervorgehen. Nichts erfinden.`;

const SUGGEST_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      name: { type: "STRING" },
      emoji: { type: "STRING" },
      keywords: { type: "ARRAY", items: { type: "STRING" } },
      kind: { type: "STRING" },
      ticker: { type: "STRING" },
      priority: { type: "INTEGER" },
      exclude: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: ["name", "emoji", "keywords", "kind", "priority"],
  },
};

export interface TopicSuggestion {
  name: string;
  emoji: string;
  keywords: string[];
  kind: "topic" | "stock";
  ticker: string | null;
  priority: number;
  exclude: string[];
}

export async function suggestTopics(key: string, model: string, text: string, existing: string[]): Promise<TopicSuggestion[]> {
  const user = JSON.stringify({ beschreibung: truncate(text, 2000), schon_vorhanden: existing.slice(0, 80) });
  const out = await generate(key, model, SUGGEST_SYSTEM, user, SUGGEST_SCHEMA, 1500, 20000);
  if (!Array.isArray(out)) return [];
  return out.map(cleanSuggestion).filter((x): x is TopicSuggestion => !!x).slice(0, 8);
}

// deno-lint-ignore no-explicit-any
function cleanSuggestion(r: any): TopicSuggestion | null {
  const name = String(r?.name ?? "").trim().slice(0, 40);
  const keywords = (Array.isArray(r?.keywords) ? r.keywords : []).map((k: unknown) => String(k).trim()).filter((k: string) => k.length >= 2 && k.length <= 40).slice(0, 6);
  if (!name || keywords.length === 0) return null;
  const kind = r?.kind === "stock" ? "stock" : "topic";
  const p = Number(r?.priority);
  return {
    name,
    emoji: String(r?.emoji ?? "").trim().slice(0, 8) || "📰",
    keywords,
    kind,
    ticker: kind === "stock" && r?.ticker ? String(r.ticker).trim().toUpperCase().slice(0, 12) : null,
    priority: p === 3 || p === 2 || p === 1 ? p : 2,
    exclude: (Array.isArray(r?.exclude) ? r.exclude : []).map((k: unknown) => String(k).trim()).filter((k: string) => k.length >= 2).slice(0, 5),
  };
}

/** Ohne KI: Freitext grob in Themen zerlegen. */
export function suggestTopicsFallback(text: string): TopicSuggestion[] {
  const parts = text.split(/[,;.\n]|\s+und\s+|\s+sowie\s+|\s+oder\s+/i).map((p) => p.trim()).filter(Boolean);
  const out: TopicSuggestion[] = [];
  const seen = new Set<string>();
  const filler = /^(ich|mich|mir|interessiere|interessiert|interessieren|mag|moechte|möchte|will|auch|besonders|vor allem|gerne|sehr|fuer|für|an|die|der|das|den|alles|zu|zum|zur|ueber|über|news|nachrichten|themen|thema|aber|nur|kein|keine|nicht|mehr|von|mit|im|in|bei|wie|z\.?b\.?|zum beispiel|etwa|rund um|um|vor|allem|allen|und|sowie|oder|ich|bin|fan|liebe|verfolge|lese|gern|ausserdem|außerdem|dazu|noch|ganz|eher|eigentlich|natuerlich|natürlich)$/i;
  for (const p of parts) {
    const words = p.split(/\s+/).filter((w) => !filler.test(w.replace(/[^\p{L}\p{N}.]/gu, "")));
    if (words.length === 0 || words.length > 4) continue;
    const name = words.join(" ").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (name.length < 3 || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name: name.slice(0, 40), emoji: "📰", keywords: [name], kind: "topic", ticker: null, priority: 2, exclude: [] });
    if (out.length >= 8) break;
  }
  return out;
}
