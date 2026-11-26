// Kleine Helfer: Elemente bauen, Symbole, Einblendungen, Blätter von unten, Zeitangaben.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k in el && k !== "list" && typeof v !== "string") el[k] = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === "") continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Kinder anhängen; leere Werte und verschachtelte Listen sind erlaubt. */
export function add(el, ...children) {
  append(el, children);
  return el;
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

const ICONS = {
  today: '<path d="M4 6.5h16M4 12h10M4 17.5h13"/><circle cx="19" cy="14.5" r="2.5" fill="currentColor" stroke="none"/>',
  ticker: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  saved: '<path d="M7 4.5h10a1 1 0 0 1 1 1V20l-6-3.8L6 20V5.500a1 1 0 0 1 1-1Z"/>',
  profile: '<path d="M5 7h9M18 7h1M5 12h2M11 12h8M5 17h7M16 17h3"/><circle cx="16" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="14" cy="17" r="2"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  share: '<path d="M12 15V4M8 7.500l4-4 4 4M6 12v6.500a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V12"/>',
  ext: '<path d="M10 6H6.500a1 1 0 0 0-1 1v10.500a1 1 0 0 0 1 1H17a1 1 0 0 0 1-1V14M14 5h5v5M19 5l-8 8"/>',
  bell: '<path d="M6.500 16.500V11a5.500 5.500 0 0 1 11 0v5.500l1.500 2h-14l1.500-2ZM10 20.500a2 2 0 0 0 4 0"/>',
};

export function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.9");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[name] ?? "";
  return svg;
}

// ---------- Einblendungen ----------
export function toast(msg, opts = {}) {
  let root = document.getElementById("toasts");
  if (!root) {
    root = h("div", { id: "toasts", "aria-live": "polite" });
    document.body.append(root);
  }
  const el = h("div", { class: "toast", role: "status" }, h("span", null, msg));
  if (opts.action) {
    el.append(h("button", { onclick: () => { opts.action.run(); remove(); } }, opts.action.label));
  }
  const remove = () => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 300);
  };
  root.append(el);
  while (root.children.length > 2) root.firstChild.remove();
  setTimeout(remove, opts.ms ?? (opts.action ? 5500 : 2800));
}

// ---------- Blätter von unten ----------
const sheets = [];
let ignorePop = 0;

function lockBody() {
  document.body.classList.toggle("locked", sheets.length > 0 || !!document.querySelector(".ob"));
}

/**
 * openSheet({ title, render(body, api), foot?, auto?, onClose? })
 * api: { close(), setTitle(t), body, foot }
 */
export function openSheet(opts) {
  const backdrop = h("div", { class: "sheet-backdrop" });
  const titleEl = h("h2", null, opts.title ?? "");
  const body = h("div", { class: "sheet-body" });
  const foot = h("div", { class: "sheet-foot", hidden: true });
  const head = h("div", { class: "sheet-head" }, titleEl, h("button", { class: "close", "aria-label": "Schließen", onclick: () => api.close() }, "✕"));
  const panel = h("div", { class: "sheet" + (opts.auto ? " auto" : ""), role: "dialog", "aria-modal": "true" }, head, body, foot);
  const entry = { panel, backdrop, closed: false, onClose: opts.onClose };
  const api = {
    body, foot, panel,
    setTitle: (t) => (titleEl.textContent = t),
    setFoot: (...nodes) => { foot.hidden = nodes.length === 0; clear(foot, ...nodes); },
    close: () => closeEntry(entry, true),
  };
  entry.api = api;
  backdrop.addEventListener("click", () => api.close());
  document.body.append(backdrop, panel);
  sheets.push(entry);
  lockBody();
  try {
    history.pushState({ sheet: sheets.length }, "");
  } catch { /* egal */ }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    backdrop.classList.add("show");
    panel.classList.add("show");
  }));
  dragToClose(head, panel, backdrop, () => api.close());
  Promise.resolve(opts.render(body, api)).catch((e) => {
    console.error(e);
    clear(body, h("div", { class: "empty" }, h("div", { class: "big" }, "⚠️"), h("strong", null, "Das hat nicht geklappt"), String(e?.message ?? e)));
  });
  return api;
}

function closeEntry(entry, viaUi) {
  if (entry.closed) return;
  entry.closed = true;
  const i = sheets.indexOf(entry);
  if (i >= 0) sheets.splice(i, 1);
  entry.panel.classList.remove("show");
  entry.panel.style.transform = "";
  entry.backdrop.classList.remove("show");
  setTimeout(() => { entry.panel.remove(); entry.backdrop.remove(); }, 420);
  lockBody();
  if (viaUi && history.state?.sheet) {
    ignorePop++;
    history.back();
  }
  try { entry.onClose?.(); } catch (e) { console.error(e); }
}

window.addEventListener("popstate", () => {
  if (ignorePop > 0) { ignorePop--; return; }
  const top = sheets[sheets.length - 1];
  if (top) closeEntry(top, false);
});

export function closeAllSheets() {
  for (const s of [...sheets].reverse()) closeEntry(s, true);
}

export function sheetCount() {
  return sheets.length;
}

function dragToClose(handle, panel, backdrop, close) {
  let startY = 0, dy = 0, active = false;
  handle.addEventListener("touchstart", (e) => {
    if (e.target.closest("button")) return;
    active = true; startY = e.touches[0].clientY; dy = 0;
    panel.classList.add("dragging");
  }, { passive: true });
  handle.addEventListener("touchmove", (e) => {
    if (!active) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    panel.style.transform = `translateY(${dy}px)`;
    backdrop.style.opacity = String(Math.max(0, 1 - dy / 500));
  }, { passive: true });
  const end = () => {
    if (!active) return;
    active = false;
    panel.classList.remove("dragging");
    backdrop.style.opacity = "";
    if (dy > 110) close();
    else panel.style.transform = "";
  };
  handle.addEventListener("touchend", end);
  handle.addEventListener("touchcancel", end);
}

let confirmOpen = false;
export function confirmSheet({ title, text, yes = "Ja", no = "Abbrechen", danger = false }) {
  if (confirmOpen) return Promise.resolve(false);
  confirmOpen = true;
  return new Promise((resolve) => {
    let answered = false;
    openSheet({
      title, auto: true,
      onClose: () => { confirmOpen = false; if (!answered) resolve(false); },
      render: (body, api) => {
        body.append(h("p", { style: { color: "var(--text-2)", margin: "4px 0 18px" } }, text));
        body.append(h("div", { style: { display: "grid", gap: "10px" } },
          h("button", { class: "btn block " + (danger ? "danger" : "primary"), onclick: () => { answered = true; resolve(true); api.close(); } }, yes),
          h("button", { class: "btn block", onclick: () => api.close() }, no)));
      },
    });
  });
}

// ---------- Zeit ----------
const DAY = 86400_000;
export function ago(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime(), now = Date.now(), d = now - t;
  if (d < 45_000) return "gerade eben";
  if (d < 3600_000) return `vor ${Math.max(1, Math.round(d / 60_000))} Min`;
  if (d < 6 * 3600_000) return `vor ${Math.round(d / 3600_000)} Std`;
  const date = new Date(t), today = new Date();
  const hm = date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (t >= startToday) return `heute ${hm}`;
  if (t >= startToday - DAY) return `gestern ${hm}`;
  return date.toLocaleDateString("de-DE", { day: "numeric", month: "short" }) + ` ${hm}`;
}

export function secondsAgo(iso) {
  if (!iso) return "noch nie";
  const d = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (d < 5) return "gerade eben";
  if (d < 90) return `vor ${d} Sek.`;
  if (d < 3600) return `vor ${Math.round(d / 60)} Min`;
  return ago(iso);
}

export function longDate(d = new Date()) {
  return d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------- Gerät ----------
export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;

export const store = {
  get(k, d = null) { try { const v = localStorage.getItem("news." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("news." + k, JSON.stringify(v)); } catch { /* voll oder gesperrt */ } },
  del(k) { try { localStorage.removeItem("news." + k); } catch { /* egal */ } },
};

export function busy(btn, on, label) {
  if (on) {
    btn.dataset.label = btn.textContent;
    btn.disabled = true;
    clear(btn, h("span", { class: "spin" }), label ?? btn.dataset.label);
  } else {
    btn.disabled = false;
    clear(btn, label ?? btn.dataset.label ?? "");
  }
}

export function switchEl(checked, onChange) {
  const input = h("input", { type: "checkbox", checked: !!checked, onchange: () => onChange(input.checked) });
  return h("label", { class: "switch" }, input, h("span"));
}

/** Auswahl aus mehreren Stufen, z. B. Push / Wichtig / App. */
export function segmented(options, value, onChange, cls = "") {
  const wrap = h("div", { class: "seg " + cls, role: "radiogroup" });
  const draw = (val) => clear(wrap, options.map((o) => h("button", {
    type: "button", role: "radio", "aria-checked": String(o.value === val),
    class: (o.value === val ? "on " : "") + (o.cls ?? ""),
    onclick: () => { draw(o.value); onChange(o.value); },
  }, o.label)));
  draw(value);
  return wrap;
}

export const PRIO_OPTIONS = [
  { value: 3, label: "Push", cls: "p3" },
  { value: 2, label: "Wichtig", cls: "p2" },
  { value: 1, label: "App", cls: "p1" },
];
