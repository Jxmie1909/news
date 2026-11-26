// Lokaler Ersatz für das Supabase-Gateway: leitet an Anmeldedienst, Daten-API und Edge Function weiter.
import http from "node:http";
const PORT = Number(process.env.GATEWAY_PORT ?? 54321);
const routes = [
  ["/auth/v1", "http://127.0.0.1:9999"],
  ["/rest/v1", "http://127.0.0.1:3000"],
  ["/functions/v1/news", "http://127.0.0.1:8787"],
];
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, content-profile, accept-profile, prefer, x-supabase-api-version, range",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-expose-headers": "content-range",
};
http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
  const r = routes.find(([p]) => req.url.startsWith(p));
  if (!r) { res.writeHead(404, CORS); return res.end("not found"); }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = { ...req.headers };
  delete headers.host; delete headers.connection; delete headers["content-length"];
  // Wie bei Supabase: ohne Anmeldung gilt der öffentliche Schlüssel als Ausweis
  if (!headers.authorization && headers.apikey) headers.authorization = "Bearer " + headers.apikey;
  try {
    const up = await fetch(r[1] + req.url.slice(r[0].length), { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const out = {};
    up.headers.forEach((v, k) => { if (!["content-encoding", "transfer-encoding", "connection", "content-length"].includes(k) && !k.startsWith("access-control-")) out[k] = v; });
    res.writeHead(up.status, { ...out, ...CORS });
    res.end(Buffer.from(await up.arrayBuffer()));
  } catch (e) {
    res.writeHead(502, CORS); res.end(String(e));
  }
}).listen(PORT, "127.0.0.1", () => console.log("gateway on", PORT));
