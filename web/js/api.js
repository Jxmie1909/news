// Datenzugriff: Anmeldung, Datenbank-Funktionen und der Dienst „news“.
import { SUPABASE_KEY, SUPABASE_URL } from "./config.js";

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "news.auth" },
});

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
  const { data, error } = await sb.rpc(name, args);
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
