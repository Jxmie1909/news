// Prüft das Bündeln: gleiche Ereignisse zusammen, verschiedene getrennt.
import { createClient } from "@supabase/supabase-js";
import { SERVICE_KEY } from "./keys.mjs";
const text = await import("../supabase/functions/news/text.ts");
const sb = createClient("http://127.0.0.1:54321", SERVICE_KEY, { auth: { persistSession: false } });
const groups = {
  beben: ["Erdbeben der Stärke 7,1 erschüttert Japan", "Schweres Erdbeben in Japan – Tsunami-Warnung ausgegeben", "Japan: Starkes Erdbeben vor der Küste, Tsunami-Warnung", "Starkes Erdbeben erschüttert Japan"],
  zoll: ["Trump kündigt neue Zölle gegen China an", "USA: Trump verhängt neue Zölle gegen China", "Trump erhöht Zölle auf chinesische Waren"],
  xi: ["Trump kündigt Treffen mit Xi in China an", "Trump will Xi Jinping in Peking treffen"],
  bayern1: ["Bayern München gewinnt gegen Dortmund 3:1", "FC Bayern schlägt Dortmund im Topspiel"],
  bayern2: ["Bayern München verliert gegen Leipzig 0:2", "Leipzig schlägt Bayern München mit 2:0"],
  gta: ["Rockstar verschiebt GTA 6 auf 2027", "GTA 6 verschoben: Rockstar nennt neuen Termin", "GTA 6 erscheint erst 2027 – Rockstar bestätigt Verschiebung"],
  gta2: ["GTA 6: Neuer Trailer zeigt Vice City", "Rockstar veröffentlicht dritten Trailer zu GTA 6"],
  nv: ["Nvidia-Chef Huang tritt überraschend zurück", "Paukenschlag bei Nvidia: Chef Jensen Huang tritt zurück", "Nvidia: Huang tritt als Chef zurück", "Jensen Huang gibt Führung von Nvidia ab"],
  nv2: ["Nvidia übertrifft mit Quartalszahlen die Erwartungen", "Nvidia-Zahlen: Umsatz und Gewinn über den Erwartungen"],
  en1: ["Nvidia CEO Jensen Huang steps down", "Nvidia boss Jensen Huang steps down in surprise move", "Jensen Huang to step down as Nvidia CEO, company says"],
  en2: ["Nvidia beats quarterly revenue estimates on AI demand", "Nvidia revenue tops estimates as AI chip demand surges"],
  einzeln: ["Bundestag beschließt Rentenpaket nach langer Debatte", "Sturmtief zieht über Norddeutschland hinweg", "Apple stellt neues iPhone vor", "Bundesliga: Hamburg holt Punkt in Bremen", "EZB senkt Leitzins um 0,25 Punkte", "Fed lässt Leitzins unverändert"],
};
const pubs = ["tagesschau", "spiegel", "zeit", "faz", "ntv", "bbc", "reuters", "heise"];
const items = [];
let n = 0;
// gemischt einspielen, wie im echten Betrieb
const order = [];
for (const [g, titles] of Object.entries(groups)) titles.forEach((t, i) => order.push({ g, t, i }));
order.sort((a, b) => a.i - b.i);
for (const { g, t, i } of order) {
  const pk = pubs[i % pubs.length];
  n++;
  items.push({ source_id: null, topic_id: null, publisher: pk, publisher_key: pk, url: `https://c.test/${n}`, url_hash: text.hash(`https://c.test/${n}`), title: t, title_key: text.titleKey(pk, t), summary: "", image: null, published_at: new Date().toISOString(), lang: /steps|beats|tops/.test(t) ? "en" : "de", category: null, weight: 1, breaking: false, backfill: false, tokens: text.tokenize(t), _g: g });
}
// etwas Grundrauschen für die Worthäufigkeit
const noise = ["Trump äußert sich zu China", "Trump telefoniert mit Putin", "China meldet Wachstum", "Nvidia präsentiert neue Chips", "Bayern München vor dem Spiel", "Japan wählt neues Parlament", "Trump besucht Florida", "Nvidia-Aktie im Fokus", "Rockstar sucht Entwickler", "Bayern München verlängert mit Trainer"].map((t, i) => ({ source_id: null, topic_id: null, publisher: "x", publisher_key: "noise" + i, url: `https://n.test/${i}`, url_hash: text.hash(`https://n.test/${i}`), title: t, title_key: text.titleKey("noise" + i, t), summary: "", image: null, published_at: new Date().toISOString(), lang: "de", category: null, weight: 1, breaking: false, backfill: false, tokens: text.tokenize(t) }));
// Worthäufigkeiten wie im echten Betrieb (geschätzt): Allerweltswörter kommen sehr oft vor
import { execFileSync } from "node:child_process";
const df = { trump: 300, china: 150, usa: 200, kuendi: 100, nvidia: 60, bayern: 80, muench: 60, japan: 30, rockst: 10, gta: 15, chef: 150, tritt: 40, zuruec: 60, treffe: 60, zoelle: 40, dortmu: 40, leipzi: 30, erwart: 30, zahlen: 80, umsatz: 50, gewinn: 90, ceo: 120, revenu: 40, estima: 30, demand: 30, apple: 60, bundes: 200, leitzi: 20, erdbeb: 5, tsunam: 3, warnun: 40, huang: 10, jensen: 8, steps: 15, down: 40, beats: 20 };
execFileSync("psql", ["postgres://postgres:postgres@127.0.0.1:5432/news", "-qc", "insert into private.token_df (token, df) values " + Object.entries(df).map(([k, v]) => `('${k}', ${v})`).join(",") + " on conflict (token) do update set df = excluded.df"]);
let r = await sb.rpc("ingest", { p_items: noise });
if (r.error) throw new Error(r.error.message);
const map = new Map();
for (const it of items) {
  const { _g, ...row } = it;
  r = await sb.rpc("ingest", { p_items: [row] });
  if (r.error) throw new Error(r.error.message);
  const id = r.data[0].id;
  if (!map.has(_g)) map.set(_g, []);
  map.get(_g).push({ id, title: it.title, joined: r.data[0].title !== it.title ? r.data[0].title : null });
}
let good = 0, bad = 0;
for (const [g, rows] of map) {
  const ids = new Set(rows.map((x) => x.id));
  if (g === "einzeln") {
    const okk = ids.size === rows.length;
    okk ? good++ : bad++;
    console.log(`${okk ? "✓" : "✗"} ${g}: ${ids.size}/${rows.length} getrennt`);
    if (!okk) rows.filter((x) => x.joined).forEach((x) => console.log(`     „${x.title}“ → „${x.joined}“`));
  } else {
    const okk = ids.size === 1;
    okk ? good++ : bad++;
    console.log(`${okk ? "✓" : "~"} ${g}: ${rows.length} Schlagzeilen → ${ids.size} Meldung(en)`);
  }
}
// Fremd-Zusammenlegungen zwischen Gruppen
const owner = new Map();
let cross = 0;
for (const [g, rows] of map) for (const x of rows) {
  if (owner.has(x.id) && owner.get(x.id) !== g) { cross++; console.log(`✗ FALSCH zusammengelegt: ${g} mit ${owner.get(x.id)}: „${x.title}“`); }
  else owner.set(x.id, g);
}
console.log(`\nGruppen vollständig: ${good}, unvollständig: ${bad}, falsch zusammengelegt: ${cross}`);
await sb.from("stories").delete().like("url", "https://c.test/%");
await sb.from("stories").delete().like("url", "https://n.test/%");
process.exit(0);
