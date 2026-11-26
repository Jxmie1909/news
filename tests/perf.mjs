// Belastungsprobe: 3000 Artikel in Stapeln einspielen und die Dauer messen.
import { createClient } from "@supabase/supabase-js";
import { SERVICE_KEY } from "./keys.mjs";
const text = await import("../supabase/functions/news/text.ts");
const sb = createClient("http://127.0.0.1:54321", SERVICE_KEY, { auth: { persistSession: false } });
const words = "Regierung Bundestag Trump China Nvidia Apple Aktie Kurs Gewinn Umsatz Prognose Streik Bahn Wetter Sturm Polizei Gericht Urteil Wahl Partei Minister Kanzler Ukraine Russland Israel Gaza Iran Zölle Handel Börse DAX Zinsen EZB Inflation Preise Miete Rente Steuer Schule Klinik Studie Forscher Klima Energie Strom Gas Auto Tesla Bayern Dortmund Trainer Transfer Spiel Sieg Niederlage Film Serie Netflix Album Tour Festival Rakete SpaceX NASA Mond Mars KI OpenAI Google Microsoft Chip Fabrik Übernahme Insolvenz Stellenabbau Rückruf Warnung Unfall Brand Explosion Erdbeben Flut Hitze Schnee".split(" ");
const pick = () => words[Math.floor(Math.random() * words.length)];
const items = [];
for (let i = 0; i < 3000; i++) {
  const title = Array.from({ length: 5 + Math.floor(Math.random() * 4) }, pick).join(" ") + " " + i % 700;
  const pk = "p" + (i % 40);
  items.push({ source_id: null, topic_id: null, publisher: pk, publisher_key: pk, url: `https://perf.test/${i}`, url_hash: text.hash(`https://perf.test/${i}`), title, title_key: text.titleKey(pk, title), summary: "", image: null, published_at: new Date().toISOString(), lang: "de", category: null, weight: 1, breaking: false, backfill: true, tokens: text.tokenize(title) });
}
let worst = 0;
const t0 = Date.now();
for (let i = 0; i < items.length; i += 50) {
  const t = Date.now();
  const r = await sb.rpc("ingest", { p_items: items.slice(i, i + 50) });
  if (r.error) throw new Error(r.error.message);
  worst = Math.max(worst, Date.now() - t);
}
const total = Date.now() - t0;
const { count } = await sb.from("stories").select("id", { count: "exact", head: true }).like("url", "https://perf.test/%");
console.log(`3000 Artikel in ${total} ms (${(total / 60).toFixed(0)} ms je 50er-Stapel im Schnitt, langsamster ${worst} ms), ${count} Meldungen`);
const t1 = Date.now();
await sb.rpc("rescore_batch", { p_after_id: 0, p_limit: 400 });
console.log(`Stapel zum Neubewerten laden: ${Date.now() - t1} ms`);
await sb.from("stories").delete().like("url", "https://perf.test/%");
process.exit(0);
