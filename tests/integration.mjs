// Gesamttest gegen die lokale Umgebung: Einrichtung → Themen → Abruf → Bündeln → Bewerten → Push.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY } from "./keys.mjs";

const URL_ = "http://127.0.0.1:54321";
const MOCK = "http://127.0.0.1:9955";
const DB = "postgres://postgres:postgres@127.0.0.1:5432/news";
const sql = (q) => execFileSync("psql", [DB, "-Atc", q], { encoding: "utf8" }).trim();
const fn = async (action, body = {}, headers = {}) => {
  const r = await fetch(`${URL_}/functions/v1/news?action=${action}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const mock = async (patch) => (await fetch(`${MOCK}/__state`, { method: patch ? "POST" : "GET", body: patch ? JSON.stringify(patch) : undefined })).json();
let n = 0;
const step = (name) => console.log(`\n${String(++n).padStart(2, "0")}. ${name}`);
const ok = (msg) => console.log("    ✓ " + msg);

const secret = sql("select value from private.secrets where key='cron_secret'");
const tick = async () => {
  const r = await fn("tick&wait=1", {}, { "x-cron-secret": secret });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};
// Pro Abruf werden höchstens 20 Quellen geholt: so oft abrufen, bis nichts mehr fällig ist
const drain = async () => {
  const sum = { status: "ok", sources: 0, failed: 0, items: 0, stories: 0, pushed: 0, llm: 0, alerts: 0, rescored: 0, rounds: 0 };
  for (let i = 0; i < 12; i++) {
    const r = await tick();
    assert.equal(r.status, "ok", JSON.stringify(r));
    for (const k of ["sources", "failed", "items", "stories", "pushed", "llm", "alerts", "rescored"]) sum[k] += r[k] ?? 0;
    sum.rounds++;
    if (!r.sources) break;
  }
  return sum;
};
const allDue = () => sql("update public.sources set next_fetch_at = now() - interval '1 second' where enabled; update public.price_state set next_check_at = now() - interval '1 second'");

await mock({ phase: 0, price: "calm", geminiMode: "ok", fail: {} });
await fetch(`${MOCK}/__reset`);

step("Vor der Einrichtung");
assert.deepEqual((await fn("status")).body, { setup_done: false });
ok("Status meldet: noch nicht eingerichtet");
assert.equal((await tick()).status, "idle");
ok("Abruf ruht, solange es keinen Besitzer gibt");
assert.equal((await fn("tick&wait=1", {}, { "x-cron-secret": "falsch" })).status, 403);
ok("Abruf mit falschem Geheimnis wird abgelehnt");
assert.equal((await fn("test_push")).status, 401);
ok("Aktionen ohne Anmeldung werden abgelehnt");

step("Einrichtung");
assert.equal((await fn("setup", { email: "kein-email", password: "12345678" })).status, 400);
assert.equal((await fn("setup", { email: "ich@test.dev", password: "kurz" })).status, 400);
const setup = await fn("setup", { email: "ich@test.dev", password: "geheim-12345" });
assert.equal(setup.status, 200, JSON.stringify(setup.body));
ok("Konto angelegt");
assert.equal((await fn("setup", { email: "zweiter@test.dev", password: "geheim-12345" })).status, 409);
ok("Zweite Einrichtung wird abgelehnt");
assert.deepEqual((await fn("status")).body, { setup_done: true });

step("Anmeldung und Zugriffsschutz");
const sb = createClient(URL_, ANON_KEY, { auth: { persistSession: false } });
const anon = createClient(URL_, ANON_KEY, { auth: { persistSession: false } });
const bad = await sb.auth.signInWithPassword({ email: "ich@test.dev", password: "falsch-falsch" });
assert.ok(bad.error);
const login = await sb.auth.signInWithPassword({ email: "ich@test.dev", password: "geheim-12345" });
assert.equal(login.error, null);
const token = login.data.session.access_token;
const auth = { Authorization: `Bearer ${token}` };
ok("Anmeldung mit Passwort klappt");
for (const f of ["app_bootstrap", "feed_today", "system_status"]) {
  const r = await anon.rpc(f);
  assert.ok(r.error, `${f} darf ohne Anmeldung nicht gehen`);
}
assert.ok((await anon.rpc("service_config")).error);
assert.ok((await anon.rpc("ingest", { p_items: [] })).error);
assert.ok((await sb.rpc("service_config")).error, "auch der Besitzer darf keine Dienst-Funktionen aufrufen");
assert.ok((await sb.rpc("tick_begin", { p_secret: "x" })).error);
assert.equal(((await anon.from("stories").select("id")).data ?? []).length, 0);
assert.equal(((await anon.from("settings").select("*")).data ?? []).length, 0);
ok("Ohne Anmeldung ist nichts lesbar, Dienst-Funktionen sind gesperrt");
// Fremde können sich nicht registrieren
const stranger = createClient(URL_, ANON_KEY, { auth: { persistSession: false } });
const su = await stranger.auth.signUp({ email: "fremd@test.dev", password: "fremd-12345" });
assert.ok(su.error, "Registrierung muss abgelehnt werden");
assert.equal(sql("select count(*) from auth.users"), "1");
assert.ok((await stranger.auth.signInWithPassword({ email: "fremd@test.dev", password: "fremd-12345" })).error);
ok("Fremde Registrierung wird abgelehnt – es gibt nur das eine Konto");

step("Start der App");
let boot = (await sb.rpc("app_bootstrap")).data;
assert.equal(boot.settings.onboarding_done, false);
assert.ok(boot.vapid_public_key?.length > 80);
assert.match(boot.settings.ntfy_topic, /^news-[0-9a-f]{20}$/);
ok("Einstellungen und Push-Schlüssel sind da");

step("Bereiche und Themen");
assert.equal((await sb.rpc("set_categories", { p_categories: ["boerse", "gaming", "ki"] })).error, null);
assert.equal(Number(sql("select count(*) from sources where enabled and category='gaming'")) > 5, true);
assert.equal(Number(sql("select count(*) from sources where enabled and category='sport'")), 0);
ok("Quellen der gewählten Bereiche sind aktiv");
const ins = await sb.from("topics").insert([
  { kind: "stock", name: "Nvidia", emoji: "🟢", keywords: ["Nvidia", "NVDA"], priority: 3, ticker: "nvda", events: ["leadership", "earnings", "ma"], category: "boerse", origin: "onboarding" },
  { kind: "topic", name: "GTA 6", emoji: "🎮", keywords: ["GTA 6", "GTA VI", "Rockstar Games"], priority: 3, category: "gaming" },
  { kind: "topic", name: "KI", emoji: "🤖", keywords: ["OpenAI", "KI", "Künstliche Intelligenz"], priority: 2, category: "ki" },
]).select();
assert.equal(ins.error, null, JSON.stringify(ins.error));
const nv = ins.data.find((t) => t.name === "Nvidia");
assert.equal(nv.ticker, "NVDA");
const srcs = sql("select key || '=' || interval_sec from sources where topic_id is not null order by key").split("\n");
assert.equal(srcs.filter((s) => s.startsWith("gnews:")).length, 6);
assert.ok(srcs.some((s) => s.startsWith("yahoo:") && s.endsWith("=45")));
assert.equal(sql("select ticker from price_state"), "NVDA");
assert.match(sql(`select url from sources where key = 'gnews:${nv.id}:de'`), /^"Nvidia" OR "NVDA" when:2d$/);
ok("Zu jedem Thema entstehen Suchquellen (Nachrichtensuche de/en, Yahoo für die Aktie)");
// Ruhezeit zunächst aus, damit der Test zu jeder Uhrzeit gleich läuft (die Ruhezeit wird weiter unten eigens geprüft)
await sb.from("settings").update({ muted: ["Dschungelcamp"], site_url: "https://beispiel.github.io/news/", quiet_enabled: false }).eq("id", true);

step("Push-Gerät anmelden");
const { subscription } = await mock();
assert.equal((await sb.rpc("save_push_subscription", { p_endpoint: subscription.endpoint, p_p256dh: subscription.p256dh, p_auth: subscription.auth, p_ua: "Test" })).error, null);
assert.ok((await sb.rpc("save_push_subscription", { p_endpoint: "http://unsicher", p_p256dh: "x", p_auth: "y" })).error);
const tp = await fn("test_push", {}, auth);
assert.equal(tp.body.ok, true, JSON.stringify(tp.body));
let m = await mock();
assert.equal(m.pushes.length, 1);
assert.equal(m.pushes[0].data.b, "Test: Push-Nachrichten funktionieren ✅");
assert.match(m.pushes[0].authorization, /^vapid t=.+, k=.+/);
assert.equal(m.pushes[0].encoding, "aes128gcm");
ok("Test-Push kommt verschlüsselt an und lässt sich lesen");

step("Erster Abruf (Bestand, ohne Push)");
allDue();
let t = await drain();
console.log("    ", JSON.stringify(t));
assert.ok(t.sources >= 40 && t.items >= 8);
assert.equal(t.pushed, 0);
assert.ok(Number(sql("select count(*) from stories")) >= 7);
assert.equal(sql("select count(*) from stories where not backfill"), "0");
assert.equal(sql("select tier from stories where title ilike 'Dschungelcamp%'"), "0");
const rente = sql("select source_count || '|' || article_count from stories where title ilike '%Rentenpaket%'").split("\n");
assert.deepEqual(rente, ["2|2"]);
ok("Bestand eingelesen; gleiche Meldung zweier Anbieter wurde gebündelt; Stummgeschaltetes ausgeblendet");
m = await mock();
assert.equal(m.pushes.length, 1, "kein Push für alte Meldungen");
t = await tick();
assert.equal(t.sources, 0);
ok("Zweiter Abruf direkt danach: nichts fällig");

step("Eilmeldung erscheint bei mehreren Quellen");
await mock({ phase: 1 });
allDue();
t = await drain();
console.log("    ", JSON.stringify(t));
const nvRow = sql("select id || '|' || source_count || '|' || tier || '|' || round(importance) || '|' || event || '|' || (pushed_at is not null) || '|' || lang from stories where title ilike '%Huang%' order by source_count desc").split("\n");
console.log("    ", nvRow);
const [nvId, nvSources, nvTier, nvImp, nvEvent] = nvRow.find((r) => r.split("|")[5] === "true").split("|");
assert.ok(Number(nvSources) >= 3, "mindestens 3 Anbieter gebündelt");
assert.equal(nvTier, "3");
assert.equal(nvEvent, "leadership");
assert.ok(nvRow.some((r) => r.split("|")[5] === "true"), "eine der Sprachfassungen wurde gemeldet");
assert.equal(t.pushed, 1);
m = await mock();
const sp = m.pushes.filter((p) => p.data.k === "story");
assert.equal(sp.length, 1, "dasselbe Ereignis (deutsch + englisch) nur einmal melden, erhalten: " + sp.length);
assert.equal(sp[0].data.t, "Nvidia · Führungswechsel");
assert.match(sp[0].data.b, /Huang/);
assert.equal(sp[0].urgency, "high");
ok(`Push gesendet: „${sp[0].data.t}“ – ${sp[0].data.b}`);
allDue();
t = await drain();
assert.equal(t.pushed, 0);
ok("Kein doppelter Push beim nächsten Abruf");

step("Feed in der App");
const feed = (await sb.rpc("feed_today", { p_since: new Date(Date.now() - 3600_000).toISOString() })).data;
assert.ok(feed.new.length >= 1);
assert.ok(feed.new.some((s) => /Huang/.test(s.title) && s.topics[0].name === "Nvidia" && s.pushed), JSON.stringify(feed.new.map((s) => s.title)));
const all = [...feed.new, ...feed.seen];
assert.ok(!all.some((s) => /Dschungelcamp/.test(s.title)));
assert.ok(all.every((s) => s.tier >= 2), "auf der Startseite steht nur Wichtiges");
ok(`Heute: ${feed.new.length} neu seit dem letzten Besuch, ${feed.seen.length} schon gesehen`);
const det = (await sb.rpc("story_detail", { p_id: Number(nvId) })).data;
assert.ok(det.articles.length >= 3);
assert.ok(det.reasons.some((r) => /Nvidia/.test(r)));
assert.equal(det.read, true);
ok(`Detail: ${det.articles.length} Quellen, Gründe: ${det.reasons.join(" · ")}`);
const tk = (await sb.rpc("feed_ticker", { p_limit: 5 })).data;
assert.equal(tk.length, 5);
const tk2 = (await sb.rpc("feed_ticker", { p_limit: 5, p_before: tk[4].at, p_before_id: tk[4].id })).data;
assert.ok(tk2.length >= 1 && !tk2.some((x) => tk.some((y) => y.id === x.id)));
const byTopic = (await sb.rpc("feed_ticker", { p_topic: nv.id })).data;
assert.ok(byTopic.length >= 2 && byTopic.every((s) => s.topics.some((x) => x.id === nv.id)));
const search = (await sb.rpc("feed_ticker", { p_q: "rentenpaket" })).data;
assert.equal(search.length, 1);
ok("Ticker: Blättern, Themenfilter und Suche");

step("Rückmeldung und Merken");
const thr0 = Number(sql("select thr_stocks from settings"));
let fb = (await sb.rpc("set_feedback", { p_id: Number(nvId), p_value: -1 })).data;
assert.equal(fb.adjust, 3);
assert.equal(Number(sql("select thr_stocks from settings")), thr0 + 3);
fb = (await sb.rpc("set_feedback", { p_id: Number(nvId), p_value: 2 })).data;
assert.equal(sql("select pos || '|' || neg from term_weights where term = 'huang'"), "2|0");
await sb.rpc("set_feedback", { p_id: Number(nvId), p_value: null });
assert.equal(sql("select pos || '|' || neg from term_weights where term = 'huang'"), "0|0");
ok("Daumen wirken auf Lernwerte und Push-Schwelle, lassen sich zurücknehmen");
assert.equal((await sb.rpc("toggle_saved", { p_id: Number(nvId) })).data, true);
assert.equal((await sb.rpc("feed_ticker", { p_saved: true })).data.length, 1);
assert.equal((await sb.rpc("toggle_saved", { p_id: Number(nvId) })).data, false);
ok("Merken und Entfernen");
const samples = (await sb.rpc("onboarding_samples", { p_count: 10 })).data;
assert.ok(samples.length >= 5);
ok(`Interessen-Test liefert ${samples.length} echte Schlagzeilen`);

step("KI-Schlüssel");
let k = await fn("save_key", { key: "bad-key-000000000000000000" }, auth);
assert.equal(k.body.ok, false);
assert.match(k.body.error, /nicht akzeptiert/);
k = await fn("save_key", { key: "good-key-11111111111111111111" }, auth);
assert.equal(k.body.ok, true, JSON.stringify(k.body));
assert.equal(k.body.model, "gemini-flash-lite-latest");
assert.equal(sql("select has_gemini_key from settings"), "t");
boot = (await sb.rpc("app_bootstrap")).data;
assert.ok(!JSON.stringify(boot).includes("good-key"), "Schlüssel wird nie an die App zurückgegeben");
await sb.from("settings").update({ has_gemini_key: false }).eq("id", true);
assert.equal(sql("select has_gemini_key from settings"), "t", "Kennzeichen lässt sich aus der App nicht fälschen");
ok("Ungültiger Schlüssel abgelehnt, gültiger gespeichert und nie wieder herausgegeben");

step("Neue Meldung mit KI-Einordnung");
await mock({ phase: 2 });
await fetch(`${MOCK}/__reset`);
allDue();
t = await drain();
console.log("    ", JSON.stringify(t));
assert.ok(t.llm >= 1);
const ki = sql("select round(importance) || '|' || tier || '|' || coalesce(summary_ai,'') || '|' || source_count from stories where title ilike 'OpenAI stellt%'");
console.log("    ", ki);
assert.match(ki, /\|2\|Kurzfassung der Meldung\.\|2$/);
m = await mock();
assert.ok(m.gemini.filter((g) => g.path.includes("generateContent")).length >= 1);
const prompt = JSON.parse(JSON.parse(m.gemini.at(-1).body).contents[0].parts[0].text);
assert.ok(prompt.profil.aktien[0].startsWith("Nvidia (NVDA)"));
ok("KI hat eingeordnet und zusammengefasst; Profil steckt in der Anfrage");
const sug = await fn("suggest_topics", { text: "Ich mag Raumfahrt und Formel 1" }, auth);
assert.equal(sug.body.ai, true);
assert.equal(sug.body.topics.length, 2);
ok("Themenvorschläge aus Freitext");
await mock({ geminiMode: "quota" });
sql("update stories set llm = null where title ilike 'Sturm%'; update private.state set llm_calls = 0");
const sugQ = await fn("suggest_topics", { text: "Raumfahrt, SpaceX" }, auth);
assert.equal(sugQ.body.ai, false);
assert.equal(sugQ.body.topics.length, 2);
ok("Ohne KI-Kontingent greift der einfache Ersatz");
await mock({ geminiMode: "ok" });

step("Kursalarm");
await mock({ price: "drop" });
await fetch(`${MOCK}/__reset`);
sql("update public.price_state set next_check_at = now() - interval '1 second'");
t = await tick();
console.log("    ", JSON.stringify(t));
assert.equal(t.alerts, 1);
m = await mock();
const pp = m.pushes.find((p) => p.data.k === "price");
assert.ok(pp, "Kurs-Push erwartet");
assert.match(pp.data.t, /^📉 Nvidia −5,5 % in \d+ Min$/);
ok(`Kursalarm: ${pp.data.t} – ${pp.data.b}`);
sql("update public.price_state set next_check_at = now() - interval '1 second'");
t = await tick();
assert.equal(t.alerts, 0);
ok("Kein zweiter Alarm für dieselbe Bewegung");
await mock({ price: "calm" });

step("Ruhezeit");
await mock({ phase: 1 });
sql("update stories set pushed_at = null, first_seen_at = now(), llm = null where title ilike '%Huang%'");
const lp = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
const [hh] = lp.split(":").map(Number);
await sb.from("settings").update({ quiet_enabled: true, quiet_start: `${String(hh).padStart(2, "0")}:00`, quiet_end: `${String((hh + 2) % 24).padStart(2, "0")}:00`, digest_enabled: false }).eq("id", true);
await fetch(`${MOCK}/__reset`);
const r1 = await fn("rescore", {}, auth);
assert.equal(r1.body.ok, true);
const again = async (nonce) => {
  // Dieselbe Meldung taucht unter neuer Adresse erneut auf → die Meldung wird neu geprüft
  await mock({ nonce });
  sql("update sources set next_fetch_at = now() - interval '1 second' where kind = 'yahoo'");
  const r = await tick();
  assert.equal(r.items, 1, JSON.stringify(r));
  return r;
};
t = await again("a");
assert.equal(t.pushed, 0, "in der Ruhezeit kein Push");
ok("Ruhezeit hält Pushes zurück");
await sb.from("settings").update({ quiet_enabled: false }).eq("id", true);
t = await again("c");
assert.equal(t.pushed, 1, "danach wird gepusht: " + JSON.stringify(t));
ok("Nach Aufheben wird wieder gepusht");
t = await again("d");
assert.equal(t.pushed, 0);
ok("Und danach nicht noch einmal");

step("Thema ändern → Neubewertung");
await sb.from("topics").update({ priority: 0 }).eq("name", "KI");
assert.equal(sql("select count(*) from sources where key like 'gnews:%' and name like '%KI'"), "0");
const r2 = await fn("rescore", {}, auth);
assert.ok(r2.body.rescored >= 8);
assert.equal(sql("select tier from stories where title ilike 'OpenAI stellt%'"), "0");
ok("Auf „ausblenden“ gestelltes Thema verschwindet aus dem Feed, seine Quellen werden entfernt");
await sb.from("topics").delete().eq("name", "KI");
sql("update private.state set profile_changed_at = now() - interval '1 minute'");
t = await tick();
assert.ok(t.rescored >= 8, "automatische Neubewertung im Abruf: " + JSON.stringify(t));
assert.equal(sql("select tier > 0 from stories where title ilike 'OpenAI stellt%'"), "t");
ok("Nach dem Löschen ist die Meldung wieder sichtbar (automatisch neu bewertet)");

step("Digest und ntfy");
await sb.from("settings").update({ digest_enabled: true, digest_times: [lp], ntfy_enabled: true }).eq("id", true);
await fetch(`${MOCK}/__reset`);
sql("update stories set read_at = null");
t = await tick();
m = await mock();
const dg = m.pushes.find((p) => p.data.k === "digest");
assert.ok(dg, "Digest-Push erwartet");
assert.match(dg.data.t, /^Dein Digest: \d+ wichtige Meldung/);
assert.equal(m.ntfy.length, 1);
assert.equal(m.ntfy[0].topic, boot.settings.ntfy_topic);
assert.equal(m.ntfy[0].click, "https://beispiel.github.io/news/");
ok(`Digest: ${dg.data.t}; zusätzlich über ntfy zugestellt`);
t = await tick();
m = await mock();
assert.equal(m.pushes.filter((p) => p.data.k === "digest").length, 1);
ok("Digest kommt nur einmal");

step("Fehlerhafte Quelle");
await mock({ fail: { "www.spiegel.de": 503 } });
sql("update sources set next_fetch_at = now() - interval '1 second' where key = 'rss:spiegel'");
t = await tick();
assert.equal(t.failed, 1);
assert.match(sql("select fail_count || '|' || last_error || '|' || (next_fetch_at > now() + interval '2 minutes') from sources where key='rss:spiegel'"), /^1\|HTTP 503\|true$/);
ok("Fehler wird vermerkt, nächster Versuch mit Wartezeit");
await mock({ fail: {} });

step("Jedes Ereignis nur einmal, deutsche Überschrift, ausführliche Zusammenfassung");
await mock({ geminiMode: "ok", phase: 1 });
sql("update stories set llm = null, dup_of = null, title_de = null, tier = 2, sort_at = now() where title ilike '%Huang%'; update private.state set llm_calls = 0, llm_paused_until = null");
let dups = 0;
for (let i = 0; i < 30 && !dups; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  await tick();
  dups = Number(sql("select count(*) from stories where dup_of is not null"));
}
assert.ok(dups >= 1, "die zweite Fassung desselben Ereignisses wurde als Wiederholung erkannt");
const f2 = (await sb.rpc("feed_today", { p_since: new Date(Date.now() - 3600_000).toISOString() })).data;
const huang = [...f2.new, ...f2.seen].filter((s) => /Huang/.test(s.title));
assert.equal(huang.length, 1, "nur eine Huang-Meldung auf der Startseite: " + JSON.stringify(huang.map((h) => h.title)));
assert.ok(huang[0].more >= 1 && huang[0].sources >= 4, JSON.stringify(huang[0]));
assert.ok(!/steps down/.test(huang[0].title), "Überschrift ist deutsch: " + huang[0].title);
ok(`Eine Meldung statt zwei: „${huang[0].title}“ (${huang[0].sources} Quellen, ${huang[0].more} weiterer Bericht zusammengefasst)`);
const dp = await fn("deepen", { story_id: huang[0].id }, auth);
assert.equal(dp.body.ok, true, JSON.stringify(dp.body));
assert.ok(dp.body.deep.absaetze.length >= 4 && dp.body.deep.folgen.length >= 3 && dp.body.deep.einschaetzung.length > 20);
assert.equal(dp.body.deep.grundlage, "artikel");
const det2 = (await sb.rpc("story_detail", { p_id: huang[0].id })).data;
assert.ok(det2.deep_data.absaetze.length >= 4 && det2.articles.length >= 4);
m = await mock();
const deepReq = JSON.parse(JSON.parse(m.gemini.filter((g) => g.body.includes("weitere_schlagzeilen")).at(-1).body).contents[0].parts[0].text);
assert.ok(deepReq.artikel.length >= 1 && /Chiphersteller/.test(deepReq.artikel[0].text) && !/Impressum|Menü/.test(deepReq.artikel[0].text), "nur der Artikeltext, ohne Menü und Fußzeile");
ok(`Ausführliche Zusammenfassung aus ${dp.body.deep.quellen} Originalartikeln, mit Folgen und Einschätzung; wird gespeichert`);
sql("update stories set tier = 1 where title ilike 'Kommentar:%' or title ilike 'Sturmtief%'");

step("Status für die App");
const st = (await sb.rpc("system_status")).data;
assert.ok(st.sources.length > 100 && st.pushes.length >= 3 && st.devices.length === 1);
assert.ok(st.last_tick_info.status === "ok");
ok(`Status: ${st.counts.stories} Meldungen, ${st.pushes.length} Pushes im Verlauf, letzter Abruf ${st.last_tick_ms} ms`);

console.log("\nAlle Schritte bestanden.");
process.exit(0);
