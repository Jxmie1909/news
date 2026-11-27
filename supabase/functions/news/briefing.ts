// Briefing: Die KI schreibt aus den wichtigsten Meldungen eine gegliederte Übersicht
// (Abschnitte mit Überschrift, je Ereignis ein Stichwort und zwei bis vier dichte Sätze).
import { rpc } from "./db.ts";
import { xfetch } from "./http.ts";
import { LlmError, parseLoose } from "./llm.ts";
import type { Compiled } from "./score.ts";
import { truncate } from "./text.ts";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface BriefingData {
  titel: string;
  einleitung: string;
  abschnitte: { ueberschrift: string; punkte: { titel: string; text: string; story_id: number | null }[] }[];
  steht_an: string[];
}

const SYSTEM = `Du schreibst für eine einzelne Person ein Nachrichten-Briefing auf Deutsch. Antworte ausschließlich mit JSON.

Aufbau:
- "titel": kurz, z. B. "Dein Morgen-Briefing" – wird vorgegeben, übernimm ihn.
- "einleitung": EIN Satz, der sagt, was den Zeitraum geprägt hat.
- "abschnitte": 3 bis 5 Abschnitte. Jede "ueberschrift" beginnt mit einem passenden Emoji, z. B. "🌍 Weltpolitik & Geopolitik", "⚔️ Konflikte & Sicherheit", "🇩🇪 Deutschland", "📈 Wirtschaft & Börse", "💻 Tech & KI", "🔬 Wissenschaft & Kultur", "⭐ Deine Themen". Wähle die Abschnitte nach dem, was wirklich passiert ist.
- Je Abschnitt 1 bis 4 "punkte". Insgesamt 8 bis 14 Punkte (Wochenrückblick: 10 bis 16).
- Jeder Punkt: "titel" = prägnantes Stichwort zum Ereignis (3 bis 7 Wörter, kein Satz). "text" = 2 bis 4 dichte Sätze: Was ist passiert, wer ist beteiligt, konkrete Zahlen, Namen und Daten, und was es bedeutet oder wie es weitergeht. "i" = Nummer der wichtigsten zugrunde liegenden Meldung.

Auswahl:
- Nimm das, was objektiv am wichtigsten war, aus ALLEN Bereichen – auch wenn es nicht zu den Themen der Person gehört: große Politik, Konflikte, Gerichtsurteile, Wirtschaft, Wissenschaft, bemerkenswerte Kultur- und Weltraummeldungen.
- Dazu das Wichtigste zu den eigenen Themen und Aktien der Person.
- Jedes Ereignis nur EINMAL. Fasse mehrere Meldungen zum selben Ereignis in einem Punkt zusammen.
- Keine Meinungsstücke, Ratgeber, Rabatte, Promi-Klatsch, Liveticker, Nachrufe auf wenig bekannte Personen.
- Lieber weniger, dafür gehaltvolle Punkte.

Regeln:
- Verwende NUR Tatsachen aus den gelieferten Meldungen. Erfinde nichts, ergänze keine Zahlen aus dem Gedächtnis.
- Sachlicher, klarer Ton, wie eine gute Nachrichtenübersicht. Kein Markdown, keine Sternchen.
- "steht_an": bis zu 5 kurze Zeilen zu anstehenden Terminen, nur aus der gelieferten Terminliste (Format: "Mo, 30.11.: …"). Leer lassen, wenn es keine gibt.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    titel: { type: "STRING" },
    einleitung: { type: "STRING" },
    abschnitte: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          ueberschrift: { type: "STRING" },
          punkte: {
            type: "ARRAY",
            items: { type: "OBJECT", properties: { titel: { type: "STRING" }, text: { type: "STRING" }, i: { type: "INTEGER" } }, required: ["titel", "text", "i"] },
          },
        },
        required: ["ueberschrift", "punkte"],
      },
    },
    steht_an: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["titel", "einleitung", "abschnitte", "steht_an"],
};

export async function writeBriefing(
  key: string, model: string, cfg: Compiled, kind: "tag" | "woche", title: string, since: Date, dedupeKey: string | null,
): Promise<{ id: number; data: BriefingData } | null> {
  // deno-lint-ignore no-explicit-any
  const mat: any = await rpc("briefing_material", { p_since: since.toISOString(), p_limit: kind === "woche" ? 110 : 70 });
  // deno-lint-ignore no-explicit-any
  const stories: any[] = mat?.stories ?? [];
  if (stories.length < 4) return null;
  const topics = (cfg.raw.topics ?? []).filter((t) => t.priority >= 2).map((t) => t.name).slice(0, 40);
  const user = JSON.stringify({
    titel: title,
    zeitraum: kind === "woche" ? "die letzten 7 Tage" : `seit ${new Intl.DateTimeFormat("de-DE", { timeZone: cfg.settings.timezone || "Europe/Berlin", weekday: "long", hour: "2-digit", minute: "2-digit" }).format(since)} Uhr`,
    themen_der_person: topics,
    vorlieben: truncate(cfg.settings.profile_text ?? "", 500),
    termine: mat?.termine ?? [],
    // deno-lint-ignore no-explicit-any
    meldungen: stories.map((s: any, i: number) => ({ i, titel: truncate(s.titel, 160), text: truncate(s.text ?? "", 330), quelle: s.quelle, quellen: s.quellen, bereich: s.bereich ?? "", mein_thema: s.mein_thema })),
  });
  const r = await xfetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 5000, responseMimeType: "application/json", responseSchema: SCHEMA },
    }),
    timeoutMs: 40000,
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
  const used = new Set<number>();
  const data: BriefingData = {
    titel: title,
    einleitung: truncate(String(out?.einleitung ?? "").trim(), 400),
    // deno-lint-ignore no-explicit-any
    abschnitte: (Array.isArray(out?.abschnitte) ? out.abschnitte : []).slice(0, 6).map((a: any) => ({
      ueberschrift: truncate(String(a?.ueberschrift ?? "").trim(), 60),
      // deno-lint-ignore no-explicit-any
      punkte: (Array.isArray(a?.punkte) ? a.punkte : []).slice(0, 5).map((p: any) => {
        const st = stories[Number(p?.i)];
        const sid = st && !used.has(st.id) ? st.id : null;
        if (sid) used.add(sid);
        return { titel: truncate(String(p?.titel ?? "").trim(), 90), text: truncate(String(p?.text ?? "").trim(), 900), story_id: sid };
      // deno-lint-ignore no-explicit-any
      }).filter((p: any) => p.titel.length > 2 && p.text.length > 30),
    // deno-lint-ignore no-explicit-any
    })).filter((a: any) => a.ueberschrift && a.punkte.length),
    steht_an: (Array.isArray(out?.steht_an) ? out.steht_an : []).map((x: unknown) => truncate(String(x).trim(), 160)).filter((x: string) => x.length > 5).slice(0, 5),
  };
  if (!data.abschnitte.length) throw new LlmError("Die KI hat kein Briefing geliefert", 200);
  const id: number = await rpc("briefing_save", { p_kind: kind, p_since: since.toISOString(), p_data: data, p_key: dedupeKey });
  return { id, data };
}
