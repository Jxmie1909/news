// Gemeinsamer Zustand der App.
import { rpc } from "./api.js";

export const S = {
  boot: null,       // Antwort von app_bootstrap: Einstellungen, Themen, Status
  tab: "heute",
  today: null,
  todayAt: 0,
  ticker: { items: [], topic: null, q: "", minTier: 1, done: false, loading: false },
  saved: null,
};

export const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, cb) => bus.addEventListener(name, (e) => cb(e.detail));

export async function loadBoot() {
  S.boot = await rpc("app_bootstrap");
  emit("boot");
  return S.boot;
}

export const settings = () => S.boot?.settings ?? {};
export const topics = () => S.boot?.topics ?? [];
