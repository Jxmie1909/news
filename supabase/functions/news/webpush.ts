// Web-Push nach RFC 8291 (Verschlüsselung aes128gcm) und RFC 8292 (VAPID), nur mit WebCrypto.
import { xfetch } from "./http.ts";

const enc = new TextEncoder();
// Reine Typ-Anpassung (neuere TypeScript-Versionen unterscheiden Puffer-Arten strenger)
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

export function b64u(buf: Uint8Array | ArrayBuffer): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64uDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export interface VapidKeys {
  publicKey: string; // unkomprimierter P-256-Punkt, base64url
  privateJwk: JsonWebKey;
}

export async function generateVapidKeys(): Promise<VapidKeys> {
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  return { publicKey: b64u(pub), privateJwk: jwk };
}

export async function vapidHeader(endpoint: string, subject: string, keys: VapidKeys): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey("jwk", keys.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, bs(enc.encode(`${header}.${payload}`)));
  return `vapid t=${header}.${payload}.${b64u(sig)}, k=${keys.publicKey}`;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", bs(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: bs(salt), info: bs(info) }, key, len * 8));
}

export async function encryptPayload(payload: Uint8Array, p256dh: string, auth: string): Promise<Uint8Array> {
  const uaPub = b64uDecode(p256dh);
  const authSecret = b64uDecode(auth);
  if (uaPub.length !== 65 || authSecret.length < 16) throw new Error("ungültiges Push-Abo");
  const as = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", bs(uaPub), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode("WebPush: info\0"), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", bs(cek), "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: bs(nonce), tagLength: 128 }, key, bs(concat(payload, new Uint8Array([2])))));
  const rs = new Uint8Array([0, 0, 16, 0]); // Satzgröße 4096
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

export interface PushSub {
  id?: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSendResult {
  ok: boolean;
  status: number;
  gone: boolean;
  error?: string;
}

export async function sendWebPush(
  sub: PushSub,
  data: Record<string, unknown>,
  keys: VapidKeys,
  subject: string,
  opts: { ttl?: number; urgency?: "very-low" | "low" | "normal" | "high"; topic?: string } = {},
): Promise<PushSendResult> {
  try {
    const body = await encryptPayload(enc.encode(JSON.stringify(data)), sub.p256dh, sub.auth);
    const headers: Record<string, string> = {
      "Authorization": await vapidHeader(sub.endpoint, subject, keys),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "TTL": String(opts.ttl ?? 6 * 3600),
      "Urgency": opts.urgency ?? "high",
    };
    if (opts.topic) headers["Topic"] = opts.topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
    const r = await xfetch(sub.endpoint, { method: "POST", headers, body: body as unknown as BodyInit, timeoutMs: 8000 });
    const text = r.ok ? "" : (await r.text().catch(() => "")).slice(0, 200);
    if (r.ok) await r.body?.cancel();
    return { ok: r.ok, status: r.status, gone: r.status === 404 || r.status === 410, error: r.ok ? undefined : `HTTP ${r.status} ${text}` };
  } catch (e) {
    return { ok: false, status: 0, gone: false, error: e instanceof Error ? e.message : String(e) };
  }
}
