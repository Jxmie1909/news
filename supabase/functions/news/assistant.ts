// KI-Assistent: beantwortet Fragen zu den Meldungen und stellt auf Zuruf den Algorithmus um
// (Themen, Wichtigkeit, Suchbegriffe, Stummschalten, Push-Regeln, Quellen, Vorlieben).
import { admin } from "./db.ts";
import { xfetch } from "./http.ts";
import { LlmError } from "./llm.ts";
import type { Compiled } from "./score.ts";
import { normalize, tokenize, truncate } from "./text.ts";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AssistantResult {
  text: string;
  actions: string[];
}

const PRIO_NAME: Record<number, string> = { 3: "Sofort-Push", 2: "Wichtig", 1: "Nur in der App", 0: "Ausgeblendet" };

const TOOLS = [{
  functionDeclarations: [
    {
      name: "thema_anlegen",
      description: "Legt ein neues Thema oder eine neue Aktie an, nach der in Schlagzeilen gesucht wird.",
      parameters: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "Kurzer Name, z. B. 'Formel 1'" },
          suchbegriffe: { type: "ARRAY", items: { type: "STRING" }, description: "2–6 Begriffe, wie sie in Schlagzeilen vorkommen (deutsch und englisch)" },
          wichtigkeit: { type: "INTEGER", description: "3 = Sofort-Push, 2 = Wichtig, 1 = Nur in der App" },
          aktie: { type: "BOOLEAN", description: "true, wenn es eine Aktie ist" },
          kuerzel: { type: "STRING", description: "Börsenkürzel bei Aktien, z. B. NVDA; sonst leer" },
          emoji: { type: "STRING" },
        },
        required: ["name", "suchbegriffe", "wichtigkeit"],
      },
    },
    {
      name: "thema_aendern",
      description: "Ändert ein vorhandenes Thema: Wichtigkeit, Suchbegriffe, Ausschlüsse oder Name. Wichtigkeit 0 blendet alle Meldungen dazu aus.",
      parameters: {
        type: "OBJECT",
        properties: {
          thema: { type: "STRING", description: "Name des vorhandenen Themas" },
          wichtigkeit: { type: "INTEGER", description: "3 = Sofort-Push, 2 = Wichtig, 1 = Nur in der App, 0 = Ausblenden" },
          suchbegriffe_hinzu: { type: "ARRAY", items: { type: "STRING" } },
          suchbegriffe_weg: { type: "ARRAY", items: { type: "STRING" } },
          ausschliessen_hinzu: { type: "ARRAY", items: { type: "STRING" }, description: "Begriffe, bei denen eine Meldung NICHT zu diesem Thema zählt" },
          neuer_name: { type: "STRING" },
        },
        required: ["thema"],
      },
    },
    {
      name: "thema_loeschen",
      description: "Löscht ein Thema samt seiner Suchquellen.",
      parameters: { type: "OBJECT", properties: { thema: { type: "STRING" } }, required: ["thema"] },
    },
    {
      name: "stummschalten",
      description: "Begriffe, die der Nutzer nie sehen will (Meldungen damit werden ausgeblendet), hinzufügen oder wieder entfernen.",
      parameters: {
        type: "OBJECT",
        properties: { hinzu: { type: "ARRAY", items: { type: "STRING" } }, weg: { type: "ARRAY", items: { type: "STRING" } } },
      },
    },
    {
      name: "push_einstellen",
      description: "Stellt die Push-Regeln ein. Schwellen: je höher, desto seltener ein Push (50 = ab Ankündigungen, 63 = nur bestätigte wichtige Nachrichten, 80 = nur ganz große Ereignisse).",
      parameters: {
        type: "OBJECT",
        properties: {
          push_an: { type: "BOOLEAN", description: "Hauptschalter für alle Pushes" },
          schwelle_aktien: { type: "INTEGER", description: "50–98" },
          schwelle_themen: { type: "INTEGER", description: "50–98" },
          schwelle_welt: { type: "INTEGER", description: "75–99" },
          weltereignisse: { type: "BOOLEAN", description: "Push bei großen Ereignissen ohne Themenbezug" },
          ruhezeit_an: { type: "BOOLEAN" },
          ruhezeit_von: { type: "STRING", description: "HH:MM" },
          ruhezeit_bis: { type: "STRING", description: "HH:MM" },
          aktien_in_ruhezeit: { type: "BOOLEAN" },
          digest_an: { type: "BOOLEAN" },
          digest_zeiten: { type: "ARRAY", items: { type: "STRING" }, description: "Uhrzeiten HH:MM, höchstens 4" },
          kursalarm_an: { type: "BOOLEAN" },
          kursalarm_prozent: { type: "NUMBER", description: "1–15" },
        },
      },
    },
    {
      name: "vorliebe_merken",
      description: "Bringt dem Algorithmus eine Vorliebe bei, die sich nicht als Thema fassen lässt, z. B. 'keine Nachrufe', 'weniger Analystenmeinungen', 'mehr zu Übernahmen'. Wirkt auf die KI-Einordnung jeder künftigen Meldung.",
      parameters: {
        type: "OBJECT",
        properties: {
          regel: { type: "STRING", description: "Ein kurzer, klarer Satz aus Sicht des Nutzers, z. B. 'Nachrufe interessieren mich nicht.'" },
          mehr_davon: { type: "ARRAY", items: { type: "STRING" }, description: "Einzelne Wörter, die künftig höher bewertet werden" },
          weniger_davon: { type: "ARRAY", items: { type: "STRING" }, description: "Einzelne Wörter, die künftig niedriger bewertet werden" },
        },
        required: ["regel"],
      },
    },
    {
      name: "quelle_schalten",
      description: "Schaltet eine Nachrichtenquelle ein oder aus (z. B. 'Bloomberg', 'BBC', 'kicker').",
      parameters: { type: "OBJECT", properties: { quelle: { type: "STRING" }, an: { type: "BOOLEAN" } }, required: ["quelle", "an"] },
    },
    {
      name: "meldungen_suchen",
      description: "Sucht in den gesammelten Meldungen der letzten Tage. Für Fragen wie 'Was ist heute bei Nvidia passiert?' oder 'Was war heute wichtig?'.",
      parameters: {
        type: "OBJECT",
        properties: {
          suchwort: { type: "STRING", description: "Begriff aus der Schlagzeile; leer = die wichtigsten Meldungen" },
          stunden: { type: "INTEGER", description: "Zeitraum, Standard 24" },
        },
      },
    },
    {
      name: "pushes_ansehen",
      description: "Zeigt die zuletzt gesendeten Push-Nachrichten mit Begründung. Für Fragen wie 'Warum habe ich diesen Push bekommen?'.",
      parameters: { type: "OBJECT", properties: { anzahl: { type: "INTEGER" } } },
    },
  ],
}];

// deno-lint-ignore no-explicit-any
type Json = any;

async function findTopic(name: string): Promise<Json | null> {
  const { data } = await admin.from("topics").select("*");
  const n = normalize(name).trim();
  const all = data ?? [];
  return all.find((t: Json) => normalize(t.name) === n) ?? all.find((t: Json) => normalize(t.name).includes(n) || n.includes(normalize(t.name))) ?? null;
}

const clampInt = (v: unknown, lo: number, hi: number): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : undefined;
};
const hhmm = (v: unknown): string | undefined => (typeof v === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(v.trim()) ? v.trim().padStart(5, "0") : undefined);
const strList = (v: unknown, max = 8): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter((x) => x.length >= 2 && x.length <= 40).slice(0, max) : []);

/** Führt einen Werkzeug-Aufruf aus. Ergebnis geht zurück an die KI; `done` ist die Notiz für den Nutzer. */
async function runTool(name: string, a: Json, cfg: Compiled): Promise<{ result: Json; done?: string }> {
  switch (name) {
    case "thema_anlegen": {
      const nm = String(a.name ?? "").trim().slice(0, 40);
      const kw = strList(a.suchbegriffe, 6);
      if (nm.length < 2) return { result: { fehler: "Name fehlt" } };
      if (await findTopicExact(nm)) return { result: { fehler: `Thema „${nm}“ gibt es schon – nutze thema_aendern.` } };
      const prio = clampInt(a.wichtigkeit, 1, 3) ?? 2;
      const stock = !!a.aktie;
      const { error } = await admin.from("topics").insert({
        kind: stock ? "stock" : "topic", name: nm, emoji: String(a.emoji ?? "").slice(0, 8) || (stock ? "📈" : "⭐"),
        keywords: kw.length ? kw : [nm], priority: prio, ticker: stock && a.kuerzel ? String(a.kuerzel).toUpperCase().slice(0, 12) : null,
        events: stock ? ["leadership", "earnings", "ma", "market_move", "legal"] : [], category: stock ? "boerse" : null, origin: "assistent",
      });
      if (error) return { result: { fehler: error.message } };
      return { result: { ok: true }, done: `Thema „${nm}“ angelegt (${PRIO_NAME[prio]})` };
    }
    case "thema_aendern": {
      const t = await findTopic(String(a.thema ?? ""));
      if (!t) return { result: { fehler: `Kein Thema namens „${a.thema}“ gefunden.` } };
      const patch: Json = {};
      const notes: string[] = [];
      const prio = clampInt(a.wichtigkeit, 0, 3);
      if (prio !== undefined && prio !== t.priority) {
        patch.priority = prio;
        notes.push(`jetzt „${PRIO_NAME[prio]}“`);
      }
      const add = strList(a.suchbegriffe_hinzu), rm = strList(a.suchbegriffe_weg).map((x) => x.toLowerCase());
      if (add.length || rm.length) {
        const kw = [...t.keywords.filter((k: string) => !rm.includes(k.toLowerCase())), ...add.filter((k) => !t.keywords.some((x: string) => x.toLowerCase() === k.toLowerCase()))];
        if (kw.length) {
          patch.keywords = kw;
          if (add.length) notes.push(`Suchbegriffe ergänzt: ${add.join(", ")}`);
          if (rm.length) notes.push(`Suchbegriffe entfernt: ${rm.join(", ")}`);
        }
      }
      const ex = strList(a.ausschliessen_hinzu);
      if (ex.length) {
        patch.exclude = [...new Set([...(t.exclude ?? []), ...ex])];
        notes.push(`schließt aus: ${ex.join(", ")}`);
      }
      if (a.neuer_name && String(a.neuer_name).trim().length >= 2) {
        patch.name = String(a.neuer_name).trim().slice(0, 40);
        notes.push(`heißt jetzt „${patch.name}“`);
      }
      if (!Object.keys(patch).length) return { result: { hinweis: "Nichts zu ändern.", stand: { wichtigkeit: t.priority, suchbegriffe: t.keywords } } };
      const { error } = await admin.from("topics").update(patch).eq("id", t.id);
      if (error) return { result: { fehler: error.message } };
      return { result: { ok: true }, done: `„${t.name}“: ${notes.join("; ")}` };
    }
    case "thema_loeschen": {
      const t = await findTopic(String(a.thema ?? ""));
      if (!t) return { result: { fehler: `Kein Thema namens „${a.thema}“ gefunden.` } };
      const { error } = await admin.from("topics").delete().eq("id", t.id);
      if (error) return { result: { fehler: error.message } };
      return { result: { ok: true }, done: `Thema „${t.name}“ gelöscht` };
    }
    case "stummschalten": {
      const add = strList(a.hinzu).map((x) => x.toLowerCase()), rm = strList(a.weg).map((x) => x.toLowerCase());
      if (!add.length && !rm.length) return { result: { hinweis: "Nichts angegeben." } };
      const cur: string[] = cfg.settings.muted ?? [];
      const next = [...new Set([...cur.filter((x) => !rm.includes(x)), ...add])];
      const { error } = await admin.from("settings").update({ muted: next }).eq("id", true);
      if (error) return { result: { fehler: error.message } };
      cfg.settings.muted = next;
      const notes = [add.length ? `ausgeblendet: ${add.join(", ")}` : "", rm.length ? `wieder sichtbar: ${rm.join(", ")}` : ""].filter(Boolean);
      return { result: { ok: true }, done: `Stummschalten – ${notes.join("; ")}` };
    }
    case "push_einstellen": {
      const p: Json = {};
      const notes: string[] = [];
      const set = (key: string, val: unknown, note: string) => {
        if (val !== undefined && val !== null) {
          p[key] = val;
          notes.push(note);
        }
      };
      if (typeof a.push_an === "boolean") set("push_enabled", a.push_an, a.push_an ? "Push an" : "Push aus");
      const s1 = clampInt(a.schwelle_aktien, 50, 98), s2 = clampInt(a.schwelle_themen, 50, 98), s3 = clampInt(a.schwelle_welt, 75, 99);
      if (s1 !== undefined) set("thr_stocks", s1, `Aktien-Schwelle ${s1}`);
      if (s2 !== undefined) set("thr_topics", s2, `Themen-Schwelle ${s2}`);
      if (s3 !== undefined) set("thr_world", s3, `Welt-Schwelle ${s3}`);
      if (typeof a.weltereignisse === "boolean") set("world_push", a.weltereignisse, a.weltereignisse ? "Weltereignisse an" : "Weltereignisse aus");
      if (typeof a.ruhezeit_an === "boolean") set("quiet_enabled", a.ruhezeit_an, a.ruhezeit_an ? "Ruhezeit an" : "Ruhezeit aus");
      const qs = hhmm(a.ruhezeit_von), qe = hhmm(a.ruhezeit_bis);
      if (qs) set("quiet_start", qs, `Ruhe ab ${qs}`);
      if (qe) set("quiet_end", qe, `Ruhe bis ${qe}`);
      if (typeof a.aktien_in_ruhezeit === "boolean") set("quiet_allow_stocks", a.aktien_in_ruhezeit, a.aktien_in_ruhezeit ? "Aktien dürfen nachts stören" : "Aktien nachts still");
      if (typeof a.digest_an === "boolean") set("digest_enabled", a.digest_an, a.digest_an ? "Digest an" : "Digest aus");
      if (Array.isArray(a.digest_zeiten)) {
        const times = a.digest_zeiten.map(hhmm).filter((x: string | undefined): x is string => !!x).slice(0, 4);
        if (times.length) set("digest_times", times, `Digest um ${times.join(", ")}`);
      }
      if (typeof a.kursalarm_an === "boolean") set("price_alerts", a.kursalarm_an, a.kursalarm_an ? "Kursalarm an" : "Kursalarm aus");
      const pct = Number(a.kursalarm_prozent);
      if (Number.isFinite(pct) && pct > 0) set("price_move_pct", Math.max(1, Math.min(15, Math.round(pct * 2) / 2)), `Kursalarm ab ${pct} %`);
      if (!Object.keys(p).length) return { result: { hinweis: "Nichts zu ändern." } };
      const { error } = await admin.from("settings").update(p).eq("id", true);
      if (error) return { result: { fehler: error.message } };
      return { result: { ok: true }, done: `Push-Regeln: ${notes.join(", ")}` };
    }
    case "vorliebe_merken": {
      const rule = String(a.regel ?? "").trim().slice(0, 200);
      if (rule.length < 5) return { result: { fehler: "Regel fehlt" } };
      const cur = (cfg.settings.profile_text ?? "").trim();
      const next = truncate((cur ? cur + "\n" : "") + "• " + rule, 1900);
      const { error } = await admin.from("settings").update({ profile_text: next }).eq("id", true);
      if (error) return { result: { fehler: error.message } };
      cfg.settings.profile_text = next;
      // Zusätzlich die gelernten Wortgewichte anstoßen
      const up = strList(a.mehr_davon).flatMap((w) => tokenize(w)), down = strList(a.weniger_davon).flatMap((w) => tokenize(w));
      for (const [terms, col] of [[up, "pos"], [down, "neg"]] as const) {
        for (const term of terms) {
          const { data: row } = await admin.from("term_weights").select("pos,neg").eq("term", term).maybeSingle();
          await admin.from("term_weights").upsert({ term, display: term, pos: (row?.pos ?? 0) + (col === "pos" ? 4 : 0), neg: (row?.neg ?? 0) + (col === "neg" ? 4 : 0) }, { onConflict: "term" });
        }
      }
      return { result: { ok: true }, done: `Gemerkt: ${rule}` };
    }
    case "quelle_schalten": {
      const q = normalize(String(a.quelle ?? "")).trim();
      if (q.length < 2) return { result: { fehler: "Quelle fehlt" } };
      const { data } = await admin.from("sources").select("id,name,enabled").is("topic_id", null);
      const hits = (data ?? []).filter((s: Json) => normalize(s.name).includes(q));
      if (!hits.length) return { result: { fehler: `Keine Quelle gefunden, die „${a.quelle}“ enthält.`, beispiele: (data ?? []).slice(0, 15).map((s: Json) => s.name) } };
      const on = !!a.an;
      const { error } = await admin.from("sources").update({ enabled: on, broken: false, fail_count: 0 }).in("id", hits.map((h: Json) => h.id));
      if (error) return { result: { fehler: error.message } };
      return { result: { ok: true, betroffen: hits.map((h: Json) => h.name) }, done: `Quelle ${on ? "eingeschaltet" : "ausgeschaltet"}: ${hits.map((h: Json) => h.name).join(", ")}` };
    }
    case "meldungen_suchen": {
      const hours = clampInt(a.stunden, 1, 96) ?? 24;
      const since = new Date(Date.now() - hours * 3600_000).toISOString();
      let q = admin.from("stories").select("id,title,summary,summary_ai,source_name,source_count,sort_at,importance,tier").gt("sort_at", since).gt("tier", 0);
      const word = String(a.suchwort ?? "").trim();
      if (word) q = q.ilike("title", `%${word.replace(/[%_]/g, "")}%`).order("sort_at", { ascending: false });
      else q = q.gte("tier", 2).order("importance", { ascending: false });
      const { data, error } = await q.limit(12);
      if (error) return { result: { fehler: error.message } };
      return { result: { meldungen: (data ?? []).map((s: Json) => ({ id: s.id, titel: s.title, kurz: truncate(s.summary_ai || s.summary || "", 200), quelle: s.source_name, quellen: s.source_count, zeit: s.sort_at, wichtigkeit: Math.round(s.importance) })) } };
    }
    case "pushes_ansehen": {
      const n = clampInt(a.anzahl, 1, 20) ?? 8;
      const { data } = await admin.from("push_log").select("title,body,reason,sent_at,kind").order("sent_at", { ascending: false }).limit(n);
      return { result: { pushes: data ?? [] } };
    }
    default:
      return { result: { fehler: "Unbekanntes Werkzeug" } };
  }
}

async function findTopicExact(name: string): Promise<boolean> {
  const { data } = await admin.from("topics").select("name");
  return (data ?? []).some((t: Json) => normalize(t.name) === normalize(name));
}

function systemPrompt(cfg: Compiled, story: Json | null): string {
  const s = cfg.settings;
  const topics = cfg.raw.topics ?? [];
  const list = (p: number) => topics.filter((t) => t.priority === p).map((t) => t.name).join(", ") || "–";
  const lp = new Intl.DateTimeFormat("de-DE", { timeZone: s.timezone || "Europe/Berlin", dateStyle: "full", timeStyle: "short" }).format(new Date());
  let p = `Du bist der Assistent in einer persönlichen Nachrichten-App. Du sprichst Deutsch, duzt den Nutzer, antwortest kurz, klar und ohne Fachbegriffe.

Du kannst zwei Dinge:
1. Erklären: Meldungen einordnen, Begriffe erklären, Fragen zu den gesammelten Nachrichten beantworten (nutze dafür meldungen_suchen und pushes_ansehen, erfinde keine Nachrichten).
2. Den Algorithmus umstellen: Wenn der Nutzer sagt, was ihn stört oder was er will, ändere es SOFORT mit den Werkzeugen, ohne erst um Erlaubnis zu fragen. Frage nur nach, wenn wirklich unklar ist, was gemeint ist. Mehrere Änderungen auf einmal sind erlaubt.

Wie der Algorithmus arbeitet: Jede Meldung bekommt eine Wichtigkeit (0–100). Ein Push kommt, wenn sie zu einem Thema mit „Sofort-Push“ passt und über der Schwelle liegt. Themen mit „Wichtig“ stehen oben in der App. Welche Hebel wofür:
- „Zu viele Pushes zu X“ → Thema X auf Wichtig (2) stellen oder die Schwelle anheben.
- „Ich will X sofort wissen“ → Thema X anlegen oder auf Sofort-Push (3) stellen.
- „X interessiert mich nicht mehr“ → Thema auf 1 stellen, ausblenden (0) oder löschen.
- „So etwas will ich nie sehen“ (ein Wort) → stummschalten.
- Arten von Meldungen (Nachrufe, Analystenmeinungen, Promi-News …) → vorliebe_merken.
- Falsche Treffer bei einem Thema → Suchbegriffe ändern oder Ausschlüsse ergänzen.
Den Programmcode der App kannst du nicht ändern. Wenn etwas in der App kaputt ist (ein Knopf geht nicht, etwas sieht falsch aus), sag ehrlich, dass der Nutzer das dem Entwickler melden muss.

Sag nach einer Änderung in einem Satz, was du gemacht hast und was das bewirkt. Kein Markdown, keine Aufzählungszeichen mit Sternchen.

Jetzt: ${lp}.
Aktuelle Einstellungen des Nutzers:
- Sofort-Push: ${list(3)}
- Wichtig: ${list(2)}
- Nur in der App: ${list(1)}
- Ausgeblendet: ${list(0)}
- Stummgeschaltete Wörter: ${(s.muted ?? []).join(", ") || "–"}
- Schwellen: Aktien ${s.thr_stocks}, Themen ${s.thr_topics}, Welt ${s.thr_world}; Weltereignisse ${s.world_push ? "an" : "aus"}; Push insgesamt ${s.push_enabled ? "an" : "aus"}
- Ruhezeit: ${s.quiet_enabled ? `${s.quiet_start}–${s.quiet_end}` : "aus"}; Digest: ${s.digest_enabled ? (s.digest_times ?? []).join(", ") : "aus"}; Kursalarm: ${s.price_alerts ? `ab ${s.price_move_pct} %` : "aus"}
- Gemerkte Vorlieben: ${truncate(s.profile_text ?? "", 500) || "–"}`;
  if (story) {
    p += `\n\nDer Nutzer hat gerade diese Meldung geöffnet und fragt vermutlich dazu:
Titel: ${story.title}
Kurztext: ${truncate(story.summary_ai || story.summary || "", 500)}
Quelle: ${story.source_name ?? ""} (${story.source_count} Quellen), Wichtigkeit ${Math.round(story.importance)}, Themen: ${(story.topic_names ?? []).join(", ") || "–"}
Weitere Schlagzeilen dazu: ${(story.other_titles ?? []).join(" | ") || "–"}
Erkläre nur, was aus diesen Angaben und deinem Allgemeinwissen hervorgeht, und sag dazu, wenn du etwas nicht sicher weißt.`;
  }
  return p;
}

export async function runAssistant(key: string, model: string, cfg: Compiled, turns: ChatTurn[], storyId: number | null): Promise<AssistantResult> {
  let story: Json | null = null;
  if (storyId) {
    const { data } = await admin.from("stories").select("id,title,summary,summary_ai,source_name,source_count,importance,matched").eq("id", storyId).maybeSingle();
    if (data) {
      const { data: arts } = await admin.from("articles").select("title,publisher").eq("story_id", storyId).limit(6);
      story = {
        ...data,
        topic_names: (cfg.raw.topics ?? []).filter((t) => (data.matched ?? []).includes(t.id)).map((t) => t.name),
        other_titles: (arts ?? []).map((x: Json) => `${x.publisher ?? ""}: ${x.title}`),
      };
    }
  }
  const contents: Json[] = turns.slice(-12).map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: truncate(t.text, 2000) }] }));
  const actions: string[] = [];
  for (let round = 0; round < 5; round++) {
    const r = await xfetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt(cfg, story) }] },
        contents,
        tools: TOOLS,
        generationConfig: { temperature: 0.4, maxOutputTokens: 1500 },
      }),
      timeoutMs: 25000,
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
    const content = j?.candidates?.[0]?.content;
    const parts: Json[] = content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length) {
      const text = parts.filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("").trim();
      return { text: text || (actions.length ? "Erledigt." : "Dazu ist mir gerade nichts eingefallen. Formuliere es bitte noch einmal anders."), actions };
    }
    // Antwort der KI unverändert zurückgeben (samt Signaturen), dann die Ergebnisse der Werkzeuge
    contents.push(content);
    const responses: Json[] = [];
    for (const c of calls) {
      let out: { result: Json; done?: string };
      try {
        out = await runTool(String(c.functionCall.name), c.functionCall.args ?? {}, cfg);
      } catch (e) {
        out = { result: { fehler: e instanceof Error ? e.message : String(e) } };
      }
      if (out.done) actions.push(out.done);
      responses.push({ functionResponse: { name: c.functionCall.name, response: out.result } });
    }
    contents.push({ role: "user", parts: responses });
  }
  return { text: actions.length ? "Erledigt." : "Das hat länger gedauert als erwartet. Versuch es bitte noch einmal.", actions };
}
