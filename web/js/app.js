// Start der App: Anmeldung, Reiter (Heute / Ticker / Gemerkt / Profil), Aktualisieren.
import { ensureSession, fn, forget, remember, rpc, sb, updateSettings } from "./api.js";
import { openAssistant } from "./assistant.js";
import { APP_VERSION } from "./config.js";
import { ago, busy, clear, closeAllSheets, debounce, h, icon, isIOS, isStandalone, longDate, openSheet, secondsAgo, sheetCount, store, toast } from "./lib.js";
import { openInterestCheck, openOnboarding } from "./onboarding.js";
import { renderProfile, openPushSettings, openInstallHelp } from "./profile.js";
import { needsInstallFirst, pushStatus, pushSupported, registerSW, syncPush } from "./push.js";
import { loadBoot, on, S, settings, topics } from "./state.js";
import { leadCard, openStory, skeleton, storyRow } from "./stories.js";

const view = document.getElementById("view");
let tabbar = null, pill = null, ptr = null, fab = null;
let statusTimer = null, pollTimer = null;

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
async function start() {
  registerSW();
  navigator.serviceWorker?.addEventListener("message", (e) => {
    if (e.data?.type === "open") {
      if (e.data.id) openStory(e.data.id);
      else if (S.boot) { setTab("heute"); refreshToday(); }
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
  tabbar?.remove(); pill?.remove(); ptr?.remove(); fab?.remove();
  tabbar = pill = ptr = fab = null;
  clearInterval(statusTimer); clearInterval(pollTimer);
  closeAllSheets();
}

function showShell() {
  destroyShell();
  tabbar = h("nav", { class: "tabbar", "aria-label": "Hauptnavigation" }, h("div", { class: "inner" }, TABS.map((t) =>
    h("button", { type: "button", dataset: { tab: t.id }, onclick: () => { if (S.tab === t.id) window.scrollTo({ top: 0, behavior: "smooth" }); else setTab(t.id); } }, icon(t.icon), t.label))));
  pill = h("button", { class: "pill", type: "button", onclick: () => { hidePill(); setTab("heute"); refreshToday(); window.scrollTo({ top: 0, behavior: "smooth" }); } });
  ptr = h("div", { class: "ptr", "aria-hidden": "true" }, h("span", { class: "arrow" }, "↓"), h("span", { class: "spin" }));
  fab = h("button", { class: "fab", type: "button", "aria-label": "Assistent öffnen", onclick: () => openAssistant() }, "✨");
  document.body.append(tabbar, pill, ptr, fab);
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
  if (S.tab === "heute" && Date.now() - S.todayAt > 60_000) refreshToday();
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
// „Seit deinem letzten Besuch“: Der Zeitpunkt bleibt während eines Besuchs stehen (auch beim Aktualisieren)
// und rückt erst vor, wenn du die App nach einer Pause wieder öffnest oder „Alles gelesen“ antippst.
const VISIT_GAP = 30 * 60_000;
function visitBase(serverLastSeen) {
  const v = store.get("visit", null);
  const now = Date.now();
  if (v && now - v.touched < VISIT_GAP) {
    store.set("visit", { ...v, touched: now });
    return v.base;
  }
  const base = v?.next ?? serverLastSeen ?? null;
  store.set("visit", { base, next: new Date().toISOString(), touched: now });
  return base;
}

function renderToday(page) {
  todayPage = page;
  drawToday();
  if (!S.today || Date.now() - S.todayAt > 45_000) refreshToday();
}

export async function refreshToday() {
  try {
    const base = visitBase(S.boot?.settings?.last_seen_at ?? null);
    const data = await rpc("feed_today", { p_since: base });
    S.today = data;
    S.todayAt = Date.now();
    if (S.boot?.status) S.boot.status.last_tick_at = data.last_tick_at;
    if (S.tab === "heute") drawToday();
    hidePill();
    setBadge((data.new ?? []).filter((x) => !x.read).length);
    // Gibt es noch kein aktuelles Briefing, einmal von selbst eines schreiben lassen
    const age = data.briefing ? Date.now() - new Date(data.briefing.created_at).getTime() : Infinity;
    if (age > 10 * 3600_000 && settings().has_gemini_key && !briefingBusy && !store.get("briefAuto." + new Date().toDateString() + (new Date().getHours() < 14 ? "a" : "b"), false)) {
      store.set("briefAuto." + new Date().toDateString() + (new Date().getHours() < 14 ? "a" : "b"), true);
      makeBriefing();
    }
    setTimeout(() => rpc("mark_seen").catch(() => {}), 2500);
  } catch (e) {
    if (S.tab === "heute" && !S.today) clear(todayPage, header(), h("div", { class: "empty" }, h("div", { class: "big" }, "📡"), h("strong", null, "Konnte nicht laden"), e.message, h("div", { style: { marginTop: "16px" } }, h("button", { class: "btn", onclick: () => refreshToday() }, "Erneut versuchen"))));
    else toast(e.message);
  }
}

function markAllRead() {
  const ids = (S.today?.new ?? []).map((s) => s.id);
  if (ids.length) rpc("mark_read", { p_ids: ids }).catch(() => {});
  const now = new Date().toISOString();
  store.set("visit", { base: now, next: now, touched: Date.now() });
  setBadge(0);
  refreshToday();
  window.scrollTo({ top: 0, behavior: "smooth" });
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

function sinceText(iso) {
  if (!iso) return "";
  const d = new Date(iso), now = new Date();
  const hm = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= start) return `seit ${hm} Uhr`;
  if (d.getTime() >= start - 86400_000) return `seit gestern ${hm} Uhr`;
  return `seit ${d.toLocaleDateString("de-DE", { weekday: "long" })}`;
}

// ---------- Briefing ----------
let briefingBusy = false;
async function makeBriefing(kind = "tag") {
  if (briefingBusy) return;
  if (!settings().has_gemini_key) return toast("Für das Briefing brauchst du die KI-Verbindung (Profil → KI-Einordnung).", { ms: 5000 });
  briefingBusy = true;
  drawToday();
  try {
    const r = await fn("briefing", { kind });
    if (!r.ok) throw new Error(r.error || "Briefing gerade nicht möglich.");
    await refreshToday();
  } catch (e) {
    toast(e.message, { ms: 5000 });
  }
  briefingBusy = false;
  drawToday();
}

function briefingBlock(b) {
  if (briefingBusy) return h("div", { class: "brief" }, h("div", { class: "deep-loading" }, h("span", { class: "spin" }), "Die KI schreibt dein Briefing aus den wichtigsten Meldungen …"));
  if (!b?.data?.abschnitte?.length) {
    return h("div", { class: "brief empty-brief" },
      h("strong", null, "Dein Briefing"),
      h("p", null, "Das Wichtigste aus allen Bereichen, kurz und gegliedert – morgens und abends automatisch, oder jetzt sofort."),
      h("button", { class: "btn small accent", type: "button", onclick: () => makeBriefing() }, "Jetzt schreiben lassen"));
  }
  const d = b.data;
  const when = new Date(b.created_at);
  const open = store.get("briefOpen", true);
  const body = h("div", { class: "brief-body", hidden: !open },
    d.einleitung ? h("p", { class: "brief-lede" }, d.einleitung) : null,
    d.abschnitte.map((a) => h("section", null,
      h("h3", null, a.ueberschrift),
      h("ul", null, a.punkte.map((p) => {
        const li = h("li", p.story_id ? { class: "tap", role: "button", tabindex: "0" } : null, h("strong", null, p.titel + ": "), p.text, p.story_id ? h("span", { class: "more" }, " Mehr ›") : null);
        if (p.story_id) li.addEventListener("click", () => openStory(p.story_id));
        return li;
      })))),
    d.steht_an?.length ? h("section", null, h("h3", null, "📅 Das steht an"), h("ul", null, d.steht_an.map((x) => h("li", null, x)))) : null,
    h("div", { class: "brief-foot" },
      h("span", null, "✨ Von der KI aus den gesammelten Meldungen geschrieben."),
      h("button", { class: "linklike", type: "button", onclick: () => makeBriefing() }, "Neu schreiben"),
      h("button", { class: "linklike", type: "button", onclick: () => makeBriefing("woche") }, "Wochenrückblick")));
  const toggle = h("button", { class: "brief-head", type: "button", "aria-expanded": String(open), onclick: () => {
    const now = body.hidden;
    body.hidden = !now;
    store.set("briefOpen", now);
    toggle.setAttribute("aria-expanded", String(now));
    toggle.querySelector(".chev").textContent = now ? "⌃" : "⌄";
  } },
    h("div", null, h("strong", null, d.titel || "Dein Briefing"), h("small", null, `${when.toLocaleDateString("de-DE", { weekday: "long" })}, ${when.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr`)),
    h("span", { class: "chev" }, open ? "⌃" : "⌄"));
  if (!b.read) rpc("briefing_read", { p_id: b.id }).catch(() => {});
  return h("div", { class: "brief" }, toggle, body);
}

function eventsBlock(events) {
  if (!events?.length) return null;
  const fmt = (iso) => {
    const d = new Date(iso + "T12:00:00");
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const diff = Math.round((d - today) / 86400_000);
    if (diff === 0) return "Heute";
    if (diff === 1) return "Morgen";
    return d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "numeric" });
  };
  return [h("h2", { class: "sec" }, "Das steht an", h("span", { class: "count" }, "nächste 10 Tage")),
    h("div", { class: "events" }, events.map((e) => {
      const el = h(e.story_id ? "button" : "div", { class: "event", type: e.story_id ? "button" : null }, h("b", null, fmt(e.day)), h("span", null, e.title));
      if (e.story_id) el.addEventListener("click", () => openStory(e.story_id));
      return el;
    }))];
}

function setBadge(n) {
  try {
    if (n > 0) navigator.setAppBadge?.(n); else navigator.clearAppBadge?.();
  } catch { /* nicht überall verfügbar */ }
}

function drawToday() {
  if (!todayPage || S.tab !== "heute") return;
  const d = S.today;
  if (!d) {
    clear(todayPage, header(), skeleton(6));
    updateStatusLine();
    return;
  }
  const fresh = collapseSame(d.new ?? []);
  const seen = d.seen ?? [];
  const notes = h("div");
  const out = [header(), notes, briefingBlock(d.briefing), eventsBlock(d.events)];
  if (d.following?.length) {
    out.push(h("h2", { class: "sec" }, "Du bleibst dran", h("span", { class: "count" }, String(d.following.length))));
    out.push(h("div", null, d.following.map((s) => storyRow(s, { compact: true }))));
  }
  if (fresh.length) {
    const top = fresh.filter((s) => s.tier === 3), rest = fresh.filter((s) => s.tier !== 3);
    out.push(h("h2", { class: "sec" }, "Neu für dich", h("span", { class: "count" }, `${fresh.length} · ${sinceText(d.since)}`)));
    if (top.length) out.push(h("div", null, top.map((s) => leadCard(s))));
    if (rest.length) out.push(h("div", null, rest.map((s, i) => (!top.length && i === 0 ? leadCard(s) : storyRow(s)))));
    out.push(h("div", { class: "done" }, h("div", { class: "check" }, "✓"), h("strong", null, "Das war alles Neue"),
      h("span", null, "Jedes Ereignis steht hier nur einmal, weitere Berichte dazu sind zusammengefasst."),
      h("div", { style: { marginTop: "14px" } }, h("button", { class: "btn small primary", onclick: markAllRead }, "Alles gelesen"))));
  } else {
    out.push(h("div", { class: "done", style: { paddingTop: "34px" } }, h("div", { class: "check" }, "✓"), h("strong", null, "Nichts Neues " + sinceText(d.since)),
      h("span", null, topics().length ? "Sobald etwas wirklich Neues zu deinen Themen passiert, steht es hier." : "Lege im Profil Themen an, damit hier etwas erscheint.")));
  }
  if (seen.length) {
    out.push(h("h2", { class: "sec" }, "Schon gesehen", h("span", { class: "count" }, "letzte 36 Stunden")));
    out.push(h("div", null, seen.map((s) => storyRow(s, { compact: true }))));
  }
  out.push(h("div", { style: { textAlign: "center", padding: "22px 0 4px" } }, h("button", { class: "btn small", onclick: () => setTab("ticker") }, "Alle Meldungen im Ticker")));
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
        if (S.tab === "heute") await refreshToday();
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
