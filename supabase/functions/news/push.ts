// Push-Nachrichten zustellen: Web-Push an alle angemeldeten Geräte und optional ntfy.
import { admin } from "./db.ts";
import { xfetch } from "./http.ts";
import type { Compiled } from "./score.ts";
import { generateVapidKeys, sendWebPush, type VapidKeys } from "./webpush.ts";
import { rpc } from "./db.ts";

export interface PushMessage {
  kind: "story" | "price" | "digest" | "test";
  title: string;
  body: string;
  storyId?: number | null;
  reason: string;
  urgent?: boolean;
}

export interface DeliverResult {
  web_ok: number;
  web_fail: number;
  ntfy_ok: boolean | null;
  error: string | null;
}

export function vapidFromConfig(cfg: Compiled): VapidKeys | null {
  const pub = cfg.raw.secrets?.vapid_public_key;
  const priv = cfg.raw.secrets?.vapid_private_jwk;
  if (!pub || !priv) return null;
  try {
    return { publicKey: pub, privateJwk: JSON.parse(priv) };
  } catch {
    return null;
  }
}

/** Schlüsselpaar für Web-Push einmalig erzeugen. */
export async function ensureVapid(): Promise<string> {
  const cfg = await rpc("service_config");
  if (cfg?.secrets?.vapid_public_key && cfg?.secrets?.vapid_private_jwk) return cfg.secrets.vapid_public_key;
  const keys = await generateVapidKeys();
  await rpc("service_set_secret", { p_key: "vapid_private_jwk", p_value: JSON.stringify(keys.privateJwk) });
  await rpc("service_set_secret", { p_key: "vapid_public_key", p_value: keys.publicKey });
  return keys.publicKey;
}

function subject(cfg: Compiled): string {
  const site = cfg.settings.site_url ?? "";
  return /^https:\/\/[^/]+\.[a-z]{2,}/i.test(site) ? site : "https://example.org";
}

export async function deliver(cfg: Compiled, msg: PushMessage): Promise<DeliverResult> {
  const res: DeliverResult = { web_ok: 0, web_fail: 0, ntfy_ok: null, error: null };
  const errors: string[] = [];
  const keys = vapidFromConfig(cfg);
  const { data: subs, error: subErr } = await admin.from("push_subscriptions").select("id,endpoint,p256dh,auth,fail_count");
  if (subErr) errors.push(subErr.message);

  if (keys && subs?.length) {
    const payload = { t: msg.title, b: msg.body, id: msg.storyId ?? null, k: msg.kind, tag: msg.storyId ? `s${msg.storyId}` : msg.kind };
    const results = await Promise.all(subs.map((s) =>
      sendWebPush(s, payload, keys, subject(cfg), { urgency: msg.kind === "digest" ? "normal" : "high", ttl: msg.kind === "digest" ? 4 * 3600 : 3 * 3600 })
    ));
    for (let i = 0; i < subs.length; i++) {
      const r = results[i], s = subs[i];
      if (r.ok) {
        res.web_ok++;
        await admin.from("push_subscriptions").update({ last_ok_at: new Date().toISOString(), fail_count: 0 }).eq("id", s.id);
      } else {
        res.web_fail++;
        if (r.error) errors.push(r.error);
        if (r.gone || s.fail_count >= 20) await admin.from("push_subscriptions").delete().eq("id", s.id);
        else await admin.from("push_subscriptions").update({ fail_count: s.fail_count + 1 }).eq("id", s.id);
      }
    }
  }

  if (cfg.settings.ntfy_enabled && cfg.settings.ntfy_topic) {
    try {
      const site = cfg.settings.site_url || "";
      const body: Record<string, unknown> = {
        topic: cfg.settings.ntfy_topic,
        title: msg.title,
        message: msg.body,
        priority: msg.kind === "digest" ? 3 : msg.urgent ? 5 : 4,
        tags: [msg.kind === "price" ? "chart_with_upwards_trend" : msg.kind === "digest" ? "newspaper" : "rotating_light"],
      };
      if (site) body.click = msg.storyId ? `${site}#/story/${msg.storyId}` : site;
      const r = await xfetch("https://ntfy.sh/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), timeoutMs: 8000 });
      res.ntfy_ok = r.ok;
      if (!r.ok) errors.push(`ntfy HTTP ${r.status}`);
      await r.body?.cancel();
    } catch (e) {
      res.ntfy_ok = false;
      errors.push("ntfy: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  res.error = errors.length ? errors.join(" | ").slice(0, 400) : null;
  await admin.from("push_log").insert({
    story_id: msg.storyId ?? null, kind: msg.kind, title: msg.title, body: msg.body, reason: msg.reason,
    web_ok: res.web_ok, web_fail: res.web_fail, ntfy_ok: res.ntfy_ok, error: res.error,
  });
  if (msg.storyId && (msg.kind === "story" || msg.kind === "price")) {
    await admin.from("stories").update({ pushed_at: new Date().toISOString(), push_reason: msg.reason }).eq("id", msg.storyId);
  }
  return res;
}
