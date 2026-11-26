// Quellen abrufen und in einheitliche Einträge umwandeln (RSS/Atom, Google News, Bluesky, Yahoo, SEC).
import { decodeEntities, parseDate, stripTags, truncate } from "./text.ts";
import { xfetch } from "./http.ts";

export interface RawItem {
  title: string;
  url: string;
  summary: string;
  image: string | null;
  published_at: string | null;
  publisher: string | null; // Name des Anbieters, falls der Eintrag ihn selbst nennt
  publisher_url: string | null;
  extra?: Record<string, unknown>;
}

export interface SourceRow {
  id: string;
  key: string;
  name: string;
  kind: "rss" | "gnews" | "bluesky" | "yahoo" | "sec";
  url: string;
  lang: string;
  category: string | null;
  weight: number;
  breaking: boolean;
  etag: string | null;
  last_modified: string | null;
  first: boolean;
  topic_id: string | null;
  fail_count: number;
}

export interface FetchResult {
  id: string;
  ok: boolean;
  status: number;
  error?: string;
  etag?: string;
  last_modified?: string;
  items: RawItem[];
  new?: number;
}

function tag(block: string, name: string): string | null {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i");
  const m = block.match(re);
  return m ? m[1] : null;
}

function attr(block: string, tagName: string, attrName: string, filter?: (tagText: string) => boolean): string | null {
  const re = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    if (filter && !filter(m[0])) continue;
    const a = m[0].match(new RegExp(`\\b${attrName}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
    if (a) return decodeEntities(a[2] ?? a[3] ?? "");
  }
  return null;
}

function cdata(s: string | null): string {
  if (s == null) return "";
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

function firstImage(block: string, html: string): string | null {
  const cands = [
    attr(block, "media:content", "url", (t) => !/medium\s*=\s*["']video/i.test(t) && !/type\s*=\s*["']video/i.test(t)),
    attr(block, "media:thumbnail", "url"),
    attr(block, "enclosure", "url", (t) => /type\s*=\s*["']image/i.test(t) || /\.(jpe?g|png|webp)(\?|["'])/i.test(t)),
    attr(block, "itunes:image", "href"),
  ];
  for (const c of cands) if (c && /^https?:\/\//i.test(c)) return c;
  const m = decodeEntities(html).match(/<img[^>]+src\s*=\s*["'](https?:\/\/[^"']+)["']/i);
  if (m && !/(pixel|tracking|1x1|feedburner|\/ads?\/|doubleclick|count\.gif|vgwort)/i.test(m[1])) return m[1];
  return null;
}

/** RSS 2.0, RDF und Atom. Bewusst ohne XML-Bibliothek: robust gegen kaputte Feeds und schnell. */
export function parseFeed(xml: string): RawItem[] {
  const items: RawItem[] = [];
  if (!xml) return items;
  const isAtom = /<entry[\s>]/i.test(xml) && !/<item[\s>]/i.test(xml);
  const re = isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi;
  const blocks = xml.match(re) || [];
  for (const b of blocks.slice(0, 120)) {
    const title = stripTags(cdata(tag(b, "title")));
    if (!title) continue;
    let url = "";
    if (isAtom) {
      url = attr(b, "link", "href", (t) => /rel\s*=\s*["']alternate/i.test(t)) ??
        attr(b, "link", "href", (t) => !/rel\s*=/i.test(t)) ?? attr(b, "link", "href") ?? "";
    } else {
      url = decodeEntities(cdata(tag(b, "link"))).trim();
      if (!url) url = attr(b, "link", "href") ?? "";
      if (!url) {
        const guid = decodeEntities(cdata(tag(b, "guid"))).trim();
        if (/^https?:\/\//i.test(guid)) url = guid;
      }
    }
    url = url.trim();
    if (!/^https?:\/\//i.test(url)) continue;
    const rawDesc = cdata(tag(b, "description") ?? tag(b, "summary") ?? "");
    const rawContent = cdata(tag(b, "content:encoded") ?? tag(b, "content") ?? "");
    const summary = truncate(stripTags(rawDesc || rawContent), 420);
    const date = parseDate(cdata(tag(b, "pubDate") ?? tag(b, "dc:date") ?? tag(b, "published") ?? tag(b, "updated") ?? tag(b, "date") ?? ""));
    const srcName = stripTags(cdata(tag(b, "source") ?? tag(b, "News:Source") ?? ""));
    const srcUrl = attr(b, "source", "url");
    const newsImage = decodeEntities(cdata(tag(b, "News:Image") ?? "")).trim();
    items.push({
      title,
      url,
      summary: summary === title ? "" : summary,
      image: firstImage(b, rawDesc + " " + rawContent) ?? (/^https?:\/\//.test(newsImage) ? newsImage : null),
      published_at: date,
      publisher: srcName || null,
      publisher_url: srcUrl,
    });
  }
  return items;
}

/** Google News hängt " - Anbieter" an die Schlagzeile und liefert als Beschreibung nur eine Linkliste. */
export function cleanGoogleItem(it: RawItem): RawItem {
  let title = it.title;
  if (it.publisher) {
    const suffix = " - " + it.publisher;
    if (title.endsWith(suffix)) title = title.slice(0, -suffix.length).trim();
  } else {
    const m = title.match(/^(.*) - ([^-]{2,40})$/);
    if (m) {
      title = m[1].trim();
      it.publisher = m[2].trim();
    }
  }
  return { ...it, title, summary: "", image: null };
}

export function isGoogleNewsUrl(u: string): boolean {
  return /^https?:\/\/news\.google\.com\//i.test(u);
}

// Themensuche: Bing-Nachrichtensuche als Feed (Google News blockiert Abrufe aus Rechenzentren).
const BING_MARKET: Record<string, string> = {
  de: "setlang=de-DE&cc=DE",
  en: "setlang=en-US&cc=US",
};

export function sourceUrl(src: SourceRow): string {
  switch (src.kind) {
    case "gnews": {
      const q = src.url.replace(/\s+when:\d+[hd]\s*$/i, "");
      return `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&${BING_MARKET[src.lang] ?? BING_MARKET.en}&qft=${encodeURIComponent('sortbydate="1"')}`;
    }
    case "yahoo":
      return `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(src.url)}&region=US&lang=en-US`;
    case "bluesky":
      return `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(src.url)}&limit=20&filter=posts_no_replies`;
    default:
      return src.url;
  }
}

/** Bing verpackt den Artikel-Link in eine Weiterleitung und nennt den Anbieter in einem eigenen Feld. */
export function cleanBingItem(it: RawItem): RawItem {
  let url = it.url;
  try {
    const u = new URL(url);
    if (/(^|\.)bing\.com$/i.test(u.hostname) && u.pathname.includes("apiclick")) {
      const real = u.searchParams.get("url");
      if (real && /^https?:\/\//i.test(real)) url = real;
    }
  } catch { /* Link bleibt wie er ist */ }
  let publisherUrl: string | null = null;
  try {
    publisherUrl = new URL(url).origin;
  } catch { /* egal */ }
  const image = it.image && /^https?:\/\//.test(it.image) ? it.image.replace(/^http:/, "https:") : null;
  return { ...it, url, publisher: it.publisher || null, publisher_url: publisherUrl, image };
}

// deno-lint-ignore no-explicit-any
export function parseBluesky(json: any, handle: string, name: string): RawItem[] {
  const out: RawItem[] = [];
  for (const entry of json?.feed ?? []) {
    if (entry?.reason) continue; // Reposts überspringen
    const post = entry?.post;
    const rec = post?.record;
    if (!post || !rec || rec.reply) continue;
    const text: string = (rec.text ?? "").replace(/\s+/g, " ").trim();
    const ext = post.embed?.external ?? post.embed?.media?.external;
    const rkey = String(post.uri ?? "").split("/").pop();
    const postUrl = `https://bsky.app/profile/${post.author?.handle ?? handle}/post/${rkey}`;
    let title = "";
    let url = postUrl;
    let summary = "";
    let image: string | null = null;
    if (ext?.uri && /^https?:\/\//.test(ext.uri)) {
      url = ext.uri;
      title = (ext.title ?? "").trim();
      summary = (ext.description ?? "").trim();
      image = typeof ext.thumb === "string" ? ext.thumb : null;
      // Der Beitragstext ist oft die eigentliche Eilmeldung
      const clean = text.replace(/https?:\/\/\S+/g, "").replace(/\s+\S*\.\.\.$/, "").trim();
      if (!title || title.length < 15) title = clean;
      else if (clean && clean.length > 20 && clean !== title && !summary) summary = clean;
    } else {
      title = text.replace(/https?:\/\/\S+/g, "").trim();
      const img = post.embed?.images?.[0];
      image = img?.thumb ?? null;
    }
    if (!title || title.length < 15) continue;
    if (title.length > 220) {
      summary = summary || title;
      title = truncate(title, 180);
    }
    out.push({
      title,
      url,
      summary: truncate(summary, 420),
      image,
      published_at: parseDate(rec.createdAt ?? post.indexedAt),
      publisher: name,
      publisher_url: null,
    });
  }
  return out;
}

const SEC_ITEMS: Record<string, { de: string; event: string }> = {
  "1.01": { de: "Wesentliche Vereinbarung geschlossen", event: "ma" },
  "1.02": { de: "Wesentliche Vereinbarung beendet", event: "legal" },
  "1.03": { de: "Insolvenzverfahren", event: "legal" },
  "2.01": { de: "Übernahme oder Verkauf abgeschlossen", event: "ma" },
  "2.02": { de: "Geschäftszahlen veröffentlicht", event: "earnings" },
  "2.05": { de: "Umbau oder Stellenabbau", event: "legal" },
  "2.06": { de: "Wesentliche Abschreibung", event: "earnings" },
  "3.01": { de: "Hinweis auf drohendes Delisting", event: "legal" },
  "4.01": { de: "Wechsel des Wirtschaftsprüfers", event: "legal" },
  "4.02": { de: "Frühere Bilanzen nicht verlässlich", event: "legal" },
  "5.01": { de: "Kontrollwechsel", event: "ma" },
  "5.02": { de: "Wechsel im Vorstand oder Aufsichtsrat", event: "leadership" },
  "5.07": { de: "Abstimmung der Aktionäre", event: "other" },
  "7.01": { de: "Mitteilung an Anleger", event: "other" },
  "8.01": { de: "Sonstiges wichtiges Ereignis", event: "other" },
};

/** SEC-Feed: Titel wie "8-K - NVIDIA CORP (0001045810) (Filer)", Punkte stehen in der Zusammenfassung. */
export function parseSec(xml: string): RawItem[] {
  const out: RawItem[] = [];
  const blocks = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    const rawTitle = stripTags(cdata(tag(b, "title")));
    const m = rawTitle.match(/^8-K(?:\/A)?\s*-\s*(.+?)\s*\((\d{6,10})\)/i);
    if (!m) continue;
    const company = m[1].trim();
    const url = attr(b, "link", "href") ?? "";
    if (!/^https?:\/\//.test(url)) continue;
    const summary = stripTags(cdata(tag(b, "summary") ?? ""));
    const codes = Array.from(new Set((summary.match(/Item\s+(\d\.\d{2})/gi) || []).map((x) => x.replace(/Item\s+/i, ""))));
    const known = codes.filter((c) => SEC_ITEMS[c] && c !== "9.01");
    const labels = known.map((c) => SEC_ITEMS[c].de);
    const events = known.map((c) => SEC_ITEMS[c].event).filter((e) => e !== "other");
    const order = ["leadership", "ma", "earnings", "legal"];
    events.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    out.push({
      title: `${company}: Pflichtmeldung an die US-Börsenaufsicht` + (labels.length ? ` – ${labels.slice(0, 2).join(", ")}` : ""),
      url,
      summary: labels.length
        ? `Das Unternehmen hat eine 8-K-Meldung eingereicht: ${labels.join("; ")}.`
        : "Das Unternehmen hat eine 8-K-Meldung eingereicht.",
      image: null,
      published_at: parseDate(cdata(tag(b, "updated") ?? "")),
      publisher: "SEC",
      publisher_url: "https://www.sec.gov",
      extra: { company, event: events[0] ?? null, sec_items: known },
    });
  }
  return out;
}

/** Antwort als Text lesen und dabei den angegebenen Zeichensatz beachten (manche Feeds sind nicht UTF-8). */
export async function readText(r: Response): Promise<string> {
  const buf = new Uint8Array(await r.arrayBuffer());
  let charset = /charset=([\w-]+)/i.exec(r.headers.get("content-type") ?? "")?.[1]?.toLowerCase() ?? "";
  if (!charset) {
    const head = new TextDecoder("latin1").decode(buf.subarray(0, 200));
    charset = /encoding=["']([\w-]+)["']/i.exec(head)?.[1]?.toLowerCase() ?? "utf-8";
  }
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

const UA_BROWSER = "Mozilla/5.0 (compatible; NewsReader/1.0; personal news reader)";

export async function fetchSource(src: SourceRow, opts: { secContact?: string } = {}): Promise<FetchResult> {
  const res: FetchResult = { id: src.id, ok: false, status: 0, items: [] };
  try {
    const headers: Record<string, string> = {
      "User-Agent": UA_BROWSER,
      "Accept": src.kind === "bluesky"
        ? "application/json"
        : "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
      "Accept-Language": src.lang === "de" ? "de-DE,de;q=0.9,en;q=0.6" : "en-US,en;q=0.9",
    };
    if (src.kind === "sec") {
      if (!opts.secContact) {
        res.ok = true;
        res.status = 204;
        return res;
      }
      headers["User-Agent"] = `NewsReader ${opts.secContact}`;
    }
    if (src.etag) headers["If-None-Match"] = src.etag;
    if (src.last_modified) headers["If-Modified-Since"] = src.last_modified;
    const r = await xfetch(sourceUrl(src), { headers, timeoutMs: 9000 });
    res.status = r.status;
    if (r.status === 304) {
      await r.body?.cancel();
      res.ok = true;
      return res;
    }
    if (!r.ok) {
      await r.body?.cancel();
      res.error = `HTTP ${r.status}`;
      return res;
    }
    const etag = r.headers.get("etag");
    const lm = r.headers.get("last-modified");
    if (etag) res.etag = etag;
    if (lm) res.last_modified = lm;
    const body = await readText(r);
    if (body.length > 4_000_000) {
      res.error = "Antwort zu groß";
      return res;
    }
    if (src.kind === "bluesky") {
      res.items = parseBluesky(JSON.parse(body), src.url, src.name);
    } else if (src.kind === "sec") {
      res.items = parseSec(body);
    } else {
      let items = parseFeed(body);
      if (items.length === 0 && !/<(rss|feed|rdf:RDF)[\s>]/i.test(body)) {
        res.error = "Kein gültiger Feed";
        return res;
      }
      if (src.kind === "gnews") items = items.map(cleanBingItem);
      else if (items.some((i) => isGoogleNewsUrl(i.url))) items = items.map((i) => (isGoogleNewsUrl(i.url) ? cleanGoogleItem(i) : i));
      res.items = items;
    }
    res.ok = true;
    return res;
  } catch (e) {
    res.error = e instanceof Error ? (e.name === "TimeoutError" ? "Zeitüberschreitung" : e.message) : String(e);
    return res;
  }
}
