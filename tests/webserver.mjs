// Liefert die Web-App lokal aus; die Konfiguration zeigt dabei auf die lokale Testumgebung.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { ANON_KEY } from "./keys.mjs";
const ROOT = path.resolve(new URL("../web", import.meta.url).pathname);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".json": "application/json" };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  if (p === "/js/config.js") {
    res.writeHead(200, { "Content-Type": TYPES[".js"], "Cache-Control": "no-store" });
    return res.end(`export const SUPABASE_URL = "http://127.0.0.1:54321";\nexport const SUPABASE_KEY = "${ANON_KEY}";\nexport const APP_VERSION = "test";\n`);
  }
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
}).listen(8080, "127.0.0.1", () => console.log("web on 8080"));
