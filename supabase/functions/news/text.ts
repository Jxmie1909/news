// Textwerkzeuge: Normalisieren, Zerlegen in Wörter, Entitäten dekodieren, Hashes.

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  hellip: "…", laquo: "«", raquo: "»", bdquo: "„", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  sbquo: "‚", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß",
  euro: "€", copy: "©", reg: "®", trade: "™", deg: "°", eacute: "é", egrave: "è", aacute: "á",
  agrave: "à", ccedil: "ç", ntilde: "ñ", oacute: "ó", iacute: "í", uacute: "ú", shy: "", middot: "·",
  bull: "•", pound: "£", times: "×", prime: "′",
};

export function decodeEntities(s: string): string {
  if (!s || s.indexOf("&") < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, g: string) => {
    if (g[0] === "#") {
      const code = g[1] === "x" || g[1] === "X" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
      try {
        return String.fromCodePoint(code);
      } catch {
        return "";
      }
    }
    return g in NAMED ? NAMED[g] : m;
  });
}

export function stripTags(html: string): string {
  if (!html) return "";
  let s = html.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, " ");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(decodeEntities(s));
  s = s.replace(/<[^>]+>/g, "");
  return s.replace(/[­​‌‍﻿]/g, "").replace(/\s+/g, " ").trim();
}

export function truncate(s: string, n: number): string {
  if (!s || s.length <= n) return s || "";
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(" ");
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:–-]+$/, "") + "…";
}

/** Kleinbuchstaben, Umlaute ausgeschrieben, Akzente entfernt. */
export function normalize(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

const STOP = new Set(
  (
    // Deutsch
    "aber alle allem allen aller alles als also am an ander andere anderem anderen anderer anderes auch auf aus bei beim bin bis bist da damit dann " +
    "das dass dazu dem den denn der des dessen die dies diese diesem diesen dieser dieses doch dort du durch ein eine einem einen einer eines " +
    "er es etwas euch fuer gegen gewesen hab habe haben hat hatte hatten hier hin hinter ich ihm ihn ihnen ihr ihre ihrem ihren ihrer im in ins " +
    "ist jede jedem jeden jeder jedes jetzt kann kein keine keinem keinen keiner koennen koennte machen man manche mehr mein meine mich mir mit " +
    "muss musste nach nicht nichts noch nun nur ob oder ohne sehr sein seine seinem seinen seiner seit sich sie sind so solche soll sollte sondern " +
    "sonst ueber um und uns unser unter viel vom von vor waehrend war waren warum was weg weil weiter welche wenn wer werde werden wie wieder will " +
    "wir wird wo wollen wollte wuerde wuerden zu zum zur zwar zwischen sagt sagte laut neue neuer neues neuen wegen bereits gibt geht kommt " +
    "heute gestern morgen jahr jahre jahren uhr prozent mal immer wohl schon erst etwa rund wurde wurden worden haette koennten duerfte sei seien " +
    "darum deshalb dabei dafuer davon daran darauf zudem ausserdem offenbar erneut weiterhin trotz statt gegenueber bisher kuenftig " +
    // Englisch
    "the and for are but not you all any can had her was one our out day get has him his how its may new now old see two way who boy did " +
    "let put say she too use that with have this will your from they know want been good much some time very when come here just like long make " +
    "many more only over such take than them well were what into about after also back could first other their there these think those would which " +
    "while where should before being between both during each most must said says say still through under until against amid among off per via " +
    "why does don it's i'm he's won't isn't aren't doesn't didn't says report reports according year years week today yesterday tomorrow " +
    // Nachrichtenfloskeln
    "eilmeldung eil breaking live liveblog liveticker ticker update news video podcast kommentar analyse bericht medien exklusiv"
  ).split(/\s+/),
);

// Kurze, aber aussagekräftige Wörter
const SHORT_OK = new Set(["xi", "eu", "un", "uk", "ki", "ai", "fc", "ps"]);

/** Wörter einer Schlagzeile für den Ähnlichkeitsvergleich (gekürzt auf 6 Zeichen als einfache Stammform). */
export function tokenize(title: string, max = 16): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of normalize(title).split(/[^a-z0-9]+/)) {
    if (!raw) continue;
    const hasDigit = /\d/.test(raw);
    if (raw.length < 3 && !(hasDigit && raw.length >= 2) && !SHORT_OK.has(raw)) continue;
    if (STOP.has(raw)) continue;
    const t = raw.slice(0, 6);
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** Schneller, synchroner Hash (2 × cyrb53) als Hex-Text. */
export function hash(str: string): string {
  const h = (seed: number) => {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
  };
  return h(0) + h(0x9e3779b9);
}

const TRACKING = /^(utm_|fbclid|gclid|mc_|ref$|ref_|cmpid|ito$|ocid|ncid|sref|sara_ref|wt_|xtor|at_medium|at_campaign|ftag|taid|smid|partner|feedName|feedType)/i;

export function normalizeUrl(u: string): string {
  try {
    const url = new URL(u.trim());
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    const drop: string[] = [];
    url.searchParams.forEach((_v, k) => {
      if (TRACKING.test(k)) drop.push(k);
    });
    for (const k of drop) url.searchParams.delete(k);
    let s = url.toString();
    if (s.endsWith("?")) s = s.slice(0, -1);
    return s;
  } catch {
    return (u || "").trim();
  }
}

const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "or", "ne"]);

/** "https://www.tagesschau.de/x" → "tagesschau"; "feeds.bbci.co.uk" → "bbci" → Alias "bbc". */
export function publisherKeyFromUrl(u: string): string {
  try {
    const host = new URL(u).hostname.toLowerCase().replace(/^(www|m|amp|mobile|rss|feeds|newsfeed|edition|news|de|en)\./, "");
    const parts = host.split(".");
    if (parts.length <= 1) return host;
    let i = parts.length - 2;
    if (parts.length >= 3 && SECOND_LEVEL.has(parts[i]) && parts[parts.length - 1].length === 2) i -= 1;
    const key = parts[Math.max(0, i)];
    return ALIAS[key] ?? key;
  } catch {
    return "";
  }
}

const ALIAS: Record<string, string> = {
  bbci: "bbc", nytimes: "nyt", "n-tv": "ntv", sueddeutsche: "sz", theguardian: "guardian",
  apnews: "ap", zdfheute: "zdf", dowjones: "marketwatch", feedburner: "", googleblog: "google",
};

export function publisherKeyFromName(name: string): string {
  const n = normalize(name).replace(/^(der|die|das|the)\s+/, "").replace(/\.(de|com|net|org|co\.uk|at|ch)\b/g, "")
    .replace(/\s+(online|news|nachrichten)$/g, "").replace(/[^a-z0-9]/g, "");
  const map: Record<string, string> = {
    spiegel: "spiegel", zeit: "zeit", zeitonline: "zeit", faz: "faz", frankfurterallgemeine: "faz",
    frankfurterallgemeinezeitung: "faz", sueddeutschezeitung: "sz", sueddeutsche: "sz", sz: "sz", ntv: "ntv",
    newyorktimes: "nyt", nytimes: "nyt", guardian: "guardian", bbc: "bbc", apnews: "ap", associatedpress: "ap",
    zdfheute: "zdf", zdf: "zdf", deutschlandfunk: "deutschlandfunk", dw: "dw", deutschewelle: "dw",
    wallstreetjournal: "wsj", wsj: "wsj", financialtimes: "ft", ft: "ft", cnbc: "cnbc", bloomberg: "bloomberg",
    bloombergcom: "bloomberg", reuters: "reuters", tagesschau: "tagesschau", handelsblatt: "handelsblatt",
  };
  return map[n] ?? n;
}

export function titleKey(publisherKey: string, title: string): string {
  return (publisherKey || "x") + "|" + normalize(title).replace(/[^a-z0-9]+/g, "").slice(0, 90);
}

export function parseDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = Date.parse(s.trim());
  if (!Number.isFinite(t)) return null;
  // unplausible Daten verwerfen
  if (t < Date.UTC(2015, 0, 1) || t > Date.now() + 2 * 86400_000) return null;
  return new Date(t).toISOString();
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
