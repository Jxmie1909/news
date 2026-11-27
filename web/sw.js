// Service Worker: empfängt Push-Nachrichten und hält die App-Hülle für schwaches Netz bereit.
// Strategie: immer zuerst das Netz (Änderungen kommen sofort an), sonst die letzte gespeicherte Fassung.
const CACHE = "news-shell-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([
      fetch(req, { cache: "no-cache" }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
    ]);
    if (res && res.ok && res.type === "basic") cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const hit = (await cache.match(req)) || (req.mode === "navigate" ? await cache.match("./") : null);
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch {
      throw err;
    }
  }
}

self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { t: "News", b: e.data ? e.data.text() : "" };
  }
  const opts = {
    body: d.b || "",
    data: { id: d.id ?? null, kind: d.k ?? "story" },
    icon: "./icons/icon-192.png",
    badge: "./icons/badge-96.png",
  };
  if (d.tag) {
    opts.tag = String(d.tag);
    opts.renotify = true;
  }
  // Punkt am App-Symbol; die genaue Zahl setzt die App beim Öffnen
  try {
    if (d.k !== "test" && self.navigator.setAppBadge) self.navigator.setAppBadge().catch(() => {});
  } catch { /* nicht überall verfügbar */ }
  e.waitUntil(self.registration.showNotification(d.t || "News", opts));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const id = e.notification.data?.id;
  const target = new URL(id ? `./#/story/${id}` : "./", self.registration.scope).href;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope)) {
        try {
          await c.focus();
        } catch { /* manche Browser erlauben das nicht */ }
        c.postMessage({ type: "open", id: id ?? null });
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
