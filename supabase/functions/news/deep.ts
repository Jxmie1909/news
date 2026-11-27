// Ausführliche Zusammenfassung einer Meldung: Originalartikel lesen, auf Deutsch zusammenfassen,
// mögliche Folgen und eine Einschätzung ergänzen. Wird beim ersten Öffnen erzeugt und gespeichert.
import { admin } from "./db.ts";
import { readText } from "./feeds.ts";
import { xfetch } from "./http.ts";
import { LlmError, parseLoose } from "./llm.ts";
import type { Compiled } from "./score.ts";
import { decodeEntities, truncate } from "./text.ts";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface Deep {
  absaetze: string[];
  folgen: string[];
  einschaetzung: string;
  grundlage: "artikel" | "kurzmeldungen";
  quellen: number;
}

/** Fließtext aus einer Artikelseite herauslösen (ohne Menüs, Werbung, Skripte). */
export function extractArticleText(html: string, max = 7000): string {
  let h = html.replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|figure|iframe)[\s\S]*?<\/\1>/gi, " ");
  const art = h.match(/<article[\s\S]*?<\/article>/i);
  if (art && art[0].length > 800) h = art[0];
  const paras: string[] = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  let total = 0;
  while ((m = re.exec(h)) && total < max) {
    const t = decodeEntities(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (t.length < 60) continue;
    if (/(cookie|newsletter|abonnier|subscribe|sign up|all rights reserved|javascript|werbung|anzeige|datenschutz)/i.test(t) && t.length < 220) continue;
    paras.push(t);
    total += t.length;
  }
  return truncate(paras.join("\n"), max);
}

async function fetchArticle(url: string): Promise<string> {
  try {
    const r = await xfetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NewsReader/1.0; personal news reader)", "Accept": "text/html,application/xhtml+xml", "Accept-Language": "de-DE,de;q=0.9,en;q=0.7" },
      timeoutMs: 7000,
    });
    if (!r.ok || !/html/i.test(r.headers.get("content-type") ?? "")) {
      await r.body?.cancel();
      return "";
    }
    const html = await readText(r);
    if (html.length > 3_000_000) return "";
    return extractArticleText(html);
  } catch {
    return "";
  }
}

const SYSTEM = `Du schreibst für eine einzelne Person eine ausführliche, gut lesbare Zusammenfassung einer Nachricht auf Deutsch. Antworte ausschließlich mit JSON.

"absaetze": 4 bis 6 Absätze Fließtext, zusammen etwa 250 bis 400 Wörter.
- Absatz 1: Was ist passiert? Die Kernnachricht in klaren Worten.
- Danach: die wichtigsten Einzelheiten, Zahlen, Namen, Zitate und der Hintergrund, der zum Verstehen nötig ist.
- Schreibe sachlich und verständlich, ohne Fachjargon; erkläre Fachbegriffe kurz.
- Verwende NUR Tatsachen aus dem gelieferten Material. Erfinde nichts. Wenn das Material dünn ist, schreibe entsprechend kürzer (mindestens 2 Absätze) und sage offen, was noch unklar ist.
- Übernimm keine langen Passagen wörtlich; gib den Inhalt in eigenen Worten wieder.

"folgen": 3 bis 4 kurze Punkte „Was daraus folgen könnte“ – konkrete, plausible Auswirkungen (für Märkte, Branche, Politik, Verbraucher oder die Person selbst, falls ihr Profil einen Bezug zeigt). Formuliere als Möglichkeit, nicht als Tatsache.

"einschaetzung": 2 bis 4 Sätze Einordnung: Wie bedeutend ist das wirklich, was ist sicher, was offen, worauf sollte man als Nächstes achten? Keine Kauf- oder Verkaufsempfehlungen.

Kein Markdown.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    absaetze: { type: "ARRAY", items: { type: "STRING" } },
    folgen: { type: "ARRAY", items: { type: "STRING" } },
    einschaetzung: { type: "STRING" },
  },
  required: ["absaetze", "folgen", "einschaetzung"],
};

export async function deepen(key: string, model: string, cfg: Compiled, storyId: number): Promise<Deep> {
  const { data: st, error } = await admin.from("stories").select("id,title,title_de,summary,summary_ai,url,source_name,deep,matched,kind").eq("id", storyId).maybeSingle();
  if (error || !st) throw new LlmError("Meldung nicht gefunden", 404);
  if (st.deep) return st.deep as Deep;
  const { data: dupRows } = await admin.from("stories").select("id").eq("dup_of", storyId);
  const ids = [storyId, ...(dupRows ?? []).map((d: { id: number }) => d.id)];
  const { data: arts } = await admin.from("articles").select("title,summary,url,publisher,lang,published_at").in("story_id", ids).order("published_at", { ascending: false }).limit(12);
  const articles = arts ?? [];

  // Bis zu drei Originalartikel lesen (verschiedene Anbieter), deutsche zuerst
  const seen = new Set<string>();
  const pick = [...articles].sort((a, b) => (a.lang === "de" ? 0 : 1) - (b.lang === "de" ? 0 : 1)).filter((a) => {
    const k = a.publisher ?? a.url;
    if (seen.has(k) || !/^https?:\/\//.test(a.url) || /bsky\.app|sec\.gov/.test(a.url)) return false;
    seen.add(k);
    return true;
  }).slice(0, 3);
  const texts = await Promise.all(pick.map((a) => fetchArticle(a.url)));
  const material = pick.map((a, i) => ({ anbieter: a.publisher ?? "", titel: a.title, text: texts[i] })).filter((m) => m.text.length > 400);
  const basis: Deep["grundlage"] = material.length ? "artikel" : "kurzmeldungen";

  const topics = (cfg.raw.topics ?? []).filter((t) => (st.matched ?? []).includes(t.id)).map((t) => t.name);
  const user = JSON.stringify({
    schlagzeile: st.title_de || st.title,
    kurztext: st.summary_ai || st.summary || "",
    themen_der_person: topics,
    artikel: material.map((m) => ({ ...m, text: truncate(m.text, 5000) })),
    weitere_schlagzeilen: articles.slice(0, 10).map((a) => `${a.publisher ?? ""}: ${a.title}${a.summary ? " – " + truncate(a.summary, 240) : ""}`),
    hinweis: material.length ? "" : "Die Originalartikel waren nicht lesbar. Nutze nur Schlagzeilen und Kurztexte und schreibe entsprechend knapper.",
  });

  const r = await xfetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 3000, responseMimeType: "application/json", responseSchema: SCHEMA },
    }),
    timeoutMs: 30000,
  });
  const raw = await r.text();
  if (!r.ok) {
    let msg = raw.slice(0, 200);
    try {
      msg = JSON.parse(raw)?.error?.message ?? msg;
    } catch { /* bleibt */ }
    throw new LlmError(String(msg).slice(0, 300), r.status);
  }
  const j = JSON.parse(raw);
  // deno-lint-ignore no-explicit-any
  const out = parseLoose((j?.candidates?.[0]?.content?.parts ?? []).filter((p: any) => !p.thought).map((p: any) => p.text ?? "").join(""));
  const clean = (v: unknown, n: number, maxLen: number): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter((x) => x.length > 15).slice(0, n).map((x) => truncate(x, maxLen)) : []);
  const deep: Deep = {
    absaetze: clean(out?.absaetze, 7, 1400),
    folgen: clean(out?.folgen, 5, 400),
    einschaetzung: truncate(String(out?.einschaetzung ?? "").trim(), 900),
    grundlage: basis,
    quellen: material.length,
  };
  if (!deep.absaetze.length) throw new LlmError("Die KI hat keinen Text geliefert", 200);
  await admin.from("stories").update({ deep, deep_at: new Date().toISOString() }).eq("id", storyId);
  return deep;
}
