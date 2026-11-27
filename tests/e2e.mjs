// Durchlauf im Browser (Handy-Größe): Einrichtung → Interessen → Feed → Detail → Profil.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const APP = "http://127.0.0.1:8080/";
const MOCK = "http://127.0.0.1:9955";
const DB = "postgres://postgres:postgres@127.0.0.1:5432/news";
const SHOTS = new URL("./shots/", import.meta.url).pathname;
const sql = (q) => execFileSync("psql", [DB, "-Atc", q], { encoding: "utf8" }).trim();
const mock = async (patch) => (await fetch(`${MOCK}/__state`, { method: patch ? "POST" : "GET", body: patch ? JSON.stringify(patch) : undefined })).json();
const secret = sql("select value from private.secrets where key='cron_secret'");
const tick = async () => (await fetch("http://127.0.0.1:54321/functions/v1/news?action=tick&wait=1", { method: "POST", headers: { "x-cron-secret": secret, "Content-Type": "application/json" }, body: "{}" })).json();
const drain = async () => { let n = 0; for (let i = 0; i < 12; i++) { const r = await tick(); n += r.items ?? 0; if (!r.sources) break; } return n; };
const allDue = () => sql("update public.sources set next_fetch_at = now() - interval '1 second' where enabled");

const scale = Number(process.env.SCALE ?? 2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: scale, isMobile: true, hasTouch: true, locale: "de-DE", timezoneId: "Europe/Berlin", colorScheme: process.env.DARK ? "dark" : "light" });
const page = await ctx.newPage();
const problems = [];
page.on("console", (m) => { if (m.type() === "error") problems.push("console: " + m.text()); });
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("requestfailed", (r) => { if (!r.url().includes("images.") && !r.url().includes("cdn.bsky")) problems.push("requestfailed: " + r.url() + " " + r.failure()?.errorText); });
page.on("response", (r) => { if (r.status() >= 400 && !/images\.|cdn\.bsky|token\?grant_type/.test(r.url())) problems.push(`http-antwort ${r.status()}: ${r.url()}`); });

let n = 0;
const shot = async (name) => {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${SHOTS}${String(++n).padStart(2, "0")}-${name}.png` });
  // Nirgends dürfen Programmier-Platzhalter als Text auftauchen
  const txt = await page.evaluate(() => document.body.innerText);
  const bad = /\bnull\b|\bundefined\b|\[object Object\]|\bNaN\b/.exec(txt);
  assert.ok(!bad, `${name}: Platzhalter-Text „${bad?.[0]}“ sichtbar`);
};
const step = (s) => console.log("• " + s);
const tap = (sel) => page.locator(sel).first().click();
const btn = (text) => page.getByRole("button", { name: text, exact: false }).first();
const noOverflow = async (where) => {
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.ok(w.sw <= w.cw + 1, `${where}: Seite ist breiter als der Bildschirm (${w.sw} > ${w.cw})`);
};

await mock({ phase: 0, price: "calm", geminiMode: "ok", fail: {}, nonce: "1" });
await fetch(`${MOCK}/__reset`);

step("Erste Einrichtung: Konto anlegen");
await page.goto(APP);
await page.waitForSelector(".auth h1");
assert.equal(await page.locator(".auth h1").textContent(), "Deine News");
await shot("konto-anlegen");
await page.fill('input[type="email"]', "falsch");
await page.fill('input[type="password"]', "geheim-12345");
await btn("Konto anlegen").click();
await page.waitForSelector(".error:not([hidden])");
assert.match(await page.locator(".error").textContent(), /gültige E-Mail/);
await page.fill('input[type="email"]', "ich@test.dev");
await btn("Konto anlegen").click();
await page.waitForSelector(".ob .welcome");
await shot("einrichtung-start");

// Damit der Praxistest echte Schlagzeilen hat
await drain();

step("Schritt 1: Bereiche");
await btn("Los geht's").click();
await page.waitForSelector(".bigchips");
for (const c of ["Börse & Finanzen", "Künstliche Intelligenz", "Gaming", "Politik Deutschland"]) await page.locator(".bigchip", { hasText: c }).click();
assert.equal(await page.locator(".bigchip.on").count(), 4);
await shot("bereiche");
await noOverflow("Bereiche");
await btn("Weiter").click();

step("Schritt 2: Unterthemen");
await page.waitForSelector(".ob h3");
assert.ok((await page.locator(".chip.on").count()) >= 8, "Vorschläge sind vormarkiert");
await page.locator(".chip", { hasText: "PlayStation" }).click(); // war vormarkiert → abwählen
await page.locator(".chip", { hasText: "GTA 6" }).click(); // und wieder wählen
await page.locator(".chip", { hasText: "Wahlen" }).click();
await page.locator(".chip", { hasText: "+ Eigenes Thema" }).click();
await page.waitForSelector(".sheet.show input");
await page.fill(".sheet.show input", "Hamburg");
await page.locator(".sheet.show .btn.primary").click();
await page.waitForSelector(".sheet", { state: "detached" });
assert.equal(await page.locator(".chip.on", { hasText: "Hamburg" }).count(), 1);
await shot("unterthemen");
await noOverflow("Unterthemen");
await btn("Weiter").click();

step("Schritt 3: Aktien");
await page.waitForSelector('input[type="search"]');
await page.locator(".chip", { hasText: "+ Nvidia" }).click();
await page.fill('input[type="search"]', "nvid");
await page.waitForSelector(".group .row");
assert.match(await page.locator(".group .row").first().textContent(), /NVIDIA Corporation/);
await page.fill('input[type="search"]', "");
await page.waitForTimeout(600);
await page.locator(".chip", { hasText: "+ Apple" }).click();
assert.equal(await page.locator(".ob .btn.danger").count(), 2);
await page.locator(".ob .btn.danger").nth(1).click(); // Apple wieder entfernen
assert.equal(await page.locator(".ob .btn.danger").count(), 1);
await shot("aktien");
await noOverflow("Aktien");
await btn("Weiter").click();

step("Schritt 4: Wichtigkeit");
await page.waitForSelector(".prio-row");
const rows = await page.locator(".prio-row").count();
assert.ok(rows >= 10, "alle gewählten Themen stehen in der Liste: " + rows);
await page.locator(".prio-row", { hasText: "GTA 6" }).locator("button", { hasText: "Push" }).click();
await page.locator(".prio-row", { hasText: "Hamburg" }).locator("button", { hasText: "App" }).click();
await shot("wichtigkeit");
await noOverflow("Wichtigkeit");
await btn("Speichern und weiter").click();

step("Schritt 5: Praxistest mit echten Schlagzeilen");
await page.waitForSelector(".gesture");
await shot("praxistest-erklaerung");
await drain(); // Quellen der neuen Themen werden im Hintergrund geholt
await btn("Test starten").click();
await page.waitForSelector(".deck .card.top", { timeout: 15000 });
assert.equal(sql("select count(*) from topics where kind='stock' and ticker='NVDA' and priority=3"), "1");
assert.equal(sql("select priority from topics where name='GTA 6'"), "3");
assert.equal(sql("select priority from topics where name='Hamburg'"), "1");
assert.ok(Number(sql("select count(*) from sources where enabled and category='gaming'")) > 5);
await shot("praxistest");
const total = Number((await page.locator(".deck-count").textContent()).split(" von ")[1]);
const labels = ["Interessant", "Egal", "Sofort wissen", "Nie wieder"];
for (let i = 0; i < total; i++) { await page.locator(".ob-foot .fb button", { hasText: labels[i % 4] }).click(); await page.waitForTimeout(260); }
await page.waitForSelector(".ob .empty strong");
assert.match(await page.locator(".ob .empty strong").textContent(), new RegExp(`${total} Antworten`));
await page.waitForTimeout(600);
assert.equal(Number(sql("select count(*) from stories where feedback is not null")), total);
assert.ok(Number(sql("select count(*) from term_weights")) > 10);
await btn("Weiter").click();

step("Schritt 6: Push-Grenze");
await page.waitForSelector(".deck .card");
await shot("push-grenze");
for (let i = 0; i < 15; i++) {
  const txt = await page.locator(".deck .card h2").textContent().catch(() => null);
  if (!txt) break;
  // Ja nur bei den großen Dingen
  const yes = /tritt.*zurück|übertrifft|Riesige|Offiziell bestätigt|Erdbeben|Wahlergebnis/.test(txt);
  await btn(yes ? "Ja, Push" : "Nein").click();
  await page.waitForTimeout(120);
  if (await page.locator(".ob .kv").count()) break;
}
await page.waitForSelector(".ob .kv");
await shot("push-grenze-ergebnis");
const thr = sql("select thr_stocks || '|' || thr_topics || '|' || thr_world from settings").split("|").map(Number);
console.log("    Schwellen:", thr.join(" / "));
assert.ok(thr[0] >= 58 && thr[0] <= 66 && thr[1] >= 58 && thr[1] <= 66 && thr[2] === 75, "Schwellen liegen zwischen Stufe 3 und 4");
await btn("Weiter").click();

step("Schritt 7: Ruhezeiten");
await page.waitForSelector(".switch");
await shot("ruhezeiten");
await noOverflow("Ruhezeiten");
await btn("Weiter").click();

step("Schritt 8: Freitext und KI");
await page.waitForSelector("textarea");
await page.fill('input[type="password"]', "bad-key-000000000000000000");
await btn("Schlüssel prüfen").click();
await page.waitForSelector(".ob .error:not([hidden])");
assert.match(await page.locator(".ob .error").textContent(), /nicht akzeptiert/);
await page.fill('input[type="password"]', "good-key-11111111111111111111");
await btn("Schlüssel prüfen").click();
await page.getByText("KI ist verbunden").waitFor();
await page.fill("textarea", "Ich interessiere mich für Raumfahrt, vor allem SpaceX, und für die Formel 1.");
await btn("Themen daraus vorschlagen").click();
await page.waitForSelector(".ob .chips .chip.on");
assert.equal(await page.locator(".ob .chips .chip.on").count(), 2);
await shot("freitext-ki");
await noOverflow("Freitext");
await btn("Weiter").click();

step("Abschluss");
await page.waitForSelector(".ob .kv");
assert.ok(Number(sql("select count(*) from topics where origin='freitext'")) >= 1);
await shot("abschluss");
await noOverflow("Abschluss");
await btn("Fertig").click();
await page.waitForSelector(".tabbar");
assert.equal(sql("select onboarding_done from settings"), "t");

step("Heute");
await page.waitForSelector(".hero h1");
await page.waitForFunction(() => document.querySelectorAll(".story, .lead").length > 0 || document.querySelector(".empty"));
await shot("heute-ruhig");
await mock({ phase: 1 });
allDue();
await drain();
await page.evaluate(() => window.scrollTo(0, 0));
// Aktualisieren über erneutes Antippen des Reiters ist nur Scrollen; daher Seite neu öffnen wie beim App-Start
await page.reload();
await page.waitForSelector(".lead");
await page.waitForTimeout(400);
assert.match(await page.locator(".sec").first().textContent(), /Neu für dich/);
assert.match(await page.locator(".lead h3").first().textContent(), /Huang/);
await shot("heute-eilmeldung");
await noOverflow("Heute");
assert.match(await page.locator("#status-line").textContent(), /Läuft/);

step("Briefing: von selbst geschrieben, Punkte führen zur ausführlichen Meldung");
await page.waitForSelector(".brief-body section li", { timeout: 20000 });
assert.match(await page.locator(".brief-head strong").textContent(), /Briefing/);
assert.ok((await page.locator(".brief-body section").count()) >= 2);
await shot("briefing");
await noOverflow("Briefing");
await page.locator(".brief-body li.tap").first().click();
await page.waitForSelector(".sheet.show .detail h1");
assert.ok((await page.locator(".sheet.show .detail h1").textContent()).length > 10);
await page.locator(".sheet.show .btn", { hasText: "Dranbleiben" }).click();
await page.locator(".sheet.show .btn", { hasText: "Du bleibst dran" }).waitFor();
await page.locator(".sheet.show .close").click();
await page.waitForSelector(".sheet", { state: "detached" });
await page.reload();
await page.waitForSelector(".lead");
assert.ok(await page.getByText("Du bleibst dran").count() >= 1, "Abschnitt mit verfolgten Ereignissen");
await shot("heute-mit-briefing");

step("Detailansicht");
await page.locator(".lead").first().click();
await page.waitForSelector(".sheet.show .detail h1");
await page.waitForSelector(".sheet.show .srcs a");
await page.waitForSelector(".sheet.show .folgen li", { timeout: 20000 });
assert.ok((await page.locator(".sheet.show .deep .para").count()) >= 4, "ausführliche Zusammenfassung");
assert.equal(await page.locator(".sheet.show .einschaetzung").count(), 1);
await shot("detail");
assert.ok((await page.locator(".sheet.show .srcs a").count()) >= 3);
assert.match(await page.locator(".sheet.show .reasons").textContent(), /Nvidia/);
await page.locator(".sheet.show .fb button", { hasText: "Sofort wissen" }).click();
await page.waitForSelector(".toast");
await page.locator(".sheet.show .btn", { hasText: "Merken" }).click();
await page.getByText("Gemerkt ✓").waitFor();
const link = await page.locator(".sheet.show a.btn.primary").getAttribute("href");
assert.match(link, /^https:\/\//);
await page.locator(".sheet.show .sheet-body").evaluate((el) => el.scrollTo(0, el.scrollHeight));
await shot("detail-unten");
await page.locator(".sheet.show .close").click();
await page.waitForSelector(".sheet", { state: "detached" });
assert.ok(await page.locator(".lead.read").count() >= 1, "gelesene Meldung ist markiert");

step("Neue Meldungen erscheinen von selbst");
await mock({ phase: 2 });
allDue();
await drain();
await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
await page.waitForSelector(".pill.show", { timeout: 8000 });
await shot("neue-meldungen");
await page.locator(".pill.show").click();
await page.getByText("OpenAI stellt neues KI-Modell vor").first().waitFor();

step("Assistent: erklärt und stellt den Algorithmus um");
await page.locator(".fab").click();
await page.waitForSelector(".sheet.show .chat-hello");
await shot("assistent-start");
await page.fill(".sheet.show .chat-input", "Ich bekomme zu viele Pushes zu GTA 6");
await page.locator(".sheet.show .chat-send").click();
await page.waitForSelector(".sheet.show .did div");
assert.match(await page.locator(".sheet.show .did").textContent(), /GTA 6.*Wichtig/);
assert.equal(sql("select priority from topics where name='GTA 6'"), "2");
await page.fill(".sheet.show .chat-input", "Bitte keine Nachrufe mehr");
await page.locator(".sheet.show .chat-input").press("Enter");
await page.waitForFunction(() => document.querySelectorAll(".sheet.show .did").length === 2);
assert.match(sql("select profile_text from settings"), /Nachrufe interessieren mich nicht/);
assert.match(sql("select array_to_string(muted, ',') from settings"), /horoskop/);
assert.equal(sql("select neg from term_weights where term = 'nachru'"), "4");
await page.fill(".sheet.show .chat-input", "Was war heute wichtig?");
await page.locator(".sheet.show .chat-send").click();
await page.getByText("Rücktritt des Nvidia-Chefs").waitFor();
await shot("assistent-gespraech");
await page.locator(".sheet.show .close").click();
await page.waitForSelector(".sheet", { state: "detached" });
sql("update topics set priority = 3 where name = 'GTA 6'");

step("Ticker");
await page.locator('.tabbar button[data-tab="ticker"]').click();
await page.waitForSelector(".story");
await shot("ticker");
await noOverflow("Ticker");
const tn = await page.locator(".story").count();
await page.locator(".chiprow .chip", { hasText: "Nvidia" }).click();
await page.waitForTimeout(700);
const fn = await page.locator(".story").count();
assert.ok(fn >= 1 && fn < tn, `Themenfilter schränkt ein (${fn} von ${tn})`);
await page.locator(".chiprow .chip").first().click();
await page.fill('.search input', "rentenpaket");
await page.waitForTimeout(900);
assert.equal(await page.locator(".story").count(), 1);
await page.fill('.search input', "gibtesnicht");
await page.waitForSelector(".empty");
await page.fill('.search input', "");

step("Gemerkt");
await page.locator('.tabbar button[data-tab="gemerkt"]').click();
await page.waitForSelector(".story");
assert.equal(await page.locator(".story").count(), 1);
await shot("gemerkt");

step("Profil");
await page.locator('.tabbar button[data-tab="profil"]').click();
await page.waitForSelector(".group .row");
await shot("profil");
await noOverflow("Profil");
await page.locator(".row", { hasText: "Themen & Aktien" }).click();
await page.waitForSelector(".sheet.show .group .row");
await shot("profil-themen");
await page.locator(".sheet.show .row", { hasText: "GTA 6" }).click();
await page.waitForSelector(".sheet.show >> text=Suchbegriffe");
await page.locator(".sheet.show").last().locator('input[placeholder="Suchbegriff hinzufügen"]').fill("Vice City");
await page.locator(".sheet.show").last().locator('input[placeholder="Suchbegriff hinzufügen"]').press("Enter");
await shot("thema-bearbeiten");
await page.locator(".sheet.show").last().locator(".sheet-foot .btn.primary").click();
await page.waitForFunction(() => document.querySelectorAll(".sheet.show").length === 1);
assert.match(sql("select array_to_string(keywords, ',') from topics where name='GTA 6'"), /Vice City/);
assert.match(sql("select url from sources where name = 'Suche · GTA 6' and lang='de'"), /"GTA 6" OR "GTA VI"/);
// Aktie über die Suche hinzufügen
await page.locator(".sheet.show .sheet-foot .btn", { hasText: "+ Aktie" }).click();
await page.waitForSelector('.sheet.show input[type="search"]');
await page.locator('.sheet.show input[type="search"]').fill("nvid");
await page.locator(".sheet.show .row", { hasText: "NVIDIA CORP. DL" }).click();
await page.waitForFunction(() => document.querySelectorAll(".sheet.show").length === 1);
assert.equal(sql("select count(*) from topics where kind='stock' and ticker='NVD.DE'"), "1");
await shot("profil-aktie-hinzugefuegt");
await page.locator(".sheet.show .row", { hasText: "NVD.DE" }).click();
await page.locator(".sheet.show").last().locator(".btn.danger").click();
await page.waitForFunction(() => document.querySelectorAll(".sheet.show").length === 3);
await page.getByRole("button", { name: "Löschen", exact: true }).click(); // Bestätigen
await page.waitForFunction(() => document.querySelectorAll(".sheet.show").length === 1);
assert.equal(sql("select count(*) from topics where ticker='NVD.DE'"), "0");
await page.locator(".sheet.show .close").click();
await page.waitForSelector(".sheet", { state: "detached" });

for (const [label, wait, name] of [
  ["Bereiche & Sprachen", ".bigchips", "bereiche-sprachen"],
  ["Push", "input[type=range]", "push-einstellungen"],
  ["Ruhezeit & Digest", ".switch", "ruhezeit"],
  ["Kursalarm", ".stepper", "kursalarm"],
  ["Push-Verlauf", ".sheet-body", "push-verlauf"],
  ["KI-Einordnung", "textarea", "ki"],
  ["Quellen", ".sheet.show .group .row", "quellen"],
  ["Status", ".sheet.show .kv", "status"],
]) {
  await page.locator("#view .row").filter({ has: page.locator("strong", { hasText: new RegExp("^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }) }).first().click();
  await page.waitForSelector(`.sheet.show ${wait.replace(".sheet.show ", "")}`);
  await shot("profil-" + name);
  const w = await page.locator(".sheet.show .sheet-body").evaluate((el) => el.scrollWidth - el.clientWidth);
  assert.ok(w <= 1, `${label}: Inhalt ist breiter als das Blatt (${w}px)`);
  await page.locator(".sheet.show .close").click();
  await page.waitForSelector(".sheet", { state: "detached" });
}

step("Abmelden und wieder anmelden");
await page.locator("#view .row", { hasText: "Abmelden" }).click();
await page.locator(".sheet.show .btn.primary").click();
await page.waitForSelector(".auth h1");
assert.equal(await page.locator(".auth h1").textContent(), "Willkommen zurück");
await shot("anmelden");
await page.fill('input[type="password"]', "falsches-passwort");
await btn("Anmelden").click();
await page.waitForSelector(".error:not([hidden])");
assert.match(await page.locator(".error").textContent(), /stimmt nicht/);
await page.fill('input[type="password"]', "geheim-12345");
await btn("Anmelden").click();
await page.waitForSelector(".tabbar");
await page.waitForSelector(".lead");

step("Anmeldung bleibt erhalten, auch wenn das Gerät die Sitzung verliert");
await page.reload();
await page.waitForSelector(".tabbar");
await page.evaluate(() => localStorage.removeItem("news.auth")); // Sitzung weg, gemerkte Zugangsdaten noch da
await page.reload();
await page.waitForSelector(".tabbar");
await page.waitForSelector(".lead");
await page.evaluate(() => { localStorage.removeItem("news.auth"); localStorage.removeItem("news.login"); }); // nur noch das Cookie
await page.reload();
await page.waitForSelector(".tabbar");
assert.equal(await page.locator(".auth").count(), 0);

step("Direkt zu einer Meldung (wie nach Tipp auf einen Push)");
const sid = sql("select id from stories where pushed_at is not null or tier = 3 order by id limit 1");
await page.goto(APP + "#/story/" + sid); // App läuft schon
await page.waitForSelector(".sheet.show .detail h1");
const p2 = await ctx.newPage(); // App wird frisch geöffnet
await p2.goto(APP + "#/story/" + sid);
await p2.waitForSelector(".sheet.show .detail h1");
await p2.close();

await browser.close();
// Erwartet: Testbilder gibt es in dieser Umgebung nicht; falsches Passwort ergibt absichtlich einen Fehler 400
const real = [...new Set(problems)].filter((p) => !/ERR_TUNNEL_CONNECTION_FAILED|status of 400 \(Bad Request\)|401|400.*token|invalid_credentials/.test(p));
console.log("\nAuffälligkeiten im Browser:", real.length ? "\n  " + real.join("\n  ") : "keine");
if (real.length) process.exit(1);
console.log("Browser-Durchlauf bestanden.");
