// Datenzugriff: Anmeldung, Datenbank-Funktionen und der Dienst „news“.
import { SUPABASE_KEY, SUPABASE_URL } from "./config.js";

// Anmeldung dauerhaft behalten:
// - eigene Sperre statt der des Browsers (die hängt auf dem iPhone gelegentlich und wirft die Anmeldung weg)
// - Sitzung in localStorage; zusätzlich merkt sich das Gerät die Zugangsdaten (siehe remember/autoLogin)
export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "news.auth",
    lock: async (_name, _timeout, fn) => await fn(),
  },
});

const CRED_KEY = "news.login";
const COOKIE_PATH = location.pathname.replace(/[^/]*$/, "") || "/";

function readCookie(name) {
  const m = document.cookie.split("; ").find((c) => c.startsWith(name + "="));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

/** Zugangsdaten nur auf diesem Gerät merken (zwei Ablageorte, falls das iPhone einen davon leert). */
export function remember(email, password) {
  const v = JSON.stringify({ e: email, p: password });
  try { localStorage.setItem(CRED_KEY, v); } catch { /* egal */ }
  try { document.cookie = `${CRED_KEY}=${encodeURIComponent(v)}; Max-Age=${400 * 86400}; Path=${COOKIE_PATH}; SameSite=Strict${location.protocol === "https:" ? "; Secure" : ""}`; } catch { /* egal */ }
}

export function forget() {
  try { localStorage.removeItem(CRED_KEY); } catch { /* egal */ }
  try { document.cookie = `${CRED_KEY}=; Max-Age=0; Path=${COOKIE_PATH}`; } catch { /* egal */ }
}

function remembered() {
  let v = null;
  try { v = localStorage.getItem(CRED_KEY); } catch { /* egal */ }
  if (!v) v = readCookie(CRED_KEY);
  if (!v) return null;
  try {
    const j = JSON.parse(v);
    if (j?.e && j?.p) {
      remember(j.e, j.p); // beide Ablageorte wieder auffüllen
      return j;
    }
  } catch { /* unlesbar */ }
  return null;
}

/**
 * Gültige Sitzung besorgen, ohne den Nutzer zu behelligen:
 * gespeicherte Sitzung → Verlängerung → stille Neuanmeldung mit gemerkten Zugangsdaten.
 * Ergebnis: "ok" | "none" (wirklich nicht angemeldet) | "offline" (gerade keine Verbindung).
 */
export async function ensureSession() {
  let offline = false;
  try {
    const { data, error } = await sb.auth.getSession();
    if (data?.session) return "ok";
    if (error && /fetch|network|load failed/i.test(error.message ?? "")) offline = true;
  } catch (e) {
    if (/fetch|network|load failed/i.test(String(e?.message ?? e))) offline = true;
  }
  const c = remembered();
  if (c) {
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email: c.e, password: c.p });
      if (data?.session) return "ok";
      if (error && /invalid login/i.test(error.message ?? "")) forget();
      else if (error) offline = true;
    } catch {
      offline = true;
    }
  }
  return offline ? "offline" : "none";
}

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

function friendly(msg) {
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return "Keine Verbindung. Bitte prüfe dein Internet.";
  if (/JWT expired|invalid JWT|forbidden|42501/i.test(msg)) return "Bitte melde dich neu an.";
  return msg;
}

export async function rpc(name, args = {}) {
  let { data, error } = await sb.rpc(name, args);
  if (error && /JWT|forbidden|42501|401/i.test(`${error.message} ${error.code}`)) {
    // Anmeldung abgelaufen: still erneuern und noch einmal versuchen
    try { await sb.auth.refreshSession(); } catch { /* weiter unten */ }
    if ((await ensureSession()) === "ok") ({ data, error } = await sb.rpc(name, args));
  }
  if (error) throw new ApiError(friendly(error.message), Number(error.code) || 0);
  return data;
}

/** Aktion im Dienst aufrufen. */
export async function fn(action, body = {}) {
  const headers = { "Content-Type": "application/json", apikey: SUPABASE_KEY };
  try {
    const { data } = await sb.auth.getSession();
    if (data?.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
  } catch { /* ohne Anmeldung weiter */ }
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/news?action=${encodeURIComponent(action)}`, {
      method: "POST", headers, body: JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError(friendly(String(e?.message ?? e)));
  }
  let json = null;
  try { json = await res.json(); } catch { /* keine JSON-Antwort */ }
  if (!res.ok) throw new ApiError(json?.error ?? `Fehler ${res.status}`, res.status);
  return json;
}

export async function updateSettings(patch) {
  const { error } = await sb.from("settings").update(patch).eq("id", true);
  if (error) throw new ApiError(friendly(error.message));
}

export const topicsApi = {
  async insert(rows) {
    const { data, error } = await sb.from("topics").insert(rows).select();
    if (error) throw new ApiError(friendly(error.message));
    return data;
  },
  async upsertCatalog(rows) {
    const { data, error } = await sb.from("topics").upsert(rows, { onConflict: "catalog_id" }).select();
    if (error) throw new ApiError(friendly(error.message));
    return data;
  },
  async update(id, patch) {
    const { data, error } = await sb.from("topics").update(patch).eq("id", id).select().single();
    if (error) throw new ApiError(friendly(error.message));
    return data;
  },
  async remove(id) {
    const { error } = await sb.from("topics").delete().eq("id", id);
    if (error) throw new ApiError(friendly(error.message));
  },
  async removeMany(ids) {
    if (!ids.length) return;
    const { error } = await sb.from("topics").delete().in("id", ids);
    if (error) throw new ApiError(friendly(error.message));
  },
};

export async function setSourceEnabled(id, enabled) {
  const { error } = await sb.from("sources").update({ enabled, broken: false, fail_count: 0 }).eq("id", id);
  if (error) throw new ApiError(friendly(error.message));
}
