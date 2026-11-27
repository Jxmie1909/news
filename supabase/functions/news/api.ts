// Aktionen, die die App auslöst (Einrichtung, KI-Schlüssel, Test-Push, Aktiensuche …).
import { admin, rpc } from "./db.ts";
import { fetchSource, type SourceRow } from "./feeds.ts";
import { xfetch } from "./http.ts";
import { LlmError, suggestTopics, suggestTopicsFallback, testKey } from "./llm.ts";
import { runAssistant } from "./assistant.ts";
import { deliver, ensureVapid } from "./push.ts";
import { loadConfig, rescoreAll, resetCache } from "./tick.ts";

export const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
}

class HttpError extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
  }
}

async function requireOwner(req: Request, ownerId: string | null): Promise<void> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token || !ownerId) throw new HttpError(401, "Nicht angemeldet");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user || data.user.id !== ownerId) throw new HttpError(401, "Nicht angemeldet");
}

function friendlyLlmError(e: unknown): string {
  if (e instanceof LlmError) {
    if (e.status === 400 || e.status === 401 || e.status === 403) return "Der Schlüssel wurde von Google nicht akzeptiert. Bitte prüfe, ob er vollständig kopiert ist.";
    if (e.status === 429) return "Google meldet: Kontingent gerade aufgebraucht. Der Schlüssel ist aber gültig – versuche es in einer Minute noch einmal.";
    return `Google meldet: ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}

// deno-lint-ignore no-explicit-any
export async function handleApi(action: string, body: any, req: Request): Promise<Response> {
  try {
    if (action === "status") {
      const c = await rpc("service_config");
      return json({ setup_done: !!c.has_owner });
    }

    if (action === "setup") {
      const email = String(body?.email ?? "").trim().toLowerCase();
      const password = String(body?.password ?? "");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "Bitte eine gültige E-Mail-Adresse eingeben.");
      if (password.length < 8) throw new HttpError(400, "Das Passwort braucht mindestens 8 Zeichen.");
      const c = await rpc("service_config");
      if (c.has_owner) throw new HttpError(409, "Die App ist bereits eingerichtet. Bitte melde dich an.");
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data?.user) {
        const msg = error?.message ?? "Unbekannter Fehler";
        throw new HttpError(400, /already/i.test(msg) ? "Diese E-Mail-Adresse ist bereits registriert." : `Konto konnte nicht angelegt werden: ${msg}`);
      }
      const claimed = await rpc("service_claim_owner", { p_user_id: data.user.id });
      if (!claimed) {
        await admin.auth.admin.deleteUser(data.user.id);
        throw new HttpError(409, "Die App ist bereits eingerichtet. Bitte melde dich an.");
      }
      await ensureVapid();
      resetCache();
      return json({ ok: true });
    }

    const { cfg, owner_id, cron_secret, profile_version } = await loadConfig();
    const viaCron = !!cron_secret && req.headers.get("x-cron-secret") === cron_secret;
    if (!viaCron) await requireOwner(req, owner_id);

    switch (action) {
      case "save_key": {
        const key = String(body?.key ?? "").trim();
        if (key.length < 20 || /\s/.test(key)) throw new HttpError(400, "Das sieht nicht nach einem Gemini-Schlüssel aus.");
        try {
          const { model } = await testKey(key);
          await rpc("service_set_secret", { p_key: "gemini_api_key", p_value: key });
          await admin.from("settings").update({ llm_model: model, llm_enabled: true }).eq("id", true);
          resetCache();
          return json({ ok: true, model });
        } catch (e) {
          // Bei reinem Kontingent-Problem ist der Schlüssel gültig: trotzdem speichern
          if (e instanceof LlmError && e.status === 429) {
            await rpc("service_set_secret", { p_key: "gemini_api_key", p_value: key });
            resetCache();
            return json({ ok: true, model: cfg.settings.llm_model, note: friendlyLlmError(e) });
          }
          return json({ ok: false, error: friendlyLlmError(e) });
        }
      }
      case "remove_key": {
        await rpc("service_set_secret", { p_key: "gemini_api_key", p_value: "" });
        resetCache();
        return json({ ok: true });
      }
      case "test_push": {
        await ensureVapid();
        const fresh = (await loadConfig()).cfg;
        const r = await deliver(fresh, { kind: "test", title: "News", body: "Test: Push-Nachrichten funktionieren ✅", reason: "Test aus der App" });
        return json({ ok: r.web_ok > 0 || r.ntfy_ok === true, ...r });
      }
      case "stock_search": {
        const q = String(body?.q ?? "").trim().slice(0, 60);
        if (q.length < 2) return json({ results: [] });
        const r = await xfetch(
          `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&listsCount=0`,
          { headers: { "User-Agent": "Mozilla/5.0 (compatible; NewsReader/1.0)", "Accept": "application/json" }, timeoutMs: 7000 },
        );
        if (!r.ok) {
          await r.body?.cancel();
          return json({ results: [], error: `Suche nicht erreichbar (HTTP ${r.status})` });
        }
        const j = await r.json();
        // deno-lint-ignore no-explicit-any
        const results = (j?.quotes ?? []).filter((x: any) => x?.symbol && ["EQUITY", "ETF", "CRYPTOCURRENCY", "INDEX", "MUTUALFUND"].includes(x.quoteType))
          // deno-lint-ignore no-explicit-any
          .map((x: any) => ({ symbol: String(x.symbol), name: String(x.shortname ?? x.longname ?? x.symbol), exchange: String(x.exchDisp ?? x.exchange ?? ""), type: String(x.quoteType) }))
          .slice(0, 8);
        return json({ results });
      }
      case "suggest_topics": {
        const text = String(body?.text ?? "").trim();
        if (text.length < 3) return json({ topics: [], ai: false });
        const key = cfg.raw.secrets?.gemini_api_key;
        if (key && cfg.settings.llm_enabled) {
          try {
            const topics = await suggestTopics(key, cfg.settings.llm_model, text, cfg.topics.map((t) => t.name));
            await rpc("service_llm_note", { p_calls: 1, p_ok: true });
            return json({ topics, ai: true });
          } catch (e) {
            return json({ topics: suggestTopicsFallback(text), ai: false, note: friendlyLlmError(e) });
          }
        }
        return json({ topics: suggestTopicsFallback(text), ai: false });
      }
      case "assistant": {
        const key = cfg.raw.secrets?.gemini_api_key;
        if (!key) return json({ ok: false, error: "Der Assistent braucht die KI-Verbindung. Trage unter Profil → KI-Einordnung deinen Gemini-Schlüssel ein." });
        const turns = (Array.isArray(body?.messages) ? body.messages : [])
          // deno-lint-ignore no-explicit-any
          .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string" && m.text.trim())
          // deno-lint-ignore no-explicit-any
          .map((m: any) => ({ role: m.role, text: String(m.text) }));
        if (!turns.length || turns[turns.length - 1].role !== "user") throw new HttpError(400, "Frage fehlt");
        try {
          const out = await runAssistant(key, cfg.settings.llm_model, cfg, turns, Number(body?.story_id) || null);
          await rpc("service_llm_note", { p_calls: 1, p_ok: true });
          if (out.actions.length) resetCache();
          return json({ ok: true, ...out });
        } catch (e) {
          return json({ ok: false, error: friendlyLlmError(e) });
        }
      }
      case "rescore": {
        // deno-lint-ignore no-explicit-any
        const state: any = { now: new Date().toISOString(), pushes_today: 0, devices: 0, llm_calls: 0, llm_paused_until: null, last_digest_key: null, profile_version, rescore_pending: true };
        const n = await rescoreAll(cfg, state);
        return json({ ok: true, rescored: n });
      }
      case "probe": {
        // Alle (oder ausgewählte) Quellen einmal testweise abrufen
        let q = admin.from("sources").select("id,key,name,kind,url,lang,category,weight,breaking,topic_id,fail_count");
        if (Array.isArray(body?.keys) && body.keys.length) q = q.in("key", body.keys);
        else if (!body?.all) q = q.eq("enabled", true);
        const { data: rows, error } = await q.order("key").range(Number(body?.offset ?? 0), Number(body?.offset ?? 0) + Math.min(40, Number(body?.limit ?? 25)) - 1);
        if (error) throw new HttpError(500, error.message);
        const out = await Promise.all((rows ?? []).map(async (s) => {
          const src = { ...s, etag: null, last_modified: null, first: true } as SourceRow;
          const r = await fetchSource(src, { secContact: cfg.settings.sec_contact });
          return { key: s.key, ok: r.ok, status: r.status, error: r.error ?? null, items: r.items.length, sample: r.items[0]?.title ?? null, date: r.items[0]?.published_at ?? null, image: !!r.items.find((i) => i.image) };
        }));
        return json({ results: out });
      }
      default:
        throw new HttpError(404, "Unbekannte Aktion");
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error("api error", action, e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
