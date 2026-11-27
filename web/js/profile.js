// Reiter „Profil“: Interessen, Benachrichtigungen, KI, Quellen, Status.
import { fn, rpc, sb, setSourceEnabled, topicsApi, updateSettings } from "./api.js";
import { CATEGORIES, PRIORITY_LABEL, STOCK_EVENTS, STOCK_EVENTS_DEFAULT, stockKeywords } from "./catalog.js";
import { APP_VERSION } from "./config.js";
import { add, ago, busy, clear, confirmSheet, debounce, h, icon, openSheet, PRIO_OPTIONS, secondsAgo, segmented, switchEl, toast } from "./lib.js";
import { openInterestCheck, rhythmControls, thresholdLabel } from "./onboarding.js";
import { geminiKeyBox, installSteps, ntfyBox, pushBox } from "./parts.js";
import { pushStatus } from "./push.js";
import { loadBoot, on, S, settings, topics } from "./state.js";

let pageEl = null, handlers = {};

export function renderProfile(page, h2) {
  pageEl = page;
  handlers = h2;
  draw();
  loadBoot().catch(() => {});
  loadSuggestions();
}
on("boot", () => { if (S.tab === "profil" && pageEl?.isConnected) draw(); });

let status = null;
async function loadSuggestions() {
  try {
    status = await rpc("system_status");
    if (S.tab === "profil" && pageEl?.isConnected) draw();
  } catch { /* nicht schlimm */ }
}

function row(emoji, title, sub, value, onclick) {
  return h("button", { class: "row", type: "button", onclick }, h("span", { class: "e" }, emoji), h("div", { class: "t" }, h("strong", null, title), sub ? h("small", null, sub) : null), value ? h("span", { class: "v" }, value) : null, h("span", { class: "chev" }, "›"));
}

function draw() {
  const s = settings(), all = topics(), st = S.boot?.status ?? {};
  const pushN = all.filter((t) => t.priority === 3).length;
  const cards = [];
  for (const sug of status?.suggestions ?? []) {
    const el = h("div", { class: "note" }, h("div", { class: "ico" }, "💡"), h("div", { class: "txt" },
      h("strong", null, `„${sug.display}“ als Thema anlegen?`), "Du hast mehrere Meldungen dazu positiv bewertet.",
      h("div", { class: "row" },
        h("button", { class: "btn small accent", onclick: async () => { try { await topicsApi.insert([{ kind: "topic", name: sug.display, emoji: "⭐", keywords: [sug.display], priority: 2, origin: "suggested" }]); el.remove(); await loadBoot(); toast("Thema angelegt."); } catch (e) { toast(e.message); } } }, "Anlegen"),
        h("button", { class: "btn small", onclick: () => { el.remove(); } }, "Nein"))));
    cards.push(el);
  }
  for (const t of status?.stale_topics ?? []) {
    const el = h("div", { class: "note" }, h("div", { class: "ico" }, "🕰️"), h("div", { class: "txt" },
      h("strong", null, `Interessiert dich „${t.name}“ noch?`), "Du hast seit drei Wochen nichts dazu geöffnet.",
      h("div", { class: "row" },
        h("button", { class: "btn small accent", onclick: async () => { try { await topicsApi.update(t.id, { priority: Math.max(1, t.priority - 1) }); el.remove(); await loadBoot(); toast("Heruntergestuft."); } catch (e) { toast(e.message); } } }, "Herunterstufen"),
        h("button", { class: "btn small", onclick: async () => { el.remove(); topicsApi.update(t.id, { last_opened_at: new Date().toISOString() }).catch(() => {}); } }, "Behalten"))));
    cards.push(el);
  }
  const broken = st.sources_broken ?? 0;
  clear(pageEl,
    h("header", { class: "hero" }, h("h1", null, "Profil"), h("div", { class: "status" }, `${all.length} Themen · ${pushN} davon mit Sofort-Push`)),
    cards,
    h("div", { class: "group-title" }, "Interessen"),
    h("div", { class: "group" },
      row("⭐", "Themen & Aktien", "Was du verfolgst und wie wichtig es ist", String(all.length), openTopics),
      row("🧭", "Bereiche & Sprachen", "Welche allgemeinen Quellen mitlaufen", null, openAreas),
      row("🙈", "Nicht anzeigen", "Begriffe, die du nie sehen willst", s.muted?.length ? String(s.muted.length) : null, openMuted),
      row("🎯", "Interessen-Check", "10 Schlagzeilen bewerten, 1 Minute", null, () => openInterestCheck(10)),
      row("🔁", "Alles neu einstellen", "Den Einrichtungsablauf noch einmal durchgehen", null, () => handlers.onRestartOnboarding?.())),
    h("div", { class: "group-title" }, "Benachrichtigungen"),
    h("div", { class: "group" },
      row("🔔", "Push", "Geräte, Empfindlichkeit, ntfy", s.push_enabled ? "An" : "Aus", () => openPushSettings()),
      row("🌙", "Ruhezeit & Digest", s.quiet_enabled ? `Ruhe ${s.quiet_start}–${s.quiet_end}` : "Keine Ruhezeit", null, openRhythm),
      row("📉", "Kursalarm", "Bei plötzlichen Kursbewegungen deiner Aktien", s.price_alerts ? `ab ${String(s.price_move_pct).replace(".", ",")} %` : "Aus", openPrices),
      row("📜", "Push-Verlauf", "Was gesendet wurde und warum", null, openPushLog)),
    h("div", { class: "group-title" }, "Technik"),
    h("div", { class: "group" },
      row("✨", "KI-Einordnung", s.has_gemini_key ? `Verbunden · heute ${st.llm_calls_today ?? 0} Anfragen` : "Nicht verbunden – die App arbeitet mit festen Regeln", s.has_gemini_key ? null : "Einrichten", openAi),
      row("📡", "Quellen", `${st.sources_total ?? 0} aktiv` + (broken ? ` · ${broken} gestört` : ""), null, openSources),
      row("🩺", "Status", st.last_tick_at ? `Letzter Abruf ${secondsAgo(st.last_tick_at)}` : "Noch kein Abruf", null, openSystem)),
    h("div", { class: "group", style: { marginTop: "26px" } },
      h("button", { class: "row", type: "button", onclick: async () => { if (await confirmSheet({ title: "Abmelden?", text: "Du kannst dich jederzeit mit E-Mail und Passwort wieder anmelden. Push auf diesem Gerät bleibt aktiv.", yes: "Abmelden" })) handlers.onLogout?.(); } },
        h("span", { class: "e" }, "🚪"), h("div", { class: "t" }, h("strong", null, "Abmelden")))),
    h("p", { class: "help", style: { textAlign: "center", marginTop: "18px" } }, `News ${APP_VERSION}`));
}

// ---------------------------------------------------------------------------
// Themen & Aktien
// ---------------------------------------------------------------------------
function openTopics() {
  openSheet({
    title: "Themen & Aktien",
    render: (body, api) => {
      const list = h("div");
      const drawList = () => {
        const all = topics();
        const stocks = all.filter((t) => t.kind === "stock"), rest = all.filter((t) => t.kind !== "stock");
        const item = (t) => h("button", { class: "row", type: "button", onclick: () => openTopicEditor(t, drawList) },
          h("span", { class: "e" }, t.emoji || (t.kind === "stock" ? "📈" : "⭐")),
          h("div", { class: "t" }, h("strong", null, t.name), h("small", null, (t.ticker ? t.ticker + " · " : "") + (t.keywords ?? []).slice(0, 4).join(", "))),
          h("span", { class: "badge " + (t.priority === 3 ? "hot" : t.priority === 0 ? "soft" : t.priority === 2 ? "accent" : "soft") }, PRIORITY_LABEL[t.priority]),
          h("span", { class: "chev" }, "›"));
        clear(list,
          stocks.length ? [h("div", { class: "group-title", style: { marginTop: "8px" } }, "Aktien"), h("div", { class: "group" }, stocks.map(item))] : null,
          rest.length ? [h("div", { class: "group-title" }, "Themen"), h("div", { class: "group" }, rest.map(item))] : null,
          !all.length ? h("div", { class: "empty" }, h("div", { class: "big" }, "⭐"), h("strong", null, "Noch keine Themen"), "Lege unten dein erstes Thema an.") : null);
      };
      drawList();
      add(body, list);
      api.setFoot(h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" } },
        h("button", { class: "btn primary", type: "button", onclick: () => openTopicEditor({ kind: "topic", name: "", emoji: "⭐", keywords: [], exclude: [], priority: 2, events: [] }, drawList) }, "+ Thema"),
        h("button", { class: "btn", type: "button", onclick: () => openStockSearch(drawList) }, "+ Aktie")));
    },
  });
}

function chipEditor(values, { placeholder, onChange }) {
  const wrap = h("div");
  const chips = h("div", { class: "chips", style: { marginBottom: "8px" } });
  const input = h("input", { class: "input", placeholder, enterkeyhint: "done", autocapitalize: "none", maxlength: 40 });
  const draw = () => clear(chips, values.map((v) => h("button", { type: "button", class: "chip small on", onclick: () => { values.splice(values.indexOf(v), 1); draw(); onChange?.(); } }, v, h("span", { class: "rm" }, "×"))));
  const add = () => {
    const parts = input.value.split(",").map((x) => x.trim()).filter((x) => x.length >= 2);
    for (const p of parts) if (!values.some((v) => v.toLowerCase() === p.toLowerCase())) values.push(p);
    input.value = "";
    draw(); onChange?.();
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  input.addEventListener("blur", () => { if (input.value.trim()) add(); });
  draw();
  wrap.append(chips, input);
  wrap._flush = () => { if (input.value.trim()) add(); };
  return wrap;
}

function openTopicEditor(topic, onSaved) {
  const isNew = !topic.id;
  const t = { ...topic, keywords: [...(topic.keywords ?? [])], exclude: [...(topic.exclude ?? [])], events: [...(topic.events ?? [])] };
  openSheet({
    title: isNew ? "Neues Thema" : topic.name,
    render: (body, api) => {
      const name = h("input", { class: "input", value: t.name, placeholder: "Name", maxlength: 40 });
      const emoji = h("input", { class: "input", value: t.emoji ?? "", placeholder: "⭐", maxlength: 4, style: { width: "72px", textAlign: "center" } });
      const kw = chipEditor(t.keywords, { placeholder: "Suchbegriff hinzufügen" });
      const ex = chipEditor(t.exclude, { placeholder: "Begriff ausschließen" });
      const ticker = h("input", { class: "input mono", value: t.ticker ?? "", placeholder: "z. B. NVDA", autocapitalize: "characters", maxlength: 14 });
      const ev = h("div", { class: "chips" });
      const drawEv = () => clear(ev, STOCK_EVENTS.map((e) => h("button", { type: "button", class: "chip small" + (t.events.includes(e.id) ? " on" : ""), onclick: () => { t.events = t.events.includes(e.id) ? t.events.filter((x) => x !== e.id) : [...t.events, e.id]; drawEv(); } }, `${e.emoji} ${e.name}`)));
      drawEv();
      add(body, 
        h("div", { style: { display: "flex", gap: "10px" } }, h("label", { class: "field", style: { flex: "1" } }, h("span", null, "Name"), name), h("label", { class: "field" }, h("span", null, "Symbol"), emoji)),
        h("div", { class: "field" }, h("span", null, "Wichtigkeit"), segmented([...PRIO_OPTIONS, { value: 0, label: "Aus" }], t.priority, (v) => (t.priority = v), "block"),
          h("p", { class: "help" }, "Push: sofort aufs Handy. Wichtig: oben in der App und im Digest. App: nur beim Öffnen. Aus: Meldungen dazu werden ausgeblendet.")),
        h("div", { class: "field" }, h("span", null, "Suchbegriffe"), kw,
          h("p", { class: "help" }, "Eine Meldung passt, wenn einer dieser Begriffe in der Schlagzeile vorkommt. Mehrere mit Komma trennen. Kurze Wörter in Großbuchstaben (z. B. KI, AMD) werden exakt gesucht.")),
        t.kind === "stock" ? [
          h("label", { class: "field" }, h("span", null, "Börsenkürzel (für Kursalarm und Finanznachrichten)"), ticker),
          h("div", { class: "field" }, h("span", null, "Push nur bei diesen Ereignissen"), ev, h("p", { class: "help" }, "Nichts ausgewählt = bei allen wichtigen Ereignissen.")),
        ] : null,
        h("div", { class: "field" }, h("span", null, "Ausschließen (optional)"), ex, h("p", { class: "help" }, "Kommt einer dieser Begriffe vor, zählt die Meldung nicht zu diesem Thema.")),
        !isNew ? h("div", { style: { marginTop: "22px" } }, h("button", { class: "btn danger block", type: "button", onclick: async () => {
          if (!(await confirmSheet({ title: `„${topic.name}“ löschen?`, text: "Das Thema und seine Suchquellen werden entfernt. Bereits geladene Meldungen bleiben im Ticker.", yes: "Löschen", danger: true }))) return;
          try { await topicsApi.remove(topic.id); await loadBoot(); onSaved?.(); api.close(); toast("Gelöscht."); } catch (e) { toast(e.message); }
        } }, "Thema löschen")) : null);
      const saveBtn = h("button", { class: "btn primary block", type: "button", onclick: async () => {
        kw._flush(); ex._flush();
        const nm = name.value.trim();
        if (nm.length < 2) return toast("Bitte gib einen Namen ein.");
        if (!t.keywords.length) t.keywords.push(nm);
        const patch = { kind: t.kind, name: nm, emoji: emoji.value.trim() || (t.kind === "stock" ? "📈" : "⭐"), keywords: t.keywords, exclude: t.exclude, priority: t.priority, events: t.kind === "stock" ? t.events : [], ticker: t.kind === "stock" ? (ticker.value.trim().toUpperCase() || null) : null };
        busy(saveBtn, true);
        try {
          if (isNew) await topicsApi.insert([{ ...patch, origin: "manual", category: t.category ?? null }]);
          else await topicsApi.update(topic.id, patch);
          await loadBoot();
          fn("rescore").catch(() => {});
          onSaved?.();
          api.close();
          toast("Gespeichert.");
        } catch (e) { toast(/duplicate|unique/i.test(e.message) ? "Dieses Kürzel wird schon von einer anderen Aktie verwendet." : e.message); busy(saveBtn, false); }
      } }, "Speichern");
      api.setFoot(saveBtn);
      if (isNew) setTimeout(() => name.focus(), 350);
    },
  });
}

function openStockSearch(onSaved) {
  openSheet({
    title: "Aktie hinzufügen",
    render: (body, api) => {
      const results = h("div");
      const input = h("input", { class: "input", type: "search", placeholder: "Name oder Kürzel, z. B. Nvidia", autocapitalize: "none", enterkeyhint: "search" });
      const have = () => new Set(topics().filter((t) => t.kind === "stock").map((t) => (t.ticker ?? "").toUpperCase()));
      const addStock = async (symbol, name) => {
        const clean = name.replace(/\s+(Inc|Corp|Corporation|AG|SE|plc|N\.V\.|Ltd)\.?,?$/i, "").replace(/,\s*$/, "").trim().slice(0, 40);
        try {
          await topicsApi.insert([{ kind: "stock", name: clean, emoji: "📈", category: "boerse", keywords: stockKeywords(clean, symbol), ticker: symbol || null, events: STOCK_EVENTS_DEFAULT, priority: 3, origin: "manual" }]);
          await loadBoot();
          fn("rescore").catch(() => {});
          onSaved?.();
          api.close();
          toast(`${clean} hinzugefügt.`);
        } catch (e) { toast(/duplicate|unique/i.test(e.message) ? "Diese Aktie hast du schon." : e.message); }
      };
      const run = debounce(async () => {
        const q = input.value.trim();
        if (q.length < 2) return clear(results);
        clear(results, h("p", { class: "help" }, "Suche …"));
        try {
          const r = await fn("stock_search", { q });
          if (input.value.trim() !== q) return;
          const h2 = have();
          clear(results, h("div", { class: "group" },
            (r.results ?? []).map((x) => h("button", { class: "row", type: "button", disabled: h2.has(x.symbol.toUpperCase()), onclick: () => addStock(x.symbol, x.name) },
              h("div", { class: "t" }, h("strong", null, x.name), h("small", null, `${x.symbol} · ${x.exchange}`)), h("span", { class: "chev" }, h2.has(x.symbol.toUpperCase()) ? "✓" : "+"))),
            h("button", { class: "row", type: "button", onclick: () => addStock("", q) }, h("div", { class: "t" }, h("strong", null, `„${q}“ ohne Kürzel hinzufügen`), h("small", null, r.error ?? "Nachrichten werden dann nur über den Namen gesucht, ohne Kursalarm.")), h("span", { class: "chev" }, "+"))));
        } catch (e) { clear(results, h("p", { class: "help" }, e.message)); }
      }, 350);
      input.addEventListener("input", run);
      add(body, h("div", { class: "search", style: { marginTop: "0" } }, icon("search"), input), results);
      setTimeout(() => input.focus(), 350);
    },
  });
}

// ---------------------------------------------------------------------------
// Bereiche & Sprachen
// ---------------------------------------------------------------------------
function openAreas() {
  openSheet({
    title: "Bereiche & Sprachen",
    render: (body) => {
      const cats = new Set(settings().categories ?? []);
      const langs = new Set(settings().languages ?? ["de"]);
      const grid = h("div", { class: "bigchips" });
      const more = h("div");
      const langChips = h("div", { class: "chips" });
      const saveCats = debounce(async () => { try { await rpc("set_categories", { p_categories: [...cats] }); await loadBoot(); } catch (e) { toast(e.message); } }, 500);
      const drawLang = () => clear(langChips, [["de", "Deutsch"], ["en", "Englisch"]].map(([id, label]) => h("button", { type: "button", class: "chip" + (langs.has(id) ? " on" : ""), onclick: async () => {
        if (langs.has(id) && langs.size === 1) return toast("Mindestens eine Sprache muss bleiben.");
        langs.has(id) ? langs.delete(id) : langs.add(id);
        drawLang();
        try { await updateSettings({ languages: [...langs] }); await loadBoot(); } catch (e) { toast(e.message); }
      } }, label)));
      const drawMore = () => {
        const have = new Set(topics().map((t) => t.catalog_id).filter(Boolean));
        const blocks = [];
        for (const c of CATEGORIES) {
          if (!cats.has(c.id)) continue;
          const missing = c.topics.filter((t) => !have.has(t.id));
          if (!missing.length) continue;
          blocks.push(h("h4", { style: { margin: "18px 0 8px", fontSize: "14px", color: "var(--text-2)" } }, `${c.emoji} ${c.name}`),
            h("div", { class: "chips" }, missing.map((t) => h("button", { type: "button", class: "chip small", onclick: async (e) => {
              e.currentTarget.disabled = true;
              try {
                await topicsApi.upsertCatalog([{ catalog_id: t.id, kind: "topic", name: t.name, emoji: t.emoji, category: c.id, keywords: t.kw, exclude: [], events: [], priority: Math.min(t.p, 2), active: true, origin: "manual" }]);
                await loadBoot(); drawMore(); toast(`„${t.name}“ hinzugefügt.`);
              } catch (err) { toast(err.message); }
            } }, `+ ${t.emoji} ${t.name}`))));
        }
        clear(more, blocks.length ? [h("div", { class: "group-title" }, "Passende Themen hinzufügen"), blocks] : null);
      };
      const drawGrid = () => clear(grid, CATEGORIES.map((c) => h("button", { type: "button", class: "bigchip" + (cats.has(c.id) ? " on" : ""), onclick: () => { cats.has(c.id) ? cats.delete(c.id) : cats.add(c.id); drawGrid(); drawMore(); saveCats(); } }, h("span", { class: "e" }, c.emoji), c.name)));
      drawLang(); drawGrid(); drawMore();
      add(body, h("div", { class: "group-title", style: { marginTop: "6px" } }, "Sprachen"), h("div", { style: { marginTop: "10px" } }, langChips),
        h("div", { class: "group-title" }, "Bereiche"), h("p", { class: "help", style: { margin: "6px 0 12px" } }, "Für jeden gewählten Bereich laufen passende Nachrichtenseiten mit. So findest du auch Meldungen, die zu keinem deiner Themen gehören."), grid, more);
    },
  });
}

function openMuted() {
  openSheet({
    title: "Nicht anzeigen", auto: true,
    render: (body) => {
      const values = [...(settings().muted ?? [])];
      const ed = chipEditor(values, { placeholder: "Begriff, z. B. Dschungelcamp", onChange: debounce(async () => {
        try { await updateSettings({ muted: values }); await loadBoot(); fn("rescore").catch(() => {}); } catch (e) { toast(e.message); }
      }, 400) });
      add(body, h("p", { class: "help", style: { margin: "0 0 14px" } }, "Meldungen, deren Schlagzeile oder Kurztext einen dieser Begriffe enthält, werden ausgeblendet."), ed, h("div", { style: { height: "20px" } }));
    },
  });
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------
export function openPushSettings() {
  openSheet({
    title: "Push",
    render: (body) => {
      const rest = h("div");
      const drawRest = () => {
        const s = settings();
        const slider = (label, key, min = 50) => {
          const val = h("small", null, thresholdLabel(s[key]));
          const inp = h("input", { type: "range", min: String(min), max: "95", step: "1", value: String(s[key]), "aria-label": label });
          inp.addEventListener("input", () => (val.textContent = thresholdLabel(Number(inp.value))));
          inp.addEventListener("change", async () => { try { await updateSettings({ [key]: Number(inp.value) }); S.boot.settings[key] = Number(inp.value); fn("rescore").catch(() => {}); } catch (e) { toast(e.message); } });
          return h("div", { class: "row col" }, h("div", { class: "t" }, h("strong", null, label), val), inp, h("div", { class: "range-labels" }, h("span", null, "mehr Pushes"), h("span", null, "weniger Pushes")));
        };
        clear(rest,
          h("div", { class: "group-title" }, "Allgemein"),
          h("div", { class: "group" },
            h("div", { class: "row" }, h("div", { class: "t" }, h("strong", null, "Push-Nachrichten senden"), h("small", null, "Hauptschalter für alle Geräte.")), switchEl(s.push_enabled, async (v) => { try { await updateSettings({ push_enabled: v }); await loadBoot(); drawRest(); } catch (e) { toast(e.message); } })),
            h("div", { class: "row" }, h("div", { class: "t" }, h("strong", null, "Auch große Weltereignisse"), h("small", null, "Push bei sehr wichtigen Nachrichten, die zu keinem deiner Themen gehören.")), switchEl(s.world_push, async (v) => { try { await updateSettings({ world_push: v }); await loadBoot(); } catch (e) { toast(e.message); } }))),
          h("div", { class: "group-title" }, "Wie schnell soll ein Push kommen?"),
          h("div", { class: "group" }, slider("📈 Deine Aktien", "thr_stocks"), slider("⭐ Deine Push-Themen", "thr_topics"), slider("🌍 Weltgeschehen", "thr_world", 75)),
          h("p", { class: "help" }, "Meinungen, Analystenstimmen und Gerüchte lösen nie einen Push aus. Pro Thema kommt höchstens ein Push in zwei Stunden und insgesamt höchstens drei pro Stunde – außer bei sehr wichtigen Ereignissen. Die App passt die Regler behutsam an, wenn du Pushes mit 👎 oder Meldungen mit 🔥 bewertest."),
          h("div", { class: "group-title" }, "Zweiter Zustellweg"), ntfyBox());
      };
      add(body, h("div", { class: "group-title", style: { marginTop: "6px" } }, "Dieses Gerät"), h("div", { style: { marginTop: "10px" } }, pushBox({ onChange: () => {} })), rest);
      drawRest();
    },
  });
}

export function openInstallHelp() {
  openSheet({ title: "Als App installieren", auto: true, render: (body) => { add(body, installSteps(), h("div", { style: { height: "12px" } })); } });
}

function openRhythm() {
  openSheet({ title: "Ruhezeit & Digest", render: (body) => { add(body, rhythmControls()); }, onClose: () => loadBoot().catch(() => {}) });
}

function openPrices() {
  openSheet({
    title: "Kursalarm",
    render: async (body) => {
      const root = h("div");
      add(body, root);
      let prices = [];
      const draw = () => {
        const s = settings();
        const pctB = h("b", null, String(s.price_move_pct).replace(".", ",") + " %");
        const step = async (d) => { const v = Math.max(1, Math.min(15, Math.round((Number(S.boot.settings.price_move_pct) + d) * 2) / 2)); S.boot.settings.price_move_pct = v; pctB.textContent = String(v).replace(".", ",") + " %"; try { await updateSettings({ price_move_pct: v }); } catch (e) { toast(e.message); } };
        clear(root,
          h("div", { class: "group" },
            h("div", { class: "row" }, h("span", { class: "e" }, "📉"), h("div", { class: "t" }, h("strong", null, "Kursalarm"), h("small", null, "Meldet plötzliche Bewegungen deiner Aktien – oft schneller als jede Nachricht.")), switchEl(s.price_alerts, async (v) => { try { await updateSettings({ price_alerts: v }); await loadBoot(); draw(); } catch (e) { toast(e.message); } })),
            s.price_alerts ? h("div", { class: "row" }, h("div", { class: "t" }, h("strong", null, "Auslösen ab"), h("small", null, "Bewegung innerhalb des Zeitfensters")), h("div", { class: "stepper" }, h("button", { type: "button", onclick: () => step(-0.5) }, "−"), pctB, h("button", { type: "button", onclick: () => step(0.5) }, "+"))) : null,
            s.price_alerts ? h("div", { class: "row col" }, h("div", { class: "t" }, h("strong", null, "Zeitfenster")), segmented([5, 10, 15, 30].map((m) => ({ value: m, label: `${m} Min` })), s.price_window_min, async (v) => { try { await updateSettings({ price_window_min: v }); S.boot.settings.price_window_min = v; } catch (e) { toast(e.message); } }, "block")) : null),
          h("p", { class: "help" }, "Gilt für Aktien mit Börsenkürzel und der Wichtigkeit „Push“ (Alarm aufs Handy) oder „Wichtig“ (nur in der App). Zusätzlich gibt es einen Hinweis, wenn eine Aktie am Tag doppelt so stark schwankt. Kursdaten stammen von Yahoo Finance, können verzögert sein und sind ohne Gewähr – keine Anlageberatung."),
          prices.length ? [h("div", { class: "group-title" }, "Beobachtet"), h("div", { class: "group" }, prices.map((p) => {
            const chg = p.price && p.prev_close ? (p.price / p.prev_close - 1) * 100 : null;
            return h("div", { class: "row" }, h("div", { class: "t" }, h("strong", null, p.ticker), h("small", null, p.error ? "Keine Daten: " + p.error : p.updated_at ? `Stand ${ago(p.updated_at)}` : "noch kein Kurs")),
              p.price ? h("span", { class: "v" }, Number(p.price).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + (p.currency ?? "")) : null,
              chg != null ? h("span", { class: "badge " + (chg < 0 ? "hot" : "ok") }, (chg < 0 ? "−" : "+") + Math.abs(chg).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " %") : null);
          }))] : null);
      };
      draw();
      try {
        const { data } = await sb.from("price_state").select("ticker,price,prev_close,currency,updated_at,error").order("ticker");
        prices = data ?? [];
        draw();
      } catch { /* egal */ }
    },
  });
}

function openPushLog() {
  openSheet({
    title: "Push-Verlauf",
    render: async (body) => {
      clear(body, h("div", { class: "center" }, h("span", { class: "spin" })));
      const st = await rpc("system_status");
      status = st;
      if (!st.pushes.length) return clear(body, h("div", { class: "empty" }, h("div", { class: "big" }, "🔕"), h("strong", null, "Noch kein Push gesendet"), "Sobald etwas Wichtiges passiert, steht es hier – mit Begründung."));
      const { openStory } = await import("./stories.js");
      clear(body, h("div", { class: "group", style: { marginTop: "4px" } }, st.pushes.map((p) => h("button", { class: "row", type: "button", disabled: !p.story_id, onclick: () => p.story_id && openStory(p.story_id) },
        h("span", { class: "e" }, p.kind === "price" ? "📉" : p.kind === "digest" ? "🗞️" : p.kind === "test" ? "🧪" : "🔔"),
        h("div", { class: "t" }, h("strong", { style: { whiteSpace: "normal" } }, p.title), h("small", null, p.body), h("small", { style: { color: "var(--text-3)", marginTop: "3px" } }, `${ago(p.sent_at)} · ${p.reason ?? ""}` + (p.web_ok + (p.ntfy_ok ? 1 : 0) === 0 ? " · nicht zugestellt" : ""))),
        p.story_id ? h("span", { class: "chev" }, "›") : null))));
    },
  });
}

// ---------------------------------------------------------------------------
// KI, Quellen, Status
// ---------------------------------------------------------------------------
function openAi() {
  openSheet({
    title: "KI-Einordnung",
    render: (body) => {
      const ta = h("textarea", { class: "input", placeholder: "Beschreibe in eigenen Worten, was dich interessiert und was nicht.", value: settings().profile_text ?? "" });
      const saveBtn = h("button", { class: "btn small", type: "button", onclick: async () => { busy(saveBtn, true); try { await updateSettings({ profile_text: ta.value.trim().slice(0, 2000) }); await loadBoot(); toast("Gespeichert."); } catch (e) { toast(e.message); } busy(saveBtn, false); } }, "Beschreibung speichern");
      add(body, 
        h("p", { class: "help", style: { margin: "0 0 14px" } }, "Mit einem kostenlosen Schlüssel von Google (Gemini) ordnet eine KI jede wichtige Meldung ein: Wie groß ist das Ereignis, wie sehr betrifft es dich? Sie schreibt außerdem eine kurze deutsche Zusammenfassung."),
        geminiKeyBox(),
        h("div", { class: "group-title" }, "Über dich"),
        h("p", { class: "help", style: { margin: "6px 0 10px" } }, "Diese Beschreibung bekommt die KI als Hintergrund, um besser einzuschätzen, was für dich zählt."),
        ta, h("div", { style: { marginTop: "10px" } }, saveBtn));
    },
  });
}

function openSources() {
  openSheet({
    title: "Quellen",
    render: async (body) => {
      clear(body, h("div", { class: "center" }, h("span", { class: "spin" })));
      const st = await rpc("system_status");
      status = st;
      const catName = (id) => (id === "top" ? "Allgemein" : CATEGORIES.find((c) => c.id === id)?.name ?? "Sonstige");
      const stateText = (s) => {
        if (!s.enabled) return "aus";
        if (s.broken) return "dauerhaft gestört – wird nicht mehr abgerufen";
        if (s.fail_count >= 3) return `gestört (${s.last_error ?? "Fehler"})`;
        if (!s.last_ok_at) return "noch nicht abgerufen";
        return `ok · geprüft ${secondsAgo(s.last_ok_at)}` + (s.last_new_at ? ` · neu ${ago(s.last_new_at)}` : "");
      };
      const item = (s) => h("div", { class: "row" }, h("span", { class: "dot " + (!s.enabled ? "" : s.broken || s.fail_count >= 3 ? "hot" : s.last_ok_at ? "live" : "warn"), style: { animation: "none" } }),
        h("div", { class: "t" }, h("strong", null, s.name), h("small", null, `${s.lang.toUpperCase()} · alle ${s.interval < 120 ? s.interval + " Sek." : Math.round(s.interval / 60) + " Min"} · ${stateText(s)}`)),
        s.topic ? null : switchEl(s.enabled, async (v) => { try { await setSourceEnabled(s.id, v); s.enabled = v; } catch (e) { toast(e.message); } }));
      const fixed = st.sources.filter((s) => !s.topic), topicSrc = st.sources.filter((s) => s.topic);
      const active = new Set(settings().categories ?? []);
      const groups = new Map();
      for (const s of fixed) {
        if (!s.enabled && !s.core && !active.has(s.category)) continue;
        const k = s.core ? "top" : s.category;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(s);
      }
      const sec = h("input", { class: "input", type: "email", placeholder: "kontakt@beispiel.de", value: settings().sec_contact ?? "", autocapitalize: "none" });
      const secBtn = h("button", { class: "btn small", type: "button", onclick: async () => {
        const v = sec.value.trim();
        if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return toast("Bitte eine gültige E-Mail-Adresse eingeben.");
        busy(secBtn, true);
        try { await updateSettings({ sec_contact: v }); await loadBoot(); toast(v ? "Gespeichert – Pflichtmeldungen werden abgerufen." : "Abruf der Pflichtmeldungen ist aus."); } catch (e) { toast(e.message); }
        busy(secBtn, false);
      } }, "Speichern");
      clear(body,
        h("p", { class: "help", style: { margin: "0 0 4px" } }, "Grün = läuft. Rot = die Quelle antwortet gerade nicht; die App versucht es später wieder."),
        topicSrc.length ? [h("div", { class: "group-title" }, `Suchen zu deinen Themen (${topicSrc.length})`), h("div", { class: "group" }, topicSrc.map(item))] : null,
        [...groups.entries()].map(([k, arr]) => [h("div", { class: "group-title" }, catName(k)), h("div", { class: "group" }, arr.map(item))]),
        h("div", { class: "group-title" }, "US-Pflichtmeldungen (für Aktien)"),
        h("p", { class: "help", style: { margin: "6px 0 10px" } }, "US-Unternehmen müssen wichtige Ereignisse wie einen Chefwechsel sofort der Börsenaufsicht SEC melden – oft die allererste Quelle. Die SEC verlangt beim Abruf eine Kontakt-E-Mail. Wenn du hier eine einträgst, wird sie bei jedem Abruf an die SEC übermittelt. Leer lassen = aus."),
        h("div", { style: { display: "flex", gap: "8px" } }, sec, secBtn),
        h("div", { style: { height: "10px" } }));
    },
  });
}

function openSystem() {
  openSheet({
    title: "Status",
    render: async (body) => {
      clear(body, h("div", { class: "center" }, h("span", { class: "spin" })));
      const [st, ps] = await Promise.all([rpc("system_status"), pushStatus()]);
      status = st;
      const info = st.last_tick_info ?? {};
      const kv = (a, b) => h("div", { class: "kv" }, h("span", null, a), h("span", null, b));
      const age = st.last_tick_at ? (Date.now() - new Date(st.last_tick_at).getTime()) / 1000 : Infinity;
      clear(body,
        h("div", { class: "note", style: { marginTop: "4px" } }, h("div", { class: "ico" }, age < 120 ? "✅" : "⚠️"), h("div", { class: "txt" },
          h("strong", null, age < 120 ? "Alles läuft" : "Der Abruf steht gerade"),
          age < 120 ? "Die App prüft etwa alle 15 Sekunden auf neue Meldungen." : "Seit mehr als zwei Minuten wurde nichts abgerufen. Meist erledigt sich das von selbst; sonst sag Claude Bescheid.")),
        h("div", { class: "group-title" }, "Abruf"),
        h("div", { class: "group", style: { padding: "4px 15px" } },
          kv("Letzter Abruf", secondsAgo(st.last_tick_at)),
          kv("Dauer", st.last_tick_ms != null ? `${st.last_tick_ms} ms` : "–"),
          kv("Quellen im letzten Lauf", `${info.sources ?? 0}` + (info.failed ? ` (${info.failed} gestört)` : "")),
          kv("Meldungen in 24 Std.", String(st.counts.stories_24h)),
          kv("Gespeicherte Meldungen", String(st.counts.stories)),
          kv("Deine Bewertungen", String(st.counts.feedback)),
          info.error ? kv("Letzter Fehler", info.error) : null),
        h("div", { class: "group-title" }, "Push"),
        h("div", { class: "group", style: { padding: "4px 15px" } },
          kv("Dieses Gerät", !ps.supported ? "nicht unterstützt" : ps.subscribed ? "angemeldet" : ps.permission === "denied" ? "blockiert" : "nicht angemeldet"),
          kv("Angemeldete Geräte", String(st.devices.length)),
          kv("Pushes heute", String(S.boot?.pushes_today ?? 0))),
        h("div", { class: "group-title" }, "KI"),
        h("div", { class: "group", style: { padding: "4px 15px" } },
          kv("Schlüssel", settings().has_gemini_key ? "hinterlegt" : "keiner"),
          kv("Anfragen heute", String(st.llm.calls_today)),
          kv("Letzte erfolgreiche Anfrage", st.llm.last_ok_at ? ago(st.llm.last_ok_at) : "–"),
          st.llm.last_error ? kv("Hinweis", st.llm.last_error) : null),
        h("div", { style: { marginTop: "18px", display: "grid", gap: "10px" } },
          h("button", { class: "btn block", type: "button", onclick: () => location.reload() }, "App neu laden"),
          h("p", { class: "help", style: { textAlign: "center" } }, `News ${APP_VERSION}`)));
    },
  });
}
