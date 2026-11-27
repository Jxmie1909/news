// Einrichtung in zehn Schritten: von groben Bereichen über Unterthemen und Aktien bis zum Test mit echten Schlagzeilen.
import { fn, rpc, topicsApi, updateSettings } from "./api.js";
import { calibrationExamples, CATEGORIES, POPULAR_STOCKS, STOCK_EVENTS, STOCK_EVENTS_DEFAULT, stockKeywords, thresholdFromAnswers } from "./catalog.js";
import { add, busy, clear, debounce, h, icon, openSheet, PRIO_OPTIONS, segmented, switchEl, toast } from "./lib.js";
import { geminiKeyBox, ntfyBox, pushBox } from "./parts.js";
import { loadBoot, S, settings, topics } from "./state.js";

const STEPS = ["start", "bereiche", "themen", "aktien", "wichtigkeit", "test", "grenze", "rhythmus", "freitext", "fertig"];

export function thresholdLabel(v) {
  if (v <= 55) return "ab Ankündigungen";
  if (v <= 70) return "nur bestätigte, wichtige Nachrichten";
  return "nur ganz große Ereignisse";
}

export function openOnboarding({ onDone, restart = false } = {}) {
  document.querySelector(".ob")?.remove();
  const st = {
    step: 0,
    langs: new Set(settings().languages ?? ["de", "en"]),
    cats: new Set(),
    sel: new Map(),      // catalog_id → Wichtigkeit
    custom: [],          // { name, cat, p, kw }
    stocks: [],          // { symbol, name, events, p }
    saved: false,
    answers: [],
    thr: null,
  };
  // Bei erneutem Durchlauf: vorhandenes Profil übernehmen
  if (restart) {
    for (const c of settings().categories ?? []) st.cats.add(c);
    for (const t of topics()) {
      if (t.kind === "stock") st.stocks.push({ id: t.id, symbol: t.ticker ?? "", name: t.name, events: t.events?.length ? [...t.events] : [...STOCK_EVENTS_DEFAULT], p: t.priority || 2, kw: t.keywords });
      else if (t.catalog_id) st.sel.set(t.catalog_id, t.priority || 1);
      else st.custom.push({ id: t.id, name: t.name, cat: t.category, p: t.priority || 2, kw: t.keywords, emoji: t.emoji });
    }
  }

  const bar = h("i", { style: { width: "0%" } });
  const back = h("button", { class: "back", type: "button", "aria-label": "Zurück", onclick: () => go(st.step - 1) }, "‹");
  const skip = h("button", { class: "skip", type: "button", hidden: true });
  const body = h("div", { class: "ob-body" });
  const footInner = h("div");
  const root = h("div", { class: "ob", role: "dialog", "aria-label": "Einrichtung" },
    h("div", { class: "ob-top" }, back, h("div", { class: "ob-bar" }, bar), skip),
    body, h("div", { class: "ob-foot" }, footInner));
  document.body.append(root);
  document.body.classList.add("locked");

  const finish = async () => {
    root.remove();
    document.body.classList.remove("locked");
    await onDone?.();
  };

  function setFoot(...nodes) { clear(footInner, ...nodes); }
  function nextBtn(label = "Weiter", fnc = () => go(st.step + 1), cls = "primary") {
    return h("button", { class: `btn ${cls} block`, type: "button", onclick: fnc }, label);
  }
  function setSkip(label, fnc) {
    skip.hidden = !label;
    skip.textContent = label ?? "";
    skip.onclick = fnc ?? null;
  }

  async function go(n) {
    n = Math.max(0, Math.min(STEPS.length - 1, n));
    // Vor dem Test muss das Profil gespeichert sein
    if (n >= 5 && !st.saved) {
      const ok = await saveProfile();
      if (!ok) return;
    }
    st.step = n;
    bar.style.width = `${Math.round(((n + 0.4) / STEPS.length) * 100)}%`;
    back.disabled = n === 0;
    setSkip(null);
    const inner = h("div", { class: "inner" });
    clear(body, inner);
    body.scrollTop = 0;
    RENDER[STEPS[n]](inner);
  }

  const head = (no, title, lede) => [
    no ? h("div", { class: "step-no" }, `Schritt ${no} von 8`) : null,
    h("h1", null, title),
    lede ? h("p", { class: "lede" }, lede) : null,
  ];

  // ----- Profil speichern (nach Schritt 4) -----
  async function saveProfile() {
    const btn = footInner.querySelector("button");
    if (btn) busy(btn, true, "Wird gespeichert …");
    try {
      await updateSettings({ languages: [...st.langs] });
      await rpc("set_categories", { p_categories: [...st.cats] });
      const existing = topics();
      // Katalog-Themen
      const rows = [];
      for (const cat of CATEGORIES) {
        if (!st.cats.has(cat.id)) continue;
        for (const t of cat.topics) {
          if (!st.sel.has(t.id)) continue;
          rows.push({ catalog_id: t.id, kind: "topic", name: t.name, emoji: t.emoji, category: cat.id, keywords: t.kw, exclude: [], events: [], priority: st.sel.get(t.id), active: true, origin: "onboarding" });
        }
      }
      if (rows.length) await topicsApi.upsertCatalog(rows);
      const keepCatalog = new Set(rows.map((r) => r.catalog_id));
      await topicsApi.removeMany(existing.filter((t) => t.catalog_id && !keepCatalog.has(t.catalog_id)).map((t) => t.id));
      // Aktien
      const keepIds = new Set();
      for (const s of st.stocks) {
        const patch = { kind: "stock", name: s.name, emoji: "📈", category: "boerse", keywords: s.kw?.length ? s.kw : stockKeywords(s.name, s.symbol), exclude: [], ticker: s.symbol || null, events: s.events, priority: s.p, active: true, origin: "onboarding" };
        const found = s.id ? existing.find((t) => t.id === s.id) : existing.find((t) => t.kind === "stock" && (t.ticker ?? "") === (s.symbol ?? "").toUpperCase() && s.symbol);
        if (found) { await topicsApi.update(found.id, patch); keepIds.add(found.id); s.id = found.id; }
        else { const [row] = await topicsApi.insert([patch]); keepIds.add(row.id); s.id = row.id; }
      }
      await topicsApi.removeMany(existing.filter((t) => t.kind === "stock" && !keepIds.has(t.id)).map((t) => t.id));
      // Eigene Themen
      const keepCustom = new Set();
      for (const c of st.custom) {
        const patch = { kind: "topic", name: c.name, emoji: c.emoji ?? "⭐", category: c.cat ?? null, keywords: c.kw?.length ? c.kw : [c.name], exclude: c.exclude ?? [], events: [], priority: c.p, active: true, origin: "onboarding" };
        if (c.id) { await topicsApi.update(c.id, patch); keepCustom.add(c.id); }
        else { const [row] = await topicsApi.insert([patch]); c.id = row.id; keepCustom.add(row.id); }
      }
      if (restart) await topicsApi.removeMany(existing.filter((t) => t.kind === "topic" && !t.catalog_id && !keepCustom.has(t.id)).map((t) => t.id));
      await loadBoot();
      fn("rescore").catch(() => {});
      st.saved = true;
      return true;
    } catch (e) {
      toast("Speichern fehlgeschlagen: " + e.message, { ms: 5000 });
      if (btn) busy(btn, false);
      return false;
    }
  }
  const dirty = () => { st.saved = false; };

  const RENDER = {
    // ----- 0: Begrüßung und Sprache -----
    start(el) {
      const langOpts = [
        { v: ["de"], label: "Nur Deutsch" },
        { v: ["de", "en"], label: "Deutsch & Englisch" },
        { v: ["en"], label: "Nur Englisch" },
      ];
      const cur = () => [...st.langs].sort().join(",");
      const chips = h("div", { class: "chips", style: { justifyContent: "center" } });
      const draw = () => clear(chips, langOpts.map((o) => h("button", { type: "button", class: "chip" + (cur() === [...o.v].sort().join(",") ? " on" : ""), onclick: () => { st.langs = new Set(o.v); dirty(); draw(); } }, o.label)));
      draw();
      clear(el, h("div", { class: "welcome" },
        h("img", { class: "logo", src: "icons/icon-192.png", alt: "" }),
        h("h1", null, restart ? "Interessen neu einstellen" : "Was interessiert dich?"),
        h("p", { class: "lede" }, "In etwa zehn Minuten weiß die App, was du sehen willst – und was dich sofort erreichen soll."),
        h("div", { class: "steps-list" },
          h("div", null, h("b", null, "1"), "Bereiche und Themen wählen"),
          h("div", null, h("b", null, "2"), "Aktien hinzufügen und Wichtigkeit festlegen"),
          h("div", null, h("b", null, "3"), "An echten Schlagzeilen testen"),
          h("div", null, h("b", null, "4"), "Push-Grenze und Ruhezeiten einstellen")),
        h("h3", { style: { justifyContent: "center" } }, "In welchen Sprachen liest du Nachrichten?"),
        chips,
        h("p", { class: "help", style: { marginTop: "12px" } }, "Englische Quellen sind bei Wirtschaft und Tech oft schneller.")));
      setFoot(nextBtn("Los geht's"));
      if (restart) setSkip("Abbrechen", finish);
    },

    // ----- 1: Bereiche -----
    bereiche(el) {
      const grid = h("div", { class: "bigchips" });
      const draw = () => clear(grid, CATEGORIES.map((c) => h("button", { type: "button", class: "bigchip" + (st.cats.has(c.id) ? " on" : ""), "aria-pressed": String(st.cats.has(c.id)), onclick: () => {
        if (st.cats.has(c.id)) st.cats.delete(c.id);
        else {
          st.cats.add(c.id);
          // Erste Auswahl: die wichtigsten Unterthemen schon vorschlagen
          if (!c.topics.some((t) => st.sel.has(t.id))) for (const t of c.topics.slice(0, 3)) st.sel.set(t.id, Math.min(t.p, 2));
        }
        dirty(); draw();
      } }, h("span", { class: "e" }, c.emoji), c.name)));
      draw();
      clear(el, head(1, "Welche Bereiche interessieren dich?", "Wähle alles, was grob passt. Im nächsten Schritt wird es genauer."), grid);
      setFoot(nextBtn());
    },

    // ----- 2: Unterthemen -----
    themen(el) {
      const out = [head(2, "Was genau?", "Tippe an, was dich interessiert. Vorschläge sind schon markiert – nimm weg, was nicht passt.")];
      const cats = CATEGORIES.filter((c) => st.cats.has(c.id));
      if (!cats.length) out.push(h("p", { class: "help" }, "Du hast keinen Bereich gewählt. Du kannst unten trotzdem eigene Themen anlegen."));
      for (const c of cats) {
        const chips = h("div", { class: "chips" });
        const draw = () => {
          const own = st.custom.filter((x) => x.cat === c.id);
          clear(chips,
            c.topics.map((t) => h("button", { type: "button", class: "chip" + (st.sel.has(t.id) ? " on" : ""), "aria-pressed": String(st.sel.has(t.id)), onclick: () => { st.sel.has(t.id) ? st.sel.delete(t.id) : st.sel.set(t.id, Math.min(t.p, 2)); dirty(); draw(); } }, `${t.emoji} ${t.name}`)),
            (c.clubs ?? []).map((club) => {
              const onNow = own.some((x) => x.name === club);
              return h("button", { type: "button", class: "chip" + (onNow ? " on" : ""), onclick: () => {
                if (onNow) st.custom = st.custom.filter((x) => !(x.cat === c.id && x.name === club));
                else st.custom.push({ name: club, cat: c.id, p: 2, kw: [club], emoji: "⚽" });
                dirty(); draw();
              } }, club);
            }),
            own.filter((x) => !(c.clubs ?? []).includes(x.name)).map((x) => h("button", { type: "button", class: "chip on", onclick: () => { st.custom = st.custom.filter((y) => y !== x); dirty(); draw(); } }, `${x.emoji ?? "⭐"} ${x.name}`, h("span", { class: "rm" }, "×"))),
            h("button", { type: "button", class: "chip", style: { borderStyle: "dashed" }, onclick: () => addCustom(c.id, draw) }, "+ Eigenes"));
        };
        draw();
        out.push(h("h3", null, `${c.emoji} ${c.name}`), chips);
      }
      // Themen ohne Bereich
      const freeChips = h("div", { class: "chips" });
      const drawFree = () => clear(freeChips,
        st.custom.filter((x) => !x.cat || !st.cats.has(x.cat)).map((x) => h("button", { type: "button", class: "chip on", onclick: () => { st.custom = st.custom.filter((y) => y !== x); dirty(); drawFree(); } }, `${x.emoji ?? "⭐"} ${x.name}`, h("span", { class: "rm" }, "×"))),
        h("button", { type: "button", class: "chip", style: { borderStyle: "dashed" }, onclick: () => addCustom(null, drawFree) }, "+ Eigenes Thema"));
      drawFree();
      out.push(h("h3", null, "⭐ Sonst noch etwas?"), h("p", { class: "help", style: { margin: "-4px 0 10px" } }, "Zum Beispiel deine Stadt, ein Verein, eine Person oder eine Serie."), freeChips);
      clear(el, out);
      setFoot(nextBtn());
    },

    // ----- 3: Aktien -----
    aktien(el) {
      const results = h("div");
      const mine = h("div", { style: { display: "grid", gap: "10px", marginTop: "6px" } });
      const popular = h("div", { class: "chips" });
      const has = (sym) => st.stocks.some((s) => (s.symbol ?? "").toUpperCase() === sym.toUpperCase());
      const add = (sym, name) => {
        if (has(sym)) return;
        st.stocks.push({ symbol: sym.toUpperCase(), name: name.replace(/\s+(Inc|Corp|Corporation|AG|SE|plc|N\.V\.|Ltd)\.?,?$/i, "").replace(/,\s*$/, "").trim().slice(0, 40), events: [...STOCK_EVENTS_DEFAULT], p: 3 });
        dirty(); drawMine(); drawPopular(); drawFoot();
      };
      const drawFoot = () => setFoot(nextBtn(st.stocks.length ? "Weiter" : "Ohne Aktien weiter"));
      const drawPopular = () => clear(popular, POPULAR_STOCKS.filter((p) => !has(p.symbol)).map((p) => h("button", { type: "button", class: "chip small", onclick: () => add(p.symbol, p.name) }, `+ ${p.name}`)));
      const drawMine = () => clear(mine, st.stocks.map((s) => {
        const ev = h("div", { class: "chips" });
        const drawEv = () => clear(ev, STOCK_EVENTS.map((e) => h("button", { type: "button", class: "chip small" + (s.events.includes(e.id) ? " on" : ""), onclick: () => { s.events = s.events.includes(e.id) ? s.events.filter((x) => x !== e.id) : [...s.events, e.id]; dirty(); drawEv(); } }, `${e.emoji} ${e.name}`)));
        drawEv();
        return h("div", { class: "group", style: { margin: "0", padding: "13px 14px" } },
          h("div", { style: { display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" } },
            h("strong", { style: { flex: "1", fontSize: "16.5px" } }, s.name), s.symbol ? h("span", { class: "badge soft mono" }, s.symbol) : null,
            h("button", { type: "button", class: "btn small danger", "aria-label": `${s.name} entfernen`, onclick: () => { st.stocks = st.stocks.filter((x) => x !== s); dirty(); drawMine(); drawPopular(); drawFoot(); } }, "Entfernen")),
          h("div", { class: "help", style: { marginBottom: "8px" } }, "Was willst du mitbekommen?"), ev);
      }));
      const input = h("input", { class: "input", type: "search", placeholder: "Aktie suchen, z. B. Nvidia", autocapitalize: "none", enterkeyhint: "search" });
      const runSearch = debounce(async () => {
        const q = input.value.trim();
        if (q.length < 2) return clear(results);
        clear(results, h("div", { class: "help", style: { padding: "8px 2px" } }, "Suche …"));
        try {
          const r = await fn("stock_search", { q });
          if (input.value.trim() !== q) return;
          if (!r.results?.length) {
            return clear(results, h("div", { class: "group" }, h("button", { class: "row", type: "button", onclick: () => { add(q.toUpperCase().replace(/\s+/g, ""), q); input.value = ""; clear(results); } },
              h("div", { class: "t" }, h("strong", null, `„${q}“ ohne Kürzel hinzufügen`), h("small", null, r.error ?? "Keine Treffer – Nachrichten werden über den Namen gesucht.")), h("span", { class: "chev" }, "+"))));
          }
          clear(results, h("div", { class: "group" }, r.results.map((x) => h("button", { class: "row", type: "button", disabled: has(x.symbol), onclick: () => { add(x.symbol, x.name); input.value = ""; clear(results); } },
            h("div", { class: "t" }, h("strong", null, x.name), h("small", null, `${x.symbol} · ${x.exchange}`)), h("span", { class: "chev" }, has(x.symbol) ? "✓" : "+")))));
        } catch (e) {
          clear(results, h("div", { class: "help" }, "Suche gerade nicht möglich: " + e.message));
        }
      }, 350);
      input.addEventListener("input", runSearch);
      drawMine(); drawPopular();
      clear(el, head(3, "Welche Aktien verfolgst du?", "Für diese Titel bekommst du Nachrichten besonders schnell – auf Wunsch auch einen Alarm bei plötzlichen Kursbewegungen. Du kannst den Schritt überspringen."),
        h("div", { class: "search" }, icon("search"), input), results, mine,
        h("h3", null, "Häufig gewählt"), popular);
      drawFoot();
    },

    // ----- 4: Wichtigkeit -----
    wichtigkeit(el) {
      const rows = [];
      const item = (label, get, set) => h("div", { class: "prio-row" }, h("div", { class: "n" }, label), segmented(PRIO_OPTIONS, get(), (v) => { set(v); dirty(); }));
      for (const s of st.stocks) rows.push(item(`📈 ${s.name}`, () => s.p, (v) => (s.p = v)));
      for (const c of CATEGORIES) {
        if (!st.cats.has(c.id)) continue;
        for (const t of c.topics) if (st.sel.has(t.id)) rows.push(item(`${t.emoji} ${t.name}`, () => st.sel.get(t.id), (v) => st.sel.set(t.id, v)));
      }
      for (const c of st.custom) rows.push(item(`${c.emoji ?? "⭐"} ${c.name}`, () => c.p, (v) => (c.p = v)));
      clear(el, head(4, "Wie wichtig ist dir was?", "Sei bei „Push“ ruhig streng: Je weniger Themen dort stehen, desto mehr zählt jede Nachricht auf deinem Handy."),
        h("div", { class: "legend" },
          h("div", null, h("b", { style: { color: "var(--hot)" } }, "Push"), "Sofort aufs Handy, wenn etwas Wichtiges passiert."),
          h("div", null, h("b", { style: { color: "var(--warm)" } }, "Wichtig"), "Oben in der App und im Digest, aber ohne Störung."),
          h("div", null, h("b", null, "App"), "Nur zu sehen, wenn du die App öffnest.")),
        rows.length ? h("div", { class: "group", style: { padding: "2px 14px" } }, rows) : h("p", { class: "help" }, "Du hast noch nichts ausgewählt. Geh zurück und wähle mindestens ein Thema oder eine Aktie."));
      setFoot(nextBtn("Speichern und weiter"));
    },

    // ----- 5: Test mit echten Schlagzeilen -----
    test(el) {
      const headNodes = head(5, "Der Praxistest", "Echte, aktuelle Schlagzeilen. Reagiere aus dem Bauch heraus – daraus lernt die App am meisten.");
      const begin = () => {
        clear(el, headNodes, h("div", { class: "center" }, h("span", { class: "spin" })));
        setFoot();
        sampleDeck(el, 40, {
          learnOnly: true, headNodes, setFoot, setSkip,
          onDone: () => go(st.step + 1),
          emptyText: "Es sind noch nicht genug Meldungen eingegangen (die App sammelt erst seit Kurzem). Diesen Test bietet dir die App in ein paar Tagen von selbst wieder an.",
        });
      };
      clear(el, headNodes,
        h("div", { class: "gesture" },
          h("div", null, h("span", { class: "e" }, "🔥"), h("span", null, h("b", null, "Sofort wissen"), " – so etwas soll dich direkt erreichen (nach oben wischen)")),
          h("div", null, h("span", { class: "e" }, "👍"), h("span", null, h("b", null, "Interessant"), " – gern mehr davon (nach rechts wischen)")),
          h("div", null, h("span", { class: "e" }, "👎"), h("span", null, h("b", null, "Egal"), " – brauche ich nicht (nach links wischen)")),
          h("div", null, h("span", { class: "e" }, "⛔"), h("span", null, h("b", null, "Nie wieder"), " – so etwas möglichst gar nicht zeigen"))),
        h("p", { class: "help" }, "Etwa 40 Schlagzeilen, dauert zwei bis drei Minuten. Nach zwölf Antworten kannst du jederzeit aufhören."));
      setFoot(nextBtn("Test starten", begin));
      setSkip("Überspringen", () => go(st.step + 1));
    },

    // ----- 6: Push-Grenze -----
    grenze(el) {
      const pushStock = st.stocks.find((s) => s.p === 3) ?? st.stocks[0];
      let pushTopicName = null;
      for (const c of CATEGORIES) for (const t of c.topics) if (!pushTopicName && st.cats.has(c.id) && st.sel.get(t.id) === 3) pushTopicName = t.name;
      pushTopicName = pushTopicName ?? st.custom.find((c) => c.p === 3)?.name ?? null;
      const examples = calibrationExamples({ stock: pushStock?.name, topic: pushTopicName });
      // gemischt, aber nicht völlig zufällig: erst groß, dann klein, dann dazwischen
      const order = [...examples].sort((a, b) => (Math.abs(3 - b.level) - Math.abs(3 - a.level)) || a.domain.localeCompare(b.domain));
      const answers = [];
      let i = 0;
      const deck = h("div", { class: "deck" });
      const count = h("div", { class: "deck-count" });
      const drawCard = () => {
        if (i >= order.length) return done();
        const ex = order[i];
        clear(deck, h("div", { class: "card" }, h("div", { class: "src" }, h("span", { class: "badge soft" }, ex.domain === "stocks" ? "Deine Aktie" : ex.domain === "topics" ? "Dein Thema" : "Weltgeschehen"), ex.hint), h("h2", null, ex.text)));
        count.textContent = `${i + 1} von ${order.length}`;
      };
      const answer = (yes) => { answers.push({ ...order[i], yes }); i++; drawCard(); };
      const done = async () => {
        const thr = {};
        for (const d of ["stocks", "topics", "world"]) {
          const a = answers.filter((x) => x.domain === d);
          const v = thresholdFromAnswers(a);
          if (v != null) thr[d] = v;
        }
        st.thr = thr;
        const patch = {};
        if (thr.stocks != null) patch.thr_stocks = thr.stocks;
        if (thr.topics != null) patch.thr_topics = thr.topics;
        if (thr.world != null) { patch.thr_world = Math.max(60, thr.world); patch.world_push = thr.world < 92; }
        try { await updateSettings(patch); await loadBoot(); } catch (e) { toast(e.message); }
        setSkip(null);
        const line = (label, v, off) => h("div", { class: "kv" }, h("span", null, label), h("span", null, off ? "kein Push" : thresholdLabel(v)));
        clear(el, head(6, "Deine Push-Grenze steht", "So entscheidet die App ab jetzt, was dich sofort erreicht. Du kannst das jederzeit im Profil ändern – und die App lernt aus deinen Daumen weiter."),
          h("div", { class: "group", style: { padding: "4px 15px" } },
            thr.stocks != null ? line("📈 Deine Aktien", thr.stocks) : null,
            thr.topics != null ? line("⭐ Deine Push-Themen", thr.topics) : null,
            thr.world != null ? line("🌍 Weltgeschehen", thr.world, thr.world >= 92) : null),
          h("div", { style: { marginTop: "14px" } }, h("button", { class: "btn small", onclick: () => RENDER.grenze(el) }, "Noch einmal beantworten")));
        setFoot(nextBtn());
      };
      clear(el, head(6, "Wofür willst du einen Push?", "Stell dir vor, diese Meldung kommt gerade herein. Soll dein Handy dafür klingeln?"), deck, count);
      setFoot(h("div", { class: "yesno", style: { width: "100%" } },
        h("button", { class: "btn", type: "button", onclick: () => answer(false) }, "Nein"),
        h("button", { class: "btn accent", type: "button", onclick: () => answer(true) }, "Ja, Push")));
      setSkip("Überspringen", () => go(st.step + 1));
      drawCard();
    },

    // ----- 7: Ruhezeiten, Limit, Digest -----
    rhythmus(el) {
      clear(el, head(7, "Wann soll Ruhe sein?", "Lege fest, wann nichts stören darf und wie viele Pushes pro Tag höchstens kommen."), rhythmControls());
      setFoot(nextBtn());
    },

    // ----- 8: Freitext und KI -----
    freitext(el) {
      const ta = h("textarea", { class: "input", placeholder: "Zum Beispiel: Ich ziehe nächstes Jahr nach Berlin. Raumfahrt interessiert mich, aber nur SpaceX. Keine Promi-News.", value: settings().profile_text ?? "" });
      const sugWrap = h("div");
      const chosen = new Set();
      let suggestions = [];
      const drawSug = (note) => {
        if (!suggestions.length) return clear(sugWrap, note ? h("p", { class: "help" }, note) : null);
        clear(sugWrap, h("h3", null, "Vorschläge – tippe an, was stimmt"),
          h("div", { class: "chips" }, suggestions.map((s, i) => h("button", { type: "button", class: "chip" + (chosen.has(i) ? " on" : ""), onclick: () => { chosen.has(i) ? chosen.delete(i) : chosen.add(i); drawSug(note); } }, `${s.emoji} ${s.name}`))),
          note ? h("p", { class: "help" }, note) : null);
      };
      const sugBtn = h("button", { class: "btn block", type: "button", onclick: async () => {
        const text = ta.value.trim();
        if (text.length < 3) return toast("Schreib erst ein paar Worte.");
        busy(sugBtn, true, "Einen Moment …");
        try {
          const r = await fn("suggest_topics", { text });
          const have = new Set(topics().map((t) => t.name.toLowerCase()));
          suggestions = (r.topics ?? []).filter((t) => !have.has(t.name.toLowerCase()));
          chosen.clear(); suggestions.forEach((_, i) => chosen.add(i));
          drawSug(suggestions.length ? (r.ai ? null : "Einfache Vorschläge ohne KI. Mit verbundener KI werden sie genauer.") : "Daraus ließen sich keine neuen Themen ableiten. Deine Beschreibung wird trotzdem gespeichert.");
        } catch (e) { toast(e.message); }
        busy(sugBtn, false);
      } }, "Themen daraus vorschlagen");
      const save = async () => {
        const btn = footInner.querySelector("button");
        busy(btn, true);
        try {
          await updateSettings({ profile_text: ta.value.trim().slice(0, 2000) });
          const rows = suggestions.filter((_, i) => chosen.has(i)).map((s) => ({ kind: s.kind, name: s.name, emoji: s.emoji, category: null, keywords: s.keywords, exclude: s.exclude ?? [], ticker: s.kind === "stock" ? s.ticker : null, events: s.kind === "stock" ? STOCK_EVENTS_DEFAULT : [], priority: s.priority, active: true, origin: "freitext" }));
          if (rows.length) await topicsApi.insert(rows);
          await loadBoot();
          go(st.step + 1);
        } catch (e) { toast(e.message); busy(btn, false); }
      };
      clear(el, head(8, "Feinschliff", "Zwei freiwillige Dinge, die deine News deutlich besser machen."),
        h("h3", null, "✨ Kostenlose KI verbinden (empfohlen)"),
        h("p", { class: "help", style: { margin: "-4px 0 10px" } }, "Mit einem kostenlosen Schlüssel von Google ordnet eine KI Meldungen genauer ein, fasst sie auf Deutsch zusammen und versteht deine Beschreibung unten. Ohne Schlüssel arbeitet die App mit festen Regeln."),
        geminiKeyBox(),
        h("h3", { style: { marginTop: "30px" } }, "✍️ Gibt es noch etwas?"),
        h("p", { class: "help", style: { margin: "-4px 0 10px" } }, "Beschreibe in eigenen Worten, was dir wichtig ist – oder was du nicht sehen willst."),
        ta, h("div", { style: { marginTop: "10px" } }, sugBtn), sugWrap);
      setFoot(nextBtn("Weiter", save));
    },

    // ----- 9: Push einschalten und Zusammenfassung -----
    fertig(el) {
      const s = settings();
      const all = topics();
      const push = all.filter((t) => t.priority === 3), imp = all.filter((t) => t.priority === 2), app = all.filter((t) => t.priority === 1);
      const names = (arr) => arr.length ? arr.map((t) => t.name).join(", ") : "–";
      clear(el, h("h1", null, "Fast geschafft"), h("p", { class: "lede" }, "Schalte noch Push ein, dann geht es los."),
        h("h3", null, "🔔 Push auf diesem Gerät"), pushBox(),
        h("div", { style: { marginTop: "12px" } }, ntfyBox()),
        h("h3", { style: { marginTop: "28px" } }, "Dein Profil"),
        h("div", { class: "group", style: { padding: "4px 15px" } },
          h("div", { class: "kv stack" }, h("span", null, "🔴 Sofort-Push"), h("span", null, names(push))),
          h("div", { class: "kv stack" }, h("span", null, "🟡 Wichtig"), h("span", null, names(imp))),
          h("div", { class: "kv stack" }, h("span", null, "⚪ Nur in der App"), h("span", null, names(app))),
          h("div", { class: "kv" }, h("span", null, "Ruhezeit"), h("span", null, s.quiet_enabled ? `${s.quiet_start}–${s.quiet_end} Uhr` : "aus")),
          h("div", { class: "kv" }, h("span", null, "Höchstens pro Tag"), h("span", null, `${s.push_max_per_day} Pushes`)),
          h("div", { class: "kv" }, h("span", null, "KI"), h("span", null, s.has_gemini_key ? "verbunden" : "nicht verbunden"))),
        h("p", { class: "help", style: { marginTop: "12px" } }, "Alles lässt sich später im Reiter „Profil“ ändern. Die ersten Meldungen erscheinen in wenigen Minuten."));
      setFoot(nextBtn("Fertig – zu meinen News", async () => {
        const btn = footInner.querySelector("button");
        busy(btn, true);
        try {
          await updateSettings({ onboarding_done: true, last_check_at: new Date().toISOString() });
          fn("rescore").catch(() => {});
          await finish();
        } catch (e) { toast(e.message); busy(btn, false); }
      }, "accent"));
    },
  };

  function addCustom(catId, redraw) {
    openSheet({
      title: "Eigenes Thema", auto: true,
      render: (b, api) => {
        const name = h("input", { class: "input", placeholder: "z. B. Hamburg, Taylor Swift, Stranger Things", maxlength: 40, enterkeyhint: "done" });
        const addIt = () => {
          const v = name.value.trim();
          if (v.length < 2) return toast("Bitte gib einen Namen ein.");
          if (!st.custom.some((x) => x.name.toLowerCase() === v.toLowerCase())) st.custom.push({ name: v, cat: catId, p: 2, kw: [v], emoji: "⭐" });
          dirty(); redraw(); api.close();
        };
        name.addEventListener("keydown", (e) => { if (e.key === "Enter") addIt(); });
        add(b, h("label", { class: "field" }, h("span", null, "Name des Themas"), name),
          h("p", { class: "help" }, "Nach diesem Begriff wird in Schlagzeilen gesucht. Weitere Suchbegriffe kannst du später im Profil ergänzen."),
          h("div", { style: { marginTop: "14px" } }, h("button", { class: "btn primary block", type: "button", onclick: addIt }, "Hinzufügen")));
        setTimeout(() => name.focus(), 350);
      },
    });
  }

  go(0);
}

/** Bedienelemente für Ruhezeit, Tageslimit und Digest (auch im Profil verwendet). */
export function rhythmControls() {
  const root = h("div");
  const save = async (patch) => { try { await updateSettings(patch); Object.assign(S.boot.settings, patch); } catch (e) { toast(e.message); } };
  const draw = () => {
    const s = settings();
    const time = (val, onch) => h("input", { class: "input", type: "time", value: val, onchange: (e) => onch(e.target.value || val) });
    const maxB = h("b", null, String(s.push_max_per_day));
    const step = (d) => { const v = Math.max(0, Math.min(50, S.boot.settings.push_max_per_day + d)); maxB.textContent = String(v); save({ push_max_per_day: v }); };
    const digestTimes = h("div", { class: "chips" });
    const drawDigest = () => clear(digestTimes,
      (S.boot.settings.digest_times ?? []).map((t) => h("button", { type: "button", class: "chip small on", onclick: () => { const next = S.boot.settings.digest_times.filter((x) => x !== t); save({ digest_times: next }).then(drawDigest); } }, `${t} Uhr`, h("span", { class: "rm" }, "×"))),
      (() => {
        const inp = h("input", { class: "input", type: "time", style: { minHeight: "34px", padding: "4px 10px" }, "aria-label": "Uhrzeit hinzufügen" });
        inp.addEventListener("change", () => {
          const v = inp.value;
          if (!v) return;
          const next = [...new Set([...(S.boot.settings.digest_times ?? []), v])].sort().slice(0, 4);
          save({ digest_times: next }).then(drawDigest);
        });
        return (S.boot.settings.digest_times ?? []).length < 4 ? inp : null;
      })());
    clear(root,
      h("div", { class: "group" },
        h("div", { class: "row" }, h("span", { class: "e" }, "🌙"), h("div", { class: "t" }, h("strong", null, "Ruhezeit"), h("small", null, "In dieser Zeit kommt kein Push.")), switchEl(s.quiet_enabled, (v) => save({ quiet_enabled: v }).then(draw))),
        s.quiet_enabled ? h("div", { class: "row" }, h("div", { class: "t" }, h("strong", null, "Von – bis")), time(s.quiet_start, (v) => save({ quiet_start: v })), h("span", { class: "v" }, "–"), time(s.quiet_end, (v) => save({ quiet_end: v }))) : null,
        s.quiet_enabled ? h("div", { class: "row" }, h("div", { class: "t" }, h("strong", null, "Aktien dürfen stören"), h("small", null, "Pushes zu deinen Aktien kommen auch in der Ruhezeit (US-Börse schließt um 22 Uhr, Meldungen kommen oft danach).")), switchEl(s.quiet_allow_stocks, (v) => save({ quiet_allow_stocks: v }))) : null),
      h("div", { class: "group" },
        h("div", { class: "row" }, h("span", { class: "e" }, "🧮"), h("div", { class: "t" }, h("strong", null, "Höchstens pro Tag"), h("small", null, "Ganz große Ereignisse kommen trotzdem durch.")),
          h("div", { class: "stepper" }, h("button", { type: "button", "aria-label": "weniger", onclick: () => step(-1) }, "−"), maxB, h("button", { type: "button", "aria-label": "mehr", onclick: () => step(1) }, "+")))),
      h("div", { class: "group" },
        h("div", { class: "row" }, h("span", { class: "e" }, "🗞️"), h("div", { class: "t" }, h("strong", null, "Digest"), h("small", null, "Eine ruhige Zusammenfassung zu festen Zeiten.")), switchEl(s.digest_enabled, (v) => save({ digest_enabled: v }).then(draw))),
        s.digest_enabled ? h("div", { class: "row col" }, digestTimes) : null));
    drawDigest();
  };
  draw();
  return root;
}

/**
 * Kartenstapel mit echten Schlagzeilen. Wischen: rechts = interessant, links = egal, hoch = sofort wissen.
 */
export async function sampleDeck(el, n, { headNodes = [], setFoot, setSkip, onDone, emptyText, learnOnly = true }) {
  let samples = [];
  try {
    samples = await rpc("onboarding_samples", { p_count: n });
  } catch (e) {
    toast(e.message);
  }
  if (samples.length < 6) {
    clear(el, headNodes, h("div", { class: "empty" }, h("div", { class: "big" }, "⏳"), h("strong", null, "Noch zu früh"), emptyText ?? "Es sind noch nicht genug Meldungen da."));
    setFoot?.(h("button", { class: "btn primary block", type: "button", onclick: onDone }, "Weiter"));
    return;
  }
  let i = 0, answered = 0;
  const deck = h("div", { class: "deck" });
  const count = h("div", { class: "deck-count" });
  const queue = [];
  let sending = false;
  const flush = async () => {
    if (sending) return;
    sending = true;
    while (queue.length) {
      const q = queue.shift();
      try { await rpc("set_feedback", { p_id: q.id, p_value: q.v, p_learn_only: learnOnly }); } catch { /* weiter */ }
    }
    sending = false;
  };
  const vote = (v, dir) => {
    const top = deck.querySelector(".card.top");
    if (!top) return;
    queue.push({ id: samples[i].id, v });
    flush();
    answered++;
    top.style.transition = "transform .35s var(--ease), opacity .35s";
    top.style.transform = dir === "up" ? "translateY(-130%) rotate(-3deg)" : dir === "left" ? "translateX(-130%) rotate(-12deg)" : dir === "right" ? "translateX(130%) rotate(12deg)" : "scale(.8)";
    top.style.opacity = "0";
    i++;
    setTimeout(draw, 190);
  };
  const cardEl = (s, cls) => h("div", { class: "card " + cls },
    h("span", { class: "stamp" }),
    h("div", { class: "src" }, s.topics?.[0] ? h("span", { class: "badge accent" }, s.topics[0].name) : null, s.source ?? ""),
    h("h2", null, s.title), s.summary ? h("p", null, s.summary) : null);
  const draw = () => {
    if (i >= samples.length) return finishDeck();
    const cards = [];
    if (samples[i + 2]) cards.push(cardEl(samples[i + 2], "under2"));
    if (samples[i + 1]) cards.push(cardEl(samples[i + 1], "under"));
    const top = cardEl(samples[i], "top");
    cards.push(top);
    clear(deck, cards);
    count.textContent = `${i + 1} von ${samples.length}`;
    swipe(top);
    if (answered >= 12) setSkip?.("Reicht mir", finishDeck);
  };
  const finishDeck = async () => {
    await flush();
    setSkip?.(null);
    clear(el, headNodes[1] ? [h("h1", null, "Danke – das hilft sehr")] : [], h("div", { class: "empty" }, h("div", { class: "big" }, "🎯"), h("strong", null, `${answered} Antworten ausgewertet`), "Die App weiß jetzt deutlich besser, was dich interessiert."));
    setFoot?.(h("button", { class: "btn primary block", type: "button", onclick: onDone }, "Weiter"));
  };
  function swipe(card) {
    let sx = 0, sy = 0, dx = 0, dy = 0, active = false;
    const stamp = card.querySelector(".stamp");
    card.addEventListener("touchstart", (e) => { active = true; sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = dy = 0; card.classList.add("dragging"); }, { passive: true });
    card.addEventListener("touchmove", (e) => {
      if (!active) return;
      dx = e.touches[0].clientX - sx; dy = e.touches[0].clientY - sy;
      const up = dy < -40 && Math.abs(dy) > Math.abs(dx);
      card.style.transform = up ? `translateY(${dy}px)` : `translateX(${dx}px) rotate(${dx / 22}deg)`;
      stamp.textContent = up ? "🔥" : dx > 30 ? "👍" : dx < -30 ? "👎" : "";
      stamp.style.opacity = String(Math.min(1, Math.max(Math.abs(dx), Math.abs(dy)) / 90));
    }, { passive: true });
    const end = () => {
      if (!active) return;
      active = false;
      card.classList.remove("dragging");
      if (dy < -110 && Math.abs(dy) > Math.abs(dx)) vote(2, "up");
      else if (dx > 95) vote(1, "right");
      else if (dx < -95) vote(-1, "left");
      else { card.style.transform = ""; stamp.style.opacity = "0"; }
    };
    card.addEventListener("touchend", end);
    card.addEventListener("touchcancel", end);
  }
  clear(el, headNodes, deck, count);
  setFoot?.(h("div", { class: "fb", style: { width: "100%", marginTop: "0" } },
    h("button", { type: "button", class: "neg", onclick: () => vote(-2, "down") }, h("span", { class: "e" }, "⛔"), "Nie wieder"),
    h("button", { type: "button", class: "neg", onclick: () => vote(-1, "left") }, h("span", { class: "e" }, "👎"), "Egal"),
    h("button", { type: "button", onclick: () => vote(1, "right") }, h("span", { class: "e" }, "👍"), "Interessant"),
    h("button", { type: "button", onclick: () => vote(2, "up") }, h("span", { class: "e" }, "🔥"), "Sofort wissen")));
  draw();
}

/** Kurzer Interessen-Check zwischendurch (z. B. 10 Schlagzeilen). */
export function openInterestCheck(n = 10) {
  openSheet({
    title: "Interessen-Check",
    render: async (body, api) => {
      const el = h("div");
      add(body, el);
      clear(el, h("div", { class: "center" }, h("span", { class: "spin" })));
      const done = async () => {
        try { await updateSettings({ last_check_at: new Date().toISOString() }); await loadBoot(); } catch { /* egal */ }
        api.close();
      };
      await sampleDeck(el, n, {
        headNodes: [h("p", { class: "lede", style: { color: "var(--text-2)", margin: "4px 0 6px" } }, "Wische oder tippe: Was davon interessiert dich?")],
        setFoot: (...nodes) => api.setFoot(...nodes),
        setSkip: () => {},
        onDone: done,
        learnOnly: true,
        emptyText: "Gerade gibt es nicht genug neue Schlagzeilen für einen Check. Versuch es später noch einmal.",
      });
    },
  });
}
