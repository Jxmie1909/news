import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ece = require("http_ece");

const F = "../supabase/functions/news/";
const text = await import(F + "text.ts");
const feeds = await import(F + "feeds.ts");
const score = await import(F + "score.ts");
const webpush = await import(F + "webpush.ts");
const prices = await import(F + "prices.ts");
const llm = await import(F + "llm.ts");

const fx = (n) => fs.readFileSync(new URL("./fixtures/" + n, import.meta.url), "utf8")
  .replaceAll("__NOW_RFC__", new Date().toUTCString()).replaceAll("__NOW_ISO__", new Date().toISOString());

test("Text: Normalisieren und Wörter", () => {
  assert.equal(text.normalize("Rücktritt in Köln: Größe"), "ruecktritt in koeln: groesse");
  const t = text.tokenize("Nvidia-Chef Huang tritt überraschend zurück");
  assert.deepEqual(t, ["nvidia", "chef", "huang", "tritt", "ueberr", "zuruec"]);
  assert.ok(text.tokenize("Die 5G-Auktion und der Q3-Bericht").includes("5g"));
  assert.equal(text.decodeEntities("A &amp; B &#223; &#x41; &auml;"), "A & B ß A ä");
  assert.equal(text.stripTags("<p>Hallo <b>Welt</b> &amp; mehr</p>"), "Hallo Welt & mehr");
});

test("Text: Adressen und Anbieter", () => {
  assert.equal(text.normalizeUrl("https://WWW.Example.com/a?utm_source=x&id=5#top"), "https://www.example.com/a?id=5");
  assert.equal(text.publisherKeyFromUrl("https://www.tagesschau.de/inland/x.html"), "tagesschau");
  assert.equal(text.publisherKeyFromUrl("https://feeds.bbci.co.uk/news/rss.xml"), "bbc");
  assert.equal(text.publisherKeyFromUrl("https://www.bbc.co.uk/news/1"), "bbc");
  assert.equal(text.publisherKeyFromName("DER SPIEGEL"), "spiegel");
  assert.equal(text.publisherKeyFromName("tagesschau.de"), "tagesschau");
  assert.equal(text.publisherKeyFromName("ZEIT ONLINE"), "zeit");
  assert.notEqual(text.hash("a"), text.hash("b"));
  assert.equal(text.hash("abc").length, 32);
});

test("Feeds: RSS", () => {
  const items = feeds.parseFeed(fx("rss.xml"));
  assert.equal(items.length, 3);
  assert.equal(items[0].title, "Nvidia-Chef Huang tritt überraschend zurück");
  assert.match(items[0].summary, /^Der Chef des Chipkonzerns Nvidia gibt sein Amt ab\. Die Aktie fällt nachbörslich deutlich\.$/);
  assert.equal(items[0].image, "https://images.tagesschau.de/a.jpg");
  assert.ok(items[0].published_at);
  assert.equal(items[1].title, "Bundestag beschließt Rentenpaket & mehr");
  assert.equal(items[1].image, "https://images.tagesschau.de/b.jpg");
  assert.ok(items[1].published_at);
});

test("Feeds: Atom und Google News", () => {
  const a = feeds.parseFeed(fx("atom.xml"));
  assert.equal(a.length, 1);
  assert.equal(a[0].url, "https://www.heise.de/news/gta6-123.html");
  assert.equal(a[0].summary, "Das Spiel erscheint später.");
  const g = feeds.parseFeed(fx("gnews.xml")).map(feeds.cleanGoogleItem);
  assert.equal(g[0].title, "GTA 6: Rockstar bestätigt neuen Termin");
  assert.equal(g[0].publisher, "GameStar");
  assert.equal(g[0].publisher_url, "https://www.gamestar.de");
  assert.equal(g[0].summary, "");
});

test("Feeds: Bing-Nachrichtensuche", () => {
  const xml = `<rss><channel><item><title>Nvidia: Wieder K&#246;nig</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;url=https%3a%2f%2fwww.zeit.de%2fdigital%2fnvidia&amp;c=1&amp;mkt=de-de</link><description>US-Pr&#228;sident holt den Chef zur&#252;ck ...</description><pubDate>${new Date().toUTCString()}</pubDate><News:Source>ZEIT ONLINE</News:Source><News:Image>http://www.bing.com/th?id=X&amp;pid=News</News:Image></item></channel></rss>`;
  const it = feeds.cleanBingItem(feeds.parseFeed(xml)[0]);
  assert.equal(it.title, "Nvidia: Wieder König");
  assert.equal(it.url, "https://www.zeit.de/digital/nvidia");
  assert.equal(it.publisher, "ZEIT ONLINE");
  assert.equal(it.publisher_url, "https://www.zeit.de");
  assert.equal(it.image, "https://www.bing.com/th?id=X&pid=News");
  assert.match(feeds.sourceUrl({ kind: "gnews", url: '"GTA 6" OR "GTA VI" when:2d', lang: "de" }), /^https:\/\/www\.bing\.com\/news\/search\?q=%22GTA%206%22%20OR%20%22GTA%20VI%22&format=rss&setlang=de-DE&cc=DE&qft=/);
});

test("Feeds: Zeichensatz wird beachtet", async () => {
  const bytes = Uint8Array.from([...'<?xml version="1.0" encoding="ISO-8859-1"?><t>erw'].map((c) => c.charCodeAt(0)).concat([0xe4], [...'gt</t>'].map((c) => c.charCodeAt(0))));
  assert.match(await feeds.readText(new Response(bytes, { headers: { "content-type": "text/xml" } })), /erwägt/);
  assert.match(await feeds.readText(new Response(bytes, { headers: { "content-type": "text/xml; charset=iso-8859-1" } })), /erwägt/);
  assert.match(await feeds.readText(new Response(new TextEncoder().encode("<t>erwägt</t>"), { headers: { "content-type": "application/xml; charset=utf-8" } })), /erwägt/);
});

test("Feeds: Bluesky", () => {
  const json = { feed: [
    { post: { uri: "at://did:plc:x/app.bsky.feed.post/3abc", author: { handle: "reuters.com" }, indexedAt: new Date().toISOString(),
        record: { text: "BREAKING: Nvidia CEO Jensen Huang steps down, company says", createdAt: new Date().toISOString() },
        embed: { external: { uri: "https://www.reuters.com/technology/nvidia-ceo-2026/", title: "Nvidia CEO Jensen Huang steps down", description: "The chipmaker said...", thumb: "https://cdn.bsky.app/img/x.jpg" } } } },
    { reason: { $type: "repost" }, post: { uri: "at://x/y/z", record: { text: "repost of something long enough to count" } } },
    { post: { uri: "at://did:plc:x/app.bsky.feed.post/3def", author: { handle: "reuters.com" }, record: { text: "Short" } } },
  ] };
  const items = feeds.parseBluesky(json, "reuters.com", "Reuters");
  assert.equal(items.length, 1);
  assert.equal(items[0].url, "https://www.reuters.com/technology/nvidia-ceo-2026/");
  assert.equal(items[0].title, "Nvidia CEO Jensen Huang steps down");
  assert.equal(items[0].image, "https://cdn.bsky.app/img/x.jpg");
});

test("Feeds: SEC-Pflichtmeldung", () => {
  const xml = `<feed><entry><title>8-K - NVIDIA CORP (0001045810) (Filer)</title><link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/1045810/x-index.htm"/><summary type="html">&lt;b&gt;Filed:&lt;/b&gt; 2026-11-26 &lt;br&gt;Item 5.02: Departure of Directors or Certain Officers&lt;br&gt;Item 9.01: Financial Statements and Exhibits</summary><updated>${new Date().toISOString()}</updated></entry></feed>`;
  const items = feeds.parseSec(xml);
  assert.equal(items.length, 1);
  assert.match(items[0].title, /NVIDIA CORP: Pflichtmeldung.*Wechsel im Vorstand/);
  assert.equal(items[0].extra.event, "leadership");
});

const baseSettings = { languages: ["de", "en"], muted: ["dschungelcamp"], timezone: "Europe/Berlin", push_enabled: true, thr_stocks: 60, thr_topics: 60, thr_world: 82, world_push: true, push_max_per_day: 8, quiet_enabled: true, quiet_start: "23:00", quiet_end: "07:00", quiet_allow_stocks: false, ntfy_enabled: false, ntfy_topic: "", digest_enabled: true, digest_times: ["07:30"], price_alerts: true, price_move_pct: 3, price_window_min: 10, profile_text: "", llm_enabled: true, llm_model: "x", llm_daily_budget: 300, sec_contact: "", site_url: "" };
const topics = [
  { id: "t-nvda", kind: "stock", name: "Nvidia", keywords: ["Nvidia", "NVDA"], exclude: [], priority: 3, ticker: "NVDA", events: ["leadership", "earnings", "ma"] },
  { id: "t-gta", kind: "topic", name: "GTA 6", keywords: ["GTA 6", "GTA VI", "Rockstar Games"], exclude: [], priority: 3, ticker: null, events: [] },
  { id: "t-ki", kind: "topic", name: "KI", keywords: ["KI", "Künstliche Intelligenz", "OpenAI"], exclude: [], priority: 2, ticker: null, events: [] },
  { id: "t-bt", kind: "topic", name: "Bundestag", keywords: ["Bundestag"], exclude: ["Fußball"], priority: 1, ticker: null, events: [] },
  { id: "t-promi", kind: "topic", name: "Promis", keywords: ["Kardashian"], exclude: [], priority: 0, ticker: null, events: [] },
];
const cfg = score.compile({ settings: baseSettings, topics, weights: { rakete: 1.4 }, secrets: {} });
const story = (o) => ({ id: 1, is_new: true, kind: "news", title: "", summary: "", lang: "de", category: null, source_name: "tagesschau", publishers: ["tagesschau"], source_count: 1, article_count: 1, max_weight: 1, breaking: false, backfill: false, tokens: [], hints: [], first_seen_at: new Date().toISOString(), published_at: new Date().toISOString(), sort_at: new Date().toISOString(), importance: 0, relevance: 0, tier: 1, matched: [], llm: null, pushed_at: null, feedback: null, url: "", ...o });
const run = (o, llmV) => { const s = story(o); const a = score.analyze(s, cfg); return { a, v: score.finalize(s, a, cfg, llmV) }; };

test("Bewertung: Stichwörter", () => {
  assert.ok(score.keywordRegex("KI").re.test("Neue KI-Regeln in der EU"));
  assert.ok(!score.keywordRegex("KI").re.test("Der Kiosk am Kiez"));
  assert.ok(!score.keywordRegex("KI").re.test("Skigebiet meldet Rekord"));
  assert.ok(score.keywordRegex("Bundestag").re.test(text.normalize("Bundestagswahl: Ergebnis")));
  assert.ok(score.keywordRegex("GTA 6").re.test(text.normalize("Neuer Trailer zu GTA 6 erschienen")));
  assert.ok(score.keywordRegex("GTA 6").re.test(text.normalize("GTA-6-Release verschoben")));
  assert.ok(!score.keywordRegex("GTA 6").re.test(text.normalize("GTA 60 Jahre")));
  assert.ok(score.keywordRegex("Nvidia").re.test(text.normalize("Nvidias Zahlen")));
  assert.ok(!score.keywordRegex("Meta").re.test(text.normalize("Metadaten im Netz")));
});

test("Bewertung: Führungswechsel bei beobachteter Aktie löst Push aus", () => {
  const { a, v } = run({ title: "Nvidia-Chef Huang tritt überraschend zurück", source_count: 2 });
  assert.equal(a.event, "leadership");
  assert.equal(v.domain, "stocks");
  assert.ok(v.importance >= 85, "Wichtigkeit " + v.importance);
  assert.equal(v.tier, 3);
  assert.ok(v.pushEligible);
  assert.equal(v.pushTopic.id, "t-nvda");
});

test("Bewertung: englische Variante", () => {
  const { a, v } = run({ title: "Nvidia CEO Jensen Huang steps down", lang: "en" });
  assert.equal(a.event, "leadership");
  assert.ok(v.pushEligible);
});

test("Bewertung: Analystenmeinung löst keinen Push aus", () => {
  const { a, v } = run({ title: "Analyst hebt Kursziel für Nvidia nach Quartalszahlen an" });
  assert.equal(a.event, "analyst");
  assert.ok(!v.pushEligible);
  assert.equal(v.tier, 2);
});

test("Bewertung: Produktmeldung unter der Schwelle, Ereignisfilter greift", () => {
  const { a, v } = run({ title: "Nvidia stellt neue Grafikkarte vor" });
  assert.equal(a.event, "product");
  assert.ok(!v.pushEligible);
});

test("Bewertung: Thema GTA 6 – Verschiebung mit zwei Quellen", () => {
  const { v } = run({ title: "Rockstar Games verschiebt GTA 6 erneut", source_count: 2 });
  assert.equal(v.domain, "topics");
  assert.ok(v.importance >= 55, String(v.importance));
  const r3 = run({ title: "Rockstar Games verschiebt GTA 6 erneut", source_count: 3 });
  assert.ok(r3.v.pushEligible, "bei 3 Quellen: " + r3.v.importance);
});

test("Bewertung: Stummschalten und Ausschluss", () => {
  assert.equal(run({ title: "Dschungelcamp: Wer ist raus?" }).v.tier, 0);
  assert.equal(run({ title: "Kardashian zeigt neues Haus in Los Angeles" }).v.tier, 0);
  const ex = run({ title: "Bundestag-Elf gewinnt beim Fußball gegen Journalisten" });
  assert.equal(ex.v.matched.length, 0);
});

test("Bewertung: Weltereignis ohne Themenbezug", () => {
  const one = run({ title: "Bundeskanzler tritt zurück", source_count: 1 });
  assert.ok(!one.v.pushEligible, "eine Quelle reicht nicht");
  const many = run({ title: "Bundeskanzler tritt zurück", source_count: 4, max_weight: 1.25 });
  assert.ok(many.v.pushEligible, String(many.v.importance));
  assert.equal(many.v.domain, "world");
  const op = run({ title: "Kommentar: Warum der Kanzler jetzt zurücktreten muss", source_count: 4 });
  assert.ok(!op.v.pushEligible);
});

test("Bewertung: KI-Urteil fließt ein", () => {
  const low = run({ title: "Nvidia-Chef tritt bei Podiumsdiskussion zurück ins Rampenlicht" }, { importance: 20, relevance: 60, event: "other", summary: "x" });
  assert.ok(!low.v.pushEligible, String(low.v.importance));
  const high = run({ title: "Paukenschlag bei Nvidia: Huang geht" }, { importance: 95, relevance: 98, event: "leadership", summary: "Der Chef geht." });
  assert.ok(high.v.pushEligible);
  assert.equal(high.v.event, "leadership");
  assert.equal(high.v.summary_ai, "Der Chef geht.");
});

test("Bewertung: Deutsch 'dies' ist kein Todesfall", () => {
  assert.notEqual(run({ title: "Dies ändert sich 2027 für Autofahrer in Deutschland" }).a.event, "death");
  assert.equal(run({ title: "Famous actor dies at 80 in Los Angeles", lang: "en" }).a.event, "death");
});

test("Zeit: Ruhezeiten über Mitternacht", () => {
  const s = { ...baseSettings };
  assert.ok(score.inQuietHours(s, new Date("2026-11-26T23:30:00+01:00")));
  assert.ok(score.inQuietHours(s, new Date("2026-11-26T03:00:00+01:00")));
  assert.ok(!score.inQuietHours(s, new Date("2026-11-26T12:00:00+01:00")));
  assert.equal(score.localParts("Europe/Berlin", new Date("2026-07-01T10:05:00Z")).hhmm, "12:05");
});

test("Web-Push: Verschlüsselung lässt sich vom Empfänger entschlüsseln", async () => {
  const ua = crypto.createECDH("prime256v1");
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const msg = JSON.stringify({ t: "Nvidia · Führungswechsel", b: "Huang tritt zurück – äöü ✅", id: 42 });
  const body = await webpush.encryptPayload(new TextEncoder().encode(msg), ua.getPublicKey().toString("base64url"), auth.toString("base64url"));
  const plain = ece.decrypt(Buffer.from(body), { version: "aes128gcm", privateKey: ua, authSecret: auth.toString("base64url") });
  assert.equal(plain.toString("utf8"), msg);
});

test("Web-Push: VAPID-Signatur ist gültig", async () => {
  const keys = await webpush.generateVapidKeys();
  assert.equal(webpush.b64uDecode(keys.publicKey).length, 65);
  const h = await webpush.vapidHeader("https://web.push.apple.com/abc/def", "https://example.org", keys);
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(h);
  assert.ok(m);
  const [hd, pl, sig] = m[1].split(".");
  const payload = JSON.parse(Buffer.from(pl, "base64url").toString());
  assert.equal(payload.aud, "https://web.push.apple.com");
  assert.ok(payload.exp > Date.now() / 1000 && payload.exp < Date.now() / 1000 + 86400);
  const pub = await crypto.webcrypto.subtle.importKey("raw", webpush.b64uDecode(m[2]), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const ok = await crypto.webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, Buffer.from(sig, "base64url"), Buffer.from(`${hd}.${pl}`));
  assert.ok(ok);
});

test("Kursalarm: schnelle Bewegung und Tagesbewegung", () => {
  const now = Date.now();
  const mk = (pts, prev = 100) => ({ chart: { result: [{ meta: { previousClose: prev, currency: "USD" }, timestamp: pts.map((p) => Math.floor((now - p[0] * 60000) / 1000)), indicators: { quote: [{ close: pts.map((p) => p[1]) }] } }] } });
  const due = { ticker: "NVDA", topic_id: "t", name: "Nvidia", priority: 3, price: null, prev_close: null, last_alert_at: null, last_alert_price: null, day_alert_dir: null, day_alert_date: null };
  const drop = prices.evaluateChart(mk([[20, 100], [12, 100], [10, 100], [5, 98], [1, 95]]), due, 3, 10, now);
  assert.equal(drop.alert.kind, "move");
  assert.ok(drop.alert.movePct < -4.9 && drop.alert.dir === -1);
  const calm = prices.evaluateChart(mk([[20, 100], [10, 100], [1, 100.5]]), due, 3, 10, now);
  assert.equal(calm.alert, undefined);
  const stale = prices.evaluateChart(mk([[60, 100], [30, 90]]), due, 3, 10, now);
  assert.equal(stale.alert, undefined, "Markt geschlossen");
  const again = prices.evaluateChart(mk([[20, 100], [10, 100], [1, 95]]), { ...due, last_alert_at: new Date(now - 5 * 60000).toISOString(), last_alert_price: 95.5 }, 3, 10, now);
  assert.equal(again.alert, undefined, "kein zweiter Alarm ohne weitere Bewegung");
  const day = prices.evaluateChart(mk([[20, 107.5], [10, 107.6], [1, 107.8]], 100), due, 3, 10, now);
  assert.equal(day.alert.kind, "day");
  assert.equal(prices.pctText(-5.23), "−5,2 %");
});

test("KI: Antworten lesen und Modell wählen", () => {
  assert.deepEqual(llm.parseLoose('Hier: [{"i":0}] fertig'), [{ i: 0 }]);
  assert.equal(llm.pickModel(["gemini-2.5-pro", "gemini-flash-lite-latest"]), "gemini-flash-lite-latest");
  assert.equal(llm.pickModel(["gemini-2.5-pro", "gemini-2.5-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite", "gemini-3-flash-image"]), "gemini-3.1-flash-lite");
  const fb = llm.suggestTopicsFallback("Ich interessiere mich für Raumfahrt, SpaceX und Formel 1");
  assert.deepEqual(fb.map((x) => x.name), ["Raumfahrt", "SpaceX", "Formel 1"]);
});
