// Start der App: Anmeldung, Reiter (Heute / Ticker / Gemerkt / Profil), Aktualisieren.
import { ensureSession, fn, forget, remember, rpc, sb, updateSettings } from "./api.js";
import { APP_VERSION } from "./config.js";
import { ago, busy, clear, closeAllSheets, debounce, h, icon, isIOS, isStandalone, longDate, openSheet, secondsAgo, sheetCount, store, toast } from "./lib.js";
import { openInterestCheck, openOnboarding } from "./onboarding.js";
import { renderProfile, openPushSettings, openInstallHelp } from "./profile.js";
import { needsInstallFirst, pushStatus, pushSupported, registerSW, syncPush } from "./push.js";
import { loadBoot, on, S, settings, topics } from "./state.js";
import { leadCard, openStory, skeleton, storyRow } from "./stories.js";

const view = document.getElementById("view");
let tabbar = null, pill = null, ptr = null;
let statusTimer = null, pollTimer = null;

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
async function start() {
  registerSW();
  navigator.serviceWorker?.addEventListener("message", (e) => {
    if (e.data?.type === "open") {
      if (e.data.id) openStory(e.data.id);
      else if (S.boot) { setTab("heute"); refreshToday(true); }
    }
  });
  const state = await ensureSession();
  if (state === "none") return showAuth();
  if (state === "offline") return showFatal("Gerade keine Verbindung. Deine Anmeldung bleibt erhalten.");
  await enter();
}

async function enter() {
  try {
    await loadBoot();
  } catch (e) {
    // Nur zur Anmeldung zurück, wenn wirklich keine Sitzung mehr zu bekommen ist; nie von selbst abmelden
    if ((/anmelden|forbidden/i.test(e.message) || e.status === 42501) && (await ensureSession()) === "none") return showAuth();
    return showFatal(e.message);
  }
  const site = location.origin + location.pathname.replace(/index\.html$/, "");
  if (settings().site_url !== site && location.protocol === "https:") updateSettings({ site_url: site }).catch(() => {});
  syncPush(S.boot.vapid_public_key);
  if (!settings().onboarding_done) {
    clear(view);
    openOnboarding({ onDone: async () => { await loadBoot(); showShell(); } });
    return;
  }
  showShell();
}

function showFatal(msg) {
  clear(view, h("div", { class: "auth" }, h("div", { class: "box", style: { textAlign: "center" } },
    h("div", { class: "empty" }, h("div", { class: "big" }, "📡"), h("strong", null, "Keine Verbindung zum Dienst"), msg),
    h("button", { class: "btn primary block", onclick: () => location.reload() }, "Erneut versuchen"))));
}

// ---------------------------------------------------------------------------
// Anmeldung / erste Einrichtung
// ---------------------------------------------------------------------------
async function showAuth() {
  destroyShell();
  clear(view, h("div", { class: "center", style: { minHeight: "100dvh" } }, h("span", { class: "spin" })));
  let setupDone = true;
  try {
    setupDone = (await fn("status")).setup_done;
  } catch (e) {
    return showFatal(e.message);
  }
  const email = h("input", { class: "input", type: "email", autocomplete: "username", inputmode: "email", autocapitalize: "none", spellcheck: false, placeholder: "du@beispiel.de", value: store.get("email", "") });
  const pass = h("input", { class: "input", type: "password", autocomplete: setupDone ? "current-password" : "new-password", placeholder: setupDone ? "Dein Passwort" : "Mindestens 8 Zeichen" });
  const err = h("div", { class: "error", role: "alert", hidden: true });
  const btn = h("button", { class: "btn primary block", type: "submit" }, setupDone ? "Anmelden" : "Konto anlegen");
  const form = h("form", { novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    err.hidden = true;
    const em = email.value.trim().toLowerCase(), pw = pass.value;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { err.textContent = "Bitte gib eine gültige E-Mail-Adresse ein."; err.hidden = false; return; }
    if (pw.length < 8) { err.textContent = "Das Passwort braucht mindestens 8 Zeichen."; err.hidden = false; return; }
    busy(btn, true);
    try {
      if (!setupDone) await fn("setup", { email: em, password: pw });
      const { error } = await sb.auth.signInWithPassword({ email: em, password: pw });
      if (error) throw new Error(/invalid login/i.test(error.message) ? "E-Mail oder Passwort stimmt nicht." : error.message);
      store.set("email", em);
      remember(em, pw);
      await enter();
    } catch (e2) {
      err.textContent = e2.message;
      err.hidden = false;
      busy(btn, false);
    }
  } },
    h("label", { class: "field" }, h("span", null, "E-Mail"), email),
    h("label", { class: "field" }, h("span", null, "Passwort"), pass),
    err,
    h("div", { style: { marginTop: "18px" } }, btn));
  clear(view, h("div", { class: "auth" }, h("div", { class: "box" },
    h("img", { class: "logo", src: "icons/icon-192.png", alt: "" }),
    h("h1", null, setupDone ? "Willkommen zurück" : "Deine News"),
    h("p", { class: "lede" }, setupDone
      ? "Melde dich an, um deine Nachrichten zu sehen."
      : "Lege einmalig dein Konto an. Nur du hast Zugriff auf diese App – es wird keine E-Mail verschickt."),
    form)));
  (email.value ? pass : email).focus({ preventScroll: true });
}

// ---------------------------------------------------------------------------
// Hülle mit Reitern
// ---------------------------------------------------------------------------
const TABS = [
  { id: "heute", label: "Heute", icon: "today" },
  { id: "ticker", label: "Ticker", icon: "ticker" },
  { id: "gemerkt", label: "Gemerkt", icon: "saved" },
  { id: "profil", label: "Profil", icon: "profile" },
];

function destroyShell() {
  tabbar?.remove(); pill?.remove(); ptr?.remove();
  tabbar = pill = ptr = null;
  clearInterval(statusTimer); clearInterval(pollTimer);
  closeAllSheets();
}

function showShell() {
  destroyShell();
  tabbar = h("nav", { class: "tabbar", "aria-label": "Hauptnavigation" }, h("div", { class: "inner" }, TABS.map((t) =>
    h("button", { type: "button", dataset: { tab: t.id }, onclick: () => { if (S.tab === t.id) window.scrollTo({ top: 0, behavior: "smooth" }); else setTab(t.id); } }, icon(t.icon), t.label))));
  pill = h("button", { class: "pill", type: "button", onclick: () => { hidePill(); setTab("heute"); refreshToday(true); window.scrollTo({ top: 0, behavior: "smooth" }); } });
  ptr = h("div", { class: "ptr", "aria-hidden": "true" }, h("span", { class: "arrow" }, "↓"), h("span", { class: "spin" }));
  document.body.append(tabbar, pill, ptr);
  setupPullToRefresh();
  pollTimer = setInterval(poll, 30_000);
  statusTimer = setInterval(updateStatusLine, 5_000);
  document.addEventListener("visibilitychange", onVisible);
  const m = /^#\/story\/(\d+)/.exec(location.hash);
  setTab("heute");
  if (m) {
    history.replaceState(null, "", location.pathname + location.search);
    setTimeout(() => openStory(Number(m[1])), 150);
  }
}

function onVisible() {
  if (document.visibilityState !== "visible" || !tabbar) return;
  if (S.tab === "heute" && Date.now() - S.todayAt > 60_000) refreshToday(false);
  else poll();
}

const scrollPos = {};
function setTab(id) {
  scrollPos[S.tab] = window.scrollY;
  S.tab = id;
  for (const b of tabbar.querySelectorAll("button")) b.classList.toggle("on", b.dataset.tab === id);
  hidePill();
  const page = h("div", { class: "tab-page wrap" });
  clear(view, page);
  if (id === "heute") renderToday(page);
  else if (id === "ticker") renderTicker(page);
  else if (id === "gemerkt") renderSaved(page);
  else renderProfile(page, { onLogout: logout, onRestartOnboarding: () => openOnboarding({ restart: true, onDone: async () => { await loadBoot(); showShell(); } }) });
  window.scrollTo(0, id === "heute" ? 0 : (scrollPos[id] ?? 0));
}

async function logout() {
  forget();
  await sb.auth.signOut({ scope: "local" }).catch(() => {});
  S.boot = null; S.today = null; S.saved = null; S.ticker.items = [];
  showAuth();
}

// ---------------------------------------------------------------------------
// Heute
// ---------------------------------------------------------------------------
let todayPage = null;
let lastSeenShown = null;

function renderToday(page) {
  todayPage = page;
  drawToday();
  if (!S.today || Date.now() - S.todayAt > 45_000) refreshToday(false);
}

export async function refreshToday(force) {
  try {
    const data = await rpc("feed_today");
    if (lastSeenShown == null || force) lastSeenShown = data.last_seen_at;
    S.today = data;
    S.todayAt = Date.now();
    if (S.boot?.status) S.boot.status.last_tick_at = data.last_tick_at;
    if (S.tab === "heute") drawToday();
    hidePill();
    setTimeout(() => rpc("mark_seen").catch(() => {}), 2500);
  } catch (e) {
    if (S.tab === "heute" && !S.today) clear(todayPage, header(), h("div", { class: "empty" }, h("div", { class: "big" }, "📡"), h("strong", null, "Konnte nicht laden"), e.message, h("div", { style: { marginTop: "16px" } }, h("button", { class: "btn", onclick: () => refreshToday(true) }, "Erneut versuchen"))));
    else toast(e.message);
  }
}

function header() {
  return h("header", { class: "hero" },
    h("div", { class: "date" }, longDate()),
    h("h1", null, "Heute"),
    h("div", { class: "status", id: "status-line" }));
}

function updateStatusLine() {
  const el = document.getElementById("status-line");
  if (!el) return;
  const last = S.today?.last_tick_at ?? S.boot?.status?.last_tick_at;
  const age = last ? (Date.now() - new Date(last).getTime()) / 1000 : Infinity;
  const live = age < 120;
  clear(el, h("span", { class: "dot " + (live ? "live" : "warn") }),
    last ? (live ? `Läuft · zuletzt geprüft ${secondsAgo(last)}` : `Letzte Prüfung ${secondsAgo(last)}`) : "Der Abruf startet gleich");
}

async function hintCards() {
  const cards = [];
  const dismissed = store.get("dismissed", {});
  const dismiss = (key, el) => { dismissed[key] = Date.now(); store.set("dismissed", dismissed); el.remove(); };
  const s = settings();

  // Push auf diesem Gerät
  if (!dismissed.push || Date.now() - dismissed.push > 3 * 86400_000) {
    const st = await pushStatus();
    if (needsInstallFirst()) {
      const el = h("div", { class: "note" }, h("div", { class: "ico" }, "📲"), h("div", { class: "txt" },
        h("strong", null, "Als App installieren"), "Lege News auf deinen Home-Bildschirm. Erst dann sind Push-Nachrichten möglich.",
        h("div", { class: "row" }, h("button", { class: "btn small accent", onclick: () => openInstallHelp() }, "So geht's"))),
        h("button", { class: "x", "aria-label": "Ausblenden", onclick: () => dismiss("push", el) }, "×"));
      cards.push(el);
    } else if (pushSupported() && !st.subscribed && s.push_enabled) {
      const el = h("div", { class: "note" }, h("div", { class: "ico" }, "🔔"), h("div", { class: "txt" },
        h("strong", null, "Push-Nachrichten einschalten"), "Damit dich wichtige Meldungen sofort erreichen.",
        h("div", { class: "row" }, h("button", { class: "btn small accent", onclick: () => openPushSettings() }, "Einschalten"))),
        h("button", { class: "x", "aria-label": "Ausblenden", onclick: () => dismiss("push", el) }, "×"));
      cards.push(el);
    }
  }
  // Regelmäßiger Interessen-Check
  const lastCheck = s.last_check_at ? new Date(s.last_check_at).getTime() : 0;
  if (lastCheck && Date.now() - lastCheck > 21 * 86400_000 && (!dismissed.check || Date.now() - dismissed.check > 7 * 86400_000)) {
    const el = h("div", { class: "note" }, h("div", { class: "ico" }, "🎯"), h("div", { class: "txt" },
      h("strong", null, "Kurzer Interessen-Check"), "10 Schlagzeilen, 1 Minute – damit dein Profil aktuell bleibt.",
      h("div", { class: "row" }, h("button", { class: "btn small accent", onclick: () => { el.remove(); openInterestCheck(10); } }, "Starten"))),
      h("button", { class: "x", "aria-label": "Später", onclick: () => dismiss("check", el) }, "×"));
    cards.push(el);
  }
  return cards;
}

/**
 * Dieselbe Nachricht kommt oft in mehreren Fassungen (z. B. deutsch und englisch).
 * Unter „Wichtig“ nur eine davon zeigen: gleiche Themen + gleiche Art des Ereignisses, zeitlich nah.
 */
function collapseSame(list) {
  const langs = settings().languages ?? ["de"];
  const rank = (s) => { const i = langs.indexOf(s.lang); return i < 0 ? 9 : i; };
  const kept = [];
  for (const s of list) {
    const key = (x) => (x.topics ?? []).map((t) => t.id).sort().join(",") + "|" + (x.event ?? "");
    const i = kept.findIndex((k) => k.kind === "news" && s.kind === "news" && (s.topics ?? []).length > 0 && s.event && key(k) === key(s) && Math.abs(new Date(k.at) - new Date(s.at)) < 3 * 3600_000);
    if (i < 0) { kept.push({ ...s }); continue; }
    const k = kept[i];
    const merged = rank(s) < rank(k) ? { ...s } : k;
    merged.sources = Math.max(k.sources ?? 1, s.sources ?? 1) + Math.min(k.sources ?? 1, s.sources ?? 1);
    merged.read = k.read && s.read;
    kept[i] = merged;
  }
  return kept;
}

function drawToday() {
  if (!todayPage || S.tab !== "heute") return;
  const d = S.today;
  if (!d) {
    clear(todayPage, header(), skeleton(6));
    updateStatusLine();
    return;
  }
  const total = d.top.length + d.foryou.length + d.more.length;
  const notes = h("div");
  const out = [header(), notes];
  const ls = lastSeenShown;
  if (total === 0) {
    out.push(h("div", { class: "empty" }, h("div", { class: "big" }, "☕"), h("strong", null, "Noch ist es ruhig"),
      topics().length ? "Sobald etwas zu deinen Themen passiert, steht es hier. Die ersten Meldungen kommen meist nach wenigen Minuten." : "Lege im Profil Themen an, damit hier etwas erscheint."));
  } else {
    if (d.top.length) {
      const top = collapseSame(d.top);
      out.push(h("h2", { class: "sec hot" }, h("span", { class: "dot hot" }), "Wichtig", h("span", { class: "count" }, String(top.length))));
      out.push(h("div", null, top.map((s, i) => (i < 2 || s.image ? leadCard(s, { lastSeen: ls }) : storyRow(s, { lastSeen: ls })))));
    }
    if (d.foryou.length) {
      out.push(h("h2", { class: "sec" }, "Für dich", h("span", { class: "count" }, String(d.foryou.length))));
      out.push(h("div", null, d.foryou.map((s) => storyRow(s, { lastSeen: ls }))));
    }
    if (d.more.length) {
      out.push(h("h2", { class: "sec" }, "Außerdem"));
      out.push(h("div", null, d.more.map((s) => storyRow(s, { compact: true, lastSeen: ls }))));
    }
    out.push(h("div", { class: "done" }, h("div", { class: "check" }, "✓"), h("strong", null, "Du bist auf dem neuesten Stand"),
      h("span", null, "Mehr gibt es gerade nicht – alles Weitere findest du im Ticker."),
      h("div", { style: { marginTop: "14px" } }, h("button", { class: "btn small", onclick: () => setTab("ticker") }, "Zum Ticker"))));
  }
  clear(todayPage, out);
  updateStatusLine();
  hintCards().then((cards) => clear(notes, cards)).catch(() => {});
}

// Neue Meldungen im Hintergrund erkennen
async function poll() {
  if (!S.boot || document.visibilityState !== "visible" || !S.today) return;
  try {
    const r = await rpc("feed_new_count", { p_since: S.today.now });
    if (S.boot.status) S.boot.status.last_tick_at = r.last_tick_at;
    S.today.last_tick_at = r.last_tick_at;
    updateStatusLine();
    if (r.important > 0 && sheetCount() === 0) showPill(r.important, r.top);
  } catch { /* still */ }
}

function showPill(n, top) {
  if (!pill) return;
  clear(pill, top > 0 ? "🔴" : "↑", n === 1 ? "1 neue Meldung" : `${n} neue Meldungen`);
  pill.classList.add("show");
  const b = tabbar?.querySelector('[data-tab="heute"]');
  if (b && S.tab !== "heute" && !b.querySelector(".pip")) b.append(h("span", { class: "pip" }));
}
function hidePill() {
  pill?.classList.remove("show");
  tabbar?.querySelector('[data-tab="heute"] .pip')?.remove();
}

// ---------------------------------------------------------------------------
// Ticker
// ---------------------------------------------------------------------------
function renderTicker(page) {
  const T = S.ticker;
  const list = h("div");
  const moreWrap = h("div", { style: { padding: "18px 0", textAlign: "center" } });
  const search = h("input", { class: "input", type: "search", placeholder: "Suchen …", value: T.q, enterkeyhint: "search", autocapitalize: "none" });
  const chipRow = h("div", { class: "chiprow" });

  const drawChips = () => {
    const mk = (label, active, fn2) => h("button", { type: "button", class: "chip small scroll" + (active ? " on" : ""), onclick: fn2 }, label);
    clear(chipRow,
      mk("Alle", !T.topic && T.minTier === 1, () => { T.topic = null; T.minTier = 1; reload(); }),
      mk("Nur Wichtiges", !T.topic && T.minTier === 2, () => { T.topic = null; T.minTier = 2; reload(); }),
      topics().filter((t) => t.active && t.priority > 0).map((t) =>
        mk(`${t.emoji ? t.emoji + " " : ""}${t.name}`, T.topic === t.id, () => { T.topic = T.topic === t.id ? null : t.id; T.minTier = 1; reload(); })));
  };

  const drawList = () => {
    if (T.loading && !T.items.length) return clear(list, skeleton(7));
    if (!T.items.length) {
      return clear(list, h("div", { class: "empty" }, h("div", { class: "big" }, T.q ? "🔍" : "🗞️"), h("strong", null, T.q ? "Nichts gefunden" : "Noch keine Meldungen"),
        T.q ? `Keine Meldung enthält „${T.q}“.` : "Hier erscheint alles, was hereinkommt – zeitlich sortiert."));
    }
    clear(list, T.items.map((s) => storyRow(s, { compact: !s.image && s.tier < 2 })));
    clear(moreWrap, T.done
      ? h("span", { style: { color: "var(--text-3)", fontSize: "14px" } }, "Das war alles.")
      : h("button", { class: "btn", onclick: (e) => loadMore(e.currentTarget) }, "Ältere laden"));
  };

  const fetchPage = async (before) => await rpc("feed_ticker", {
    p_limit: 30, p_topic: T.topic, p_q: T.q || null, p_min_tier: T.minTier,
    p_before: before?.at ?? null, p_before_id: before?.id ?? null,
  });

  const reload = async () => {
    drawChips();
    T.loading = true; T.items = []; T.done = false;
    clear(moreWrap);
    drawList();
    try {
      const rows = await fetchPage(null);
      T.items = rows;
      T.done = rows.length < 30;
    } catch (e) { toast(e.message); }
    T.loading = false;
    if (S.tab === "ticker") drawList();
  };
  const loadMore = async (btn) => {
    if (T.loading || T.done) return;
    T.loading = true;
    busy(btn, true);
    try {
      const rows = await fetchPage(T.items[T.items.length - 1]);
      T.items = T.items.concat(rows);
      T.done = rows.length < 30;
    } catch (e) { toast(e.message); }
    T.loading = false;
    drawList();
  };
  search.addEventListener("input", debounce(() => { T.q = search.value.trim(); reload(); }, 350));
  page._reload = reload;

  clear(page,
    h("header", { class: "hero" }, h("h1", null, "Ticker"), h("div", { class: "status" }, "Alles der Reihe nach – neueste zuerst.")),
    h("div", { class: "search" }, icon("search"), search),
    chipRow, list, moreWrap);
  drawChips();
  if (T.items.length) drawList(); else reload();
}

// ---------------------------------------------------------------------------
// Gemerkt
// ---------------------------------------------------------------------------
function renderSaved(page) {
  const list = h("div");
  const draw = () => {
    if (S.saved == null) return clear(list, skeleton(4));
    if (!S.saved.length) return clear(list, h("div", { class: "empty" }, h("div", { class: "big" }, "🔖"), h("strong", null, "Noch nichts gemerkt"), "Tippe in einer Meldung auf „Merken“, um sie hier aufzubewahren. Gemerktes wird nie automatisch gelöscht."));
    clear(list, S.saved.map((s) => storyRow(s)));
  };
  const load = async () => {
    try {
      S.saved = await rpc("feed_ticker", { p_saved: true });
    } catch (e) { toast(e.message); S.saved = S.saved ?? []; }
    if (S.tab === "gemerkt") draw();
  };
  page._reload = load;
  clear(page, h("header", { class: "hero" }, h("h1", null, "Gemerkt"), h("div", { class: "status" }, "Deine aufbewahrten Meldungen.")), list);
  draw();
  load();
}

on("story-closed", () => {
  if (S.tab === "gemerkt") view.querySelector(".tab-page")?._reload?.();
});

// ---------------------------------------------------------------------------
// Ziehen zum Aktualisieren
// ---------------------------------------------------------------------------
function setupPullToRefresh() {
  let startY = 0, dy = 0, tracking = false, busyNow = false;
  const TH = 78;
  window.addEventListener("touchstart", (e) => {
    if (busyNow || sheetCount() > 0 || document.querySelector(".ob") || S.tab === "profil" || window.scrollY > 0) { tracking = false; return; }
    tracking = true; startY = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  window.addEventListener("touchmove", (e) => {
    if (!tracking || !ptr) return;
    dy = e.touches[0].clientY - startY;
    if (dy <= 0 || window.scrollY > 0) { ptr.style.opacity = "0"; return; }
    const pull = Math.min(110, dy * 0.5);
    ptr.style.transition = "none";
    ptr.style.transform = `translateY(${pull - 50}px)`;
    ptr.style.opacity = String(Math.min(1, pull / 50));
    ptr.classList.toggle("ready", pull >= TH * 0.72);
  }, { passive: true });
  const end = async () => {
    if (!tracking || !ptr) return;
    tracking = false;
    const pull = Math.min(110, dy * 0.5);
    ptr.style.transition = "transform .3s var(--ease), opacity .3s";
    if (pull >= TH * 0.72 && window.scrollY <= 0) {
      busyNow = true;
      ptr.classList.add("busy");
      ptr.style.transform = "translateY(14px)";
      try {
        if (S.tab === "heute") await refreshToday(true);
        else await view.querySelector(".tab-page")?._reload?.();
      } finally {
        busyNow = false;
        ptr.classList.remove("busy", "ready");
        ptr.style.transform = "translateY(-70px)";
        ptr.style.opacity = "0";
      }
    } else {
      ptr.style.transform = "translateY(-70px)";
      ptr.style.opacity = "0";
      ptr.classList.remove("ready");
    }
  };
  window.addEventListener("touchend", end);
  window.addEventListener("touchcancel", end);
}

window.addEventListener("hashchange", () => {
  const m = /^#\/story\/(\d+)/.exec(location.hash);
  if (m && S.boot) {
    history.replaceState(null, "", location.pathname + location.search);
    openStory(Number(m[1]));
  }
});

// Unerwartete Fehler nie stumm verschlucken
window.addEventListener("unhandledrejection", (e) => {
  console.error("Unbehandelter Fehler:", e.reason?.message ?? e.reason);
  if (S.boot) toast("Da ist etwas schiefgegangen. Bitte noch einmal versuchen.");
});
window.addEventListener("error", (e) => console.error("Fehler:", e.message));

console.info(`News ${APP_VERSION}`, isIOS ? "iOS" : "", isStandalone() ? "installiert" : "");
start().catch((e) => { console.error(e); showFatal(String(e?.message ?? e)); });

export { setTab };
