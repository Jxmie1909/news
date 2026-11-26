// Push auf diesem Gerät: Service Worker anmelden, Erlaubnis holen, Abo beim Dienst hinterlegen.
import { rpc } from "./api.js";
import { isIOS, isStandalone } from "./lib.js";

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** Auf dem iPhone geht Push nur, wenn die App auf dem Home-Bildschirm liegt. */
export function needsInstallFirst() {
  return isIOS && !isStandalone();
}

let regPromise = null;
export function registerSW() {
  if (!("serviceWorker" in navigator)) return Promise.resolve(null);
  if (!regPromise) regPromise = navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch((e) => { console.warn("SW", e); return null; });
  return regPromise;
}

function keyBytes(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function sameKey(sub, vapid) {
  try {
    const cur = sub.options?.applicationServerKey;
    if (!cur) return true;
    const a = new Uint8Array(cur), b = keyBytes(vapid);
    return a.length === b.length && a.every((v, i) => v === b[i]);
  } catch {
    return true;
  }
}

async function ready() {
  await registerSW();
  return await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Der Hintergrunddienst startet nicht. Bitte App neu öffnen.")), 8000)),
  ]);
}

export async function pushStatus() {
  if (!pushSupported()) return { supported: false, permission: "unsupported", subscribed: false };
  let subscribed = false;
  try {
    const reg = await navigator.serviceWorker.getRegistration("./");
    subscribed = !!(reg && (await reg.pushManager.getSubscription()));
  } catch { /* egal */ }
  return { supported: true, permission: Notification.permission, subscribed };
}

async function save(sub) {
  const j = sub.toJSON();
  await rpc("save_push_subscription", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent });
}

/** Muss direkt aus einem Tipp des Nutzers aufgerufen werden. */
export async function enablePush(vapidKey) {
  if (!pushSupported()) throw new Error(needsInstallFirst() ? "Lege die App zuerst auf den Home-Bildschirm." : "Dieses Gerät unterstützt hier keine Push-Nachrichten.");
  if (!vapidKey) throw new Error("Push ist noch nicht vorbereitet. Bitte lade die App neu.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(perm === "denied" ? "Mitteilungen sind für diese App blockiert. Erlaube sie in den Einstellungen deines Geräts." : "Ohne Erlaubnis geht es nicht.");
  const reg = await ready();
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, vapidKey)) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey) });
  await save(sub);
  return true;
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration("./");
  const sub = reg && (await reg.pushManager.getSubscription());
  if (sub) {
    await rpc("delete_push_subscription", { p_endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
}

/** Beim Start: bestehendes Abo erneut hinterlegen (falls es sich geändert hat). */
export async function syncPush(vapidKey) {
  try {
    if (!pushSupported() || Notification.permission !== "granted" || !vapidKey) return false;
    const reg = await navigator.serviceWorker.getRegistration("./");
    if (!reg) return false;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) return false;
    if (!sameKey(sub, vapidKey)) {
      await sub.unsubscribe().catch(() => {});
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey) });
    }
    await save(sub);
    return true;
  } catch (e) {
    console.warn("push sync", e);
    return false;
  }
}
