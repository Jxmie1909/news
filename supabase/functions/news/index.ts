// News: ein Dienst für alles – Abruf im Takt (tick) und Aktionen der App.
import { cors, handleApi, json } from "./api.ts";
import { runTick } from "./tick.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  // deno-lint-ignore no-explicit-any
  let body: any = {};
  if (req.method === "POST") {
    try {
      body = await req.json();
    } catch {
      body = {};
    }
  }
  const action = String(url.searchParams.get("action") ?? body?.action ?? "");

  if (action === "tick") {
    const secret = req.headers.get("x-cron-secret") ?? "";
    if (!secret) return json({ error: "forbidden" }, 403);
    const run = runTick(secret).catch((e) => ({ status: "error", error: String(e) }));
    if (url.searchParams.get("wait") === "1") {
      const r = await run;
      return json(r, r.status === "denied" ? 403 : 200);
    }
    // Sofort antworten, im Hintergrund weiterarbeiten
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(run);
    return json({ accepted: true }, 202);
  }
  return await handleApi(action, body, req);
});
