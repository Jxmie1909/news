// Stellvertreter für das Internet in Tests: Feeds, Gemini, Push-Dienst, ntfy, Yahoo.
import http from "node:http";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ece = require("http_ece");

const PORT = Number(process.env.MOCK_PORT ?? 9955);
const state = { phase: 0, pushes: [], ntfy: [], gemini: [], geminiMode: "ok", requests: [], price: "calm", fail: {}, nonce: "1" };

// Empfänger-Schlüssel für das Test-Push-Abo
const ua = crypto.createECDH("prime256v1");
ua.generateKeys();
const authSecret = crypto.randomBytes(16);
export const subscription = { endpoint: "https://push.mock/send/device1", p256dh: ua.getPublicKey().toString("base64url"), auth: authSecret.toString("base64url") };

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const rss = (items) => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>t</title>${items.map((i) => `<item><title>${esc(i.title)}</title><link>${esc(i.link)}</link><description>${esc(i.desc ?? "")}</description><pubDate>${new Date(Date.now() - (i.ageMin ?? 5) * 60000).toUTCString()}</pubDate>${i.img ? `<media:content url="${i.img}" medium="image"/>` : ""}${i.source ? `<source url="${i.sourceUrl}">${esc(i.source)}</source>` : ""}</item>`).join("")}</channel></rss>`;

function feedFor(u) {
  const h = u.hostname, p = u.pathname + u.search;
  const breaking = state.phase >= 1;
  const second = state.phase >= 2;
  if (h === "www.tagesschau.de" && p.startsWith("/index")) {
    return rss([
      ...(breaking ? [{ title: "Nvidia-Chef Huang tritt überraschend zurück", link: "https://www.tagesschau.de/wirtschaft/nvidia-huang-100.html", desc: "Jensen Huang gibt die Führung des Chipkonzerns ab. Die Aktie fällt nachbörslich.", ageMin: 1, img: "https://images.tagesschau.de/nvidia.jpg" }] : []),
      ...(second ? [{ title: "OpenAI stellt neues KI-Modell vor", link: "https://www.tagesschau.de/wirtschaft/openai-102.html", desc: "Das Unternehmen verspricht deutlich bessere Ergebnisse.", ageMin: 1 }] : []),
      { title: "Bundestag beschließt Rentenpaket nach langer Debatte", link: "https://www.tagesschau.de/inland/rente-100.html", desc: "Die Koalition hat das Rentenpaket verabschiedet.", ageMin: 40, img: "https://images.tagesschau.de/rente.jpg" },
      { title: "Sturmtief zieht über Norddeutschland hinweg", link: "https://www.tagesschau.de/inland/sturm-100.html", desc: "Der Wetterdienst warnt vor Orkanböen.", ageMin: 90 },
      { title: "Kommentar: Warum die Schuldenbremse reformiert werden muss", link: "https://www.tagesschau.de/kommentar/schulden-100.html", desc: "Eine Einordnung.", ageMin: 120 },
      { title: "EZB lässt den Leitzins unverändert bei zwei Prozent", link: "https://www.tagesschau.de/wirtschaft/ezb-100.html", desc: "Die Währungshüter sehen die Inflation im Zielbereich.", ageMin: 150, img: "https://images.tagesschau.de/ezb.jpg" },
      { title: "Bahn kündigt neue Sparpreise für den Winterfahrplan an", link: "https://www.tagesschau.de/wirtschaft/bahn-100.html", desc: "Ab Dezember gelten neue Tarife.", ageMin: 170 },
      { title: "Forscher entdecken erdähnlichen Planeten in bewohnbarer Zone", link: "https://www.tagesschau.de/wissen/planet-100.html", desc: "Der Planet ist 40 Lichtjahre entfernt.", ageMin: 190 },
      { title: "Nationalmannschaft gewinnt Testspiel gegen Italien mit 2:1", link: "https://www.tagesschau.de/sport/dfb-100.html", desc: "Zwei späte Tore drehen die Partie.", ageMin: 210 },
      { title: "Neue Regeln für Paketzustellung treten im Januar in Kraft", link: "https://www.tagesschau.de/wirtschaft/paket-100.html", desc: "Verbraucher bekommen mehr Rechte.", ageMin: 230 },
      { title: "Apple stellt überarbeitetes MacBook mit neuem Chip vor", link: "https://www.tagesschau.de/wirtschaft/apple-100.html", desc: "Das Gerät soll deutlich länger durchhalten.", ageMin: 250 },
    ]);
  }
  if (h === "www.spiegel.de" && p.startsWith("/schlagzeilen")) {
    return rss([
      ...(breaking ? [{ title: "Paukenschlag bei Nvidia: Chef Jensen Huang tritt zurück", link: "https://www.spiegel.de/wirtschaft/nvidia-huang-a-1.html", desc: "Der Gründer zieht sich zurück.", ageMin: 1 }] : []),
      { title: "Rentenpaket: Bundestag beschließt Reform", link: "https://www.spiegel.de/politik/rente-a-2.html", desc: "Nach langer Debatte.", ageMin: 35 },
      { title: "Dschungelcamp: Diese Promis ziehen ein", link: "https://www.spiegel.de/kultur/dschungel-a-3.html", desc: "RTL gibt die Liste bekannt.", ageMin: 50 },
    ]);
  }
  if (h === "feeds.bbci.co.uk" && p.startsWith("/news/rss")) {
    return rss([
      ...(breaking ? [{ title: "Nvidia boss Jensen Huang steps down in surprise move", link: "https://www.bbc.co.uk/news/articles/nvidia1", desc: "The chip giant's founder is leaving.", ageMin: 1 }] : []),
      { title: "Storm brings travel disruption across northern Europe", link: "https://www.bbc.co.uk/news/articles/storm1", desc: "Flights cancelled.", ageMin: 60 },
    ]);
  }
  if (h === "news.google.com") {
    const q = u.searchParams.get("q") ?? "";
    if (/nvidia/i.test(q)) {
      return rss([
        ...(breaking ? [{ title: "Nvidia: Huang tritt als Chef zurück - Handelsblatt", link: "https://news.google.com/rss/articles/NV1?oc=5", source: "Handelsblatt", sourceUrl: "https://www.handelsblatt.com", ageMin: 1 },
          { title: "Nvidia-Chef Huang tritt überraschend zurück - tagesschau.de", link: "https://news.google.com/rss/articles/NV2?oc=5", source: "tagesschau.de", sourceUrl: "https://www.tagesschau.de", ageMin: 1 }] : []),
        { title: "Analyst hebt Kursziel für Nvidia an - finanzen.net", link: "https://news.google.com/rss/articles/NV0?oc=5", source: "finanzen.net", sourceUrl: "https://www.finanzen.net", ageMin: 200 },
      ]);
    }
    if (/gta/i.test(q)) {
      return rss([{ title: "GTA 6: Neuer Trailer zeigt Vice City - GameStar", link: "https://news.google.com/rss/articles/GTA1?oc=5", source: "GameStar", sourceUrl: "https://www.gamestar.de", ageMin: 300 }]);
    }
    if (/openai|kuenstliche|künstliche|"KI"/i.test(q)) {
      return rss(second ? [{ title: "OpenAI stellt neues KI-Modell vor - heise online", link: "https://news.google.com/rss/articles/KI1?oc=5", source: "heise online", sourceUrl: "https://www.heise.de", ageMin: 1 }] : []);
    }
    return rss([]);
  }
  if (h === "feeds.finance.yahoo.com") {
    return rss(breaking ? [{ title: "Nvidia CEO Jensen Huang steps down, shares plunge after hours", link: `https://finance.yahoo.com/news/nvidia-ceo-${state.nonce}.html`, desc: "Shares fell.", ageMin: 1 }] : [{ title: "Nvidia supplier reports steady demand", link: "https://finance.yahoo.com/news/nvidia-0.html", ageMin: 400 }]);
  }
  return null;
}

function bluesky(u) {
  const actor = u.searchParams.get("actor");
  const feed = [];
  if (actor === "reuters.com" && state.phase >= 1) {
    feed.push({ post: { uri: "at://did:plc:r/app.bsky.feed.post/3nv", author: { handle: "reuters.com" }, indexedAt: new Date().toISOString(),
      record: { text: "Nvidia CEO Jensen Huang steps down, company says", createdAt: new Date(Date.now() - 30000).toISOString() },
      embed: { external: { uri: "https://www.reuters.com/technology/nvidia-ceo-steps-down/", title: "Nvidia CEO Jensen Huang steps down", description: "Nvidia said on Thursday its chief executive is stepping down.", thumb: "https://cdn.bsky.app/img/nv.jpg" } } } });
  }
  return JSON.stringify({ feed });
}

function chart() {
  const now = Math.floor(Date.now() / 1000);
  const pts = state.price === "drop" ? [[20, 100], [12, 100], [10, 100], [5, 97], [1, 94.5]] : [[20, 100], [10, 100.1], [1, 100.2]];
  return JSON.stringify({ chart: { result: [{ meta: { previousClose: 101, currency: "USD", regularMarketPrice: pts.at(-1)[1] }, timestamp: pts.map((p) => now - p[0] * 60), indicators: { quote: [{ close: pts.map((p) => p[1]) }] } }] } });
}

async function gemini(u, req, body) {
  state.gemini.push({ path: u.pathname, key: req.headers["x-goog-api-key"], body });
  if (req.headers["x-goog-api-key"] === "bad-key-000000000000000000") return [400, JSON.stringify({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } })];
  if (state.geminiMode === "quota") return [429, JSON.stringify({ error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED", details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] } })];
  if (u.pathname.endsWith("/models")) return [200, JSON.stringify({ models: [{ name: "models/gemini-flash-lite-latest", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-2.5-pro", supportedGenerationMethods: ["generateContent"] }] })];
  const j = JSON.parse(body);
  const user = j.contents?.[0]?.parts?.[0]?.text ?? "";
  let out;
  if (user.includes('"meldungen"')) {
    const items = JSON.parse(user).meldungen;
    out = items.map((m) => {
      const big = /tritt.*zurück|steps down/i.test(m.titel);
      const ki = /KI-Modell/i.test(m.titel);
      return { i: m.i, importance: big ? 94 : ki ? 58 : 30, relevance: big ? 97 : ki ? 80 : 20, event: big ? "leadership" : ki ? "product" : "other", summary: big ? "Jensen Huang gibt die Führung von Nvidia ab. Die Aktie gibt nachbörslich deutlich nach." : "Kurzfassung der Meldung." };
    });
  } else if (user.includes('"beschreibung"')) {
    out = [{ name: "SpaceX", emoji: "🚀", keywords: ["SpaceX", "Starship"], kind: "topic", ticker: "", priority: 2, exclude: [] }, { name: "Formel 1", emoji: "🏎️", keywords: ["Formel 1", "Formula 1", "F1"], kind: "topic", ticker: "", priority: 1, exclude: [] }];
  } else out = { ok: true };
  return [200, JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] }, finishReason: "STOP" }] })];
}

const server = http.createServer(async (req, res) => {
  const self = new URL(req.url, "http://x");
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const send = (code, body, type = "application/json") => { res.writeHead(code, { "Content-Type": type }); res.end(body); };

  if (self.pathname === "/__state") {
    if (req.method === "POST") Object.assign(state, JSON.parse(raw.toString() || "{}"));
    return send(200, JSON.stringify({ ...state, subscription }));
  }
  if (self.pathname === "/__reset") { state.pushes = []; state.ntfy = []; state.gemini = []; state.requests = []; return send(200, "{}"); }

  const target = self.searchParams.get("url");
  if (!target) return send(404, "{}");
  const u = new URL(target);
  state.requests.push({ host: u.hostname, path: u.pathname + u.search, ua: req.headers["user-agent"] });
  if (state.fail[u.hostname]) return send(state.fail[u.hostname], "fail", "text/plain");

  if (u.hostname === "push.mock") {
    try {
      const plain = ece.decrypt(raw, { version: "aes128gcm", privateKey: ua, authSecret: authSecret.toString("base64url") });
      state.pushes.push({ path: u.pathname, data: JSON.parse(plain.toString("utf8")), authorization: req.headers["authorization"], ttl: req.headers["ttl"], urgency: req.headers["urgency"], encoding: req.headers["content-encoding"] });
      return send(u.pathname.includes("gone") ? 410 : 201, "");
    } catch (e) {
      state.pushes.push({ error: String(e) });
      return send(400, "bad");
    }
  }
  if (u.hostname === "ntfy.sh") { state.ntfy.push(JSON.parse(raw.toString())); return send(200, "{}"); }
  if (u.hostname === "generativelanguage.googleapis.com") { const [c, b] = await gemini(u, req, raw.toString()); return send(c, b); }
  if (u.hostname === "public.api.bsky.app") return send(200, bluesky(u));
  if (u.hostname === "query1.finance.yahoo.com") return send(200, chart());
  if (u.hostname === "query2.finance.yahoo.com") return send(200, JSON.stringify({ quotes: [{ symbol: "NVDA", shortname: "NVIDIA Corporation", exchDisp: "NASDAQ", quoteType: "EQUITY" }, { symbol: "NVD.DE", shortname: "NVIDIA CORP. DL-,001", exchDisp: "XETRA", quoteType: "EQUITY" }, { symbol: "X", quoteType: "OPTION" }] }));
  const f = feedFor(u);
  if (f != null) return send(200, f, "application/rss+xml");
  return send(200, rss([]), "application/rss+xml");
});
server.listen(PORT, "127.0.0.1", () => console.log("mock upstream on", PORT));
