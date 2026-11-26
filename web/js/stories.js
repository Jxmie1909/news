// Darstellung von Meldungen (Liste, große Karte) und die Detailansicht.
import { fn, rpc } from "./api.js";
import { ago, clear, h, icon, openSheet, toast } from "./lib.js";
import { emit, S } from "./state.js";

const EVENT_LABELS = {
  leadership: "Führungswechsel", election: "Wahl", death: "Todesfall", war: "Konflikt", disaster: "Unglück",
  ma: "Übernahme", market_move: "Kursbewegung", earnings: "Geschäftszahlen", legal: "Recht & Regulierung",
  product: "Ankündigung", analyst: "Analysten", price: "Kursalarm",
};

function img(src, cls) {
  if (!src || !/^https:\/\//.test(src)) return null;
  const el = h("img", { class: cls, src, alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" });
  el.addEventListener("error", () => el.remove());
  return el;
}

export function kicker(s, { isNew = false, time = true } = {}) {
  const parts = [];
  if (isNew) parts.push(h("span", { class: "new", title: "Neu seit deinem letzten Besuch" }));
  const t = s.topics?.[0];
  if (t) parts.push(h("span", { class: "topic" }, `${t.emoji ? t.emoji + " " : ""}${t.name}`));
  else if (s.event && EVENT_LABELS[s.event]) parts.push(h("span", { class: "topic" }, EVENT_LABELS[s.event]));
  if (s.source) {
    if (parts.length > (isNew ? 1 : 0)) parts.push(h("span", { class: "sep" }, "·"));
    parts.push(h("span", null, s.source));
  }
  if (s.sources > 1) parts.push(h("span", { class: "muted" }, `+${s.sources - 1}`));
  if (time) {
    parts.push(h("span", { class: "sep" }, "·"));
    parts.push(h("span", { class: "muted" }, ago(s.at)));
  }
  return h("div", { class: "kicker" }, parts);
}

function isNewStory(s, lastSeen) {
  return !!lastSeen && !s.read && new Date(s.at) > new Date(lastSeen);
}

export function storyRow(s, { compact = false, lastSeen = null } = {}) {
  const el = h("button", { class: "story" + (compact ? " compact" : "") + (s.read ? " read" : ""), type: "button", dataset: { id: s.id } },
    h("div", { class: "body" },
      kicker(s, { isNew: isNewStory(s, lastSeen) }),
      h("h3", null, s.title),
      !compact && s.summary ? h("p", { class: "sum" }, s.summary) : null),
    !compact ? img(s.image, "thumb") : null);
  el.addEventListener("click", () => { el.classList.add("read"); openStory(s.id, s); });
  return el;
}

export function leadCard(s, { lastSeen = null } = {}) {
  const el = h("button", { class: "lead" + (s.read ? " read" : ""), type: "button", dataset: { id: s.id } },
    img(s.image, "pic"),
    h("div", { class: "inner" },
      kicker(s, { isNew: isNewStory(s, lastSeen) }),
      h("h3", null, s.title),
      s.summary ? h("p", { class: "sum" }, s.summary) : null));
  el.addEventListener("click", () => { el.classList.add("read"); openStory(s.id, s); });
  return el;
}

export function skeleton(n = 5) {
  return h("div", { "aria-hidden": "true" }, Array.from({ length: n }, () =>
    h("div", { class: "sk-row" }, h("div", { class: "l" }, h("i", { class: "sk" }), h("i", { class: "sk" }), h("i", { class: "sk" })), h("div", { class: "sk th" }))));
}

const FB = [
  { v: 2, e: "🔥", label: "Sofort wissen", msg: "Verstanden: So etwas bekommst du künftig eher als Push." },
  { v: 1, e: "👍", label: "Interessant", msg: "Gemerkt: mehr davon." },
  { v: -1, e: "👎", label: "Egal", msg: "Gemerkt: weniger davon.", neg: true },
  { v: -2, e: "⛔", label: "Nie wieder", msg: "Verstanden: So etwas zeige ich dir möglichst nicht mehr.", neg: true },
];

function applyLocal(id, patch) {
  const lists = [S.today?.top, S.today?.foryou, S.today?.more, S.ticker.items, S.saved].filter(Boolean);
  for (const l of lists) for (const s of l) if (s.id === id) Object.assign(s, patch);
}

export function openStory(id, preview = null) {
  let data = preview ? { ...preview } : null;
  openSheet({
    title: "",
    onClose: () => emit("story-closed", id),
    render: async (body, api) => {
      const root = h("div", { class: "detail" });
      body.append(root);
      const draw = () => {
        if (!data) return clear(root, h("div", { class: "center" }, h("span", { class: "spin" })));
        const s = data;
        const t = s.topics?.[0];
        const fbRow = h("div", { class: "fb" }, FB.map((f) => h("button", {
          type: "button", class: (s.fb === f.v ? "on " : "") + (f.neg ? "neg" : ""), "aria-pressed": String(s.fb === f.v),
          onclick: async () => {
            const next = s.fb === f.v ? null : f.v;
            const before = s.fb;
            s.fb = next; draw();
            try {
              const r = await rpc("set_feedback", { p_id: s.id, p_value: next });
              applyLocal(s.id, { fb: next, read: true });
              let msg = next == null ? "Rückmeldung entfernt." : f.msg;
              if (r?.adjust > 0) msg = "Verstanden: Für so etwas bekommst du seltener einen Push.";
              toast(msg);
            } catch (e) {
              s.fb = before; draw(); toast(e.message);
            }
          },
        }, h("span", { class: "e" }, f.e), f.label)));

        const saveBtn = h("button", { class: "btn", type: "button", onclick: async () => {
          try {
            s.saved = await rpc("toggle_saved", { p_id: s.id });
            applyLocal(s.id, { saved: s.saved });
            S.saved = null;
            draw();
            toast(s.saved ? "Gemerkt." : "Nicht mehr gemerkt.");
          } catch (e) { toast(e.message); }
        } }, icon("saved"), s.saved ? "Gemerkt ✓" : "Merken");

        const shareBtn = h("button", { class: "btn", type: "button", onclick: async () => {
          const url = s.url || location.href;
          try {
            if (navigator.share) await navigator.share({ title: s.title, url });
            else { await navigator.clipboard.writeText(url); toast("Link kopiert."); }
          } catch { /* abgebrochen */ }
        } }, icon("share"), "Teilen");

        const arts = s.articles ?? [];
        clear(root,
          img(s.image, "pic"),
          h("div", { class: "kicker" },
            s.tier === 3 ? h("span", { class: "badge hot" }, s.kind === "price" ? "Kursalarm" : "Wichtig") : null,
            t ? h("span", { class: "topic" }, `${t.emoji ? t.emoji + " " : ""}${t.name}`) : null,
            s.event && EVENT_LABELS[s.event] && s.kind !== "price" ? h("span", { class: "badge soft" }, EVENT_LABELS[s.event]) : null),
          h("h1", null, s.title),
          h("div", { class: "meta" }, [s.source, ago(s.at), s.sources > 1 ? `${s.sources} Quellen` : null].filter(Boolean).join(" · ")),
          (s.summary_ai || s.summary_full || s.summary) ? h("p", { class: "summary" }, s.summary_ai || s.summary_full || s.summary) : null,
          s.summary_ai ? h("div", { class: "ai-note" }, "✨ Von der KI zusammengefasst – Einzelheiten im Originalartikel.") : null,
          s.url ? h("a", { class: "btn primary block", href: s.url, target: "_blank", rel: "noopener noreferrer", style: { marginTop: "14px" } }, s.kind === "price" ? "Kurs ansehen" : "Artikel öffnen", icon("ext")) : null,
          h("div", { class: "actions2" }, saveBtn, shareBtn),
          h("h4", null, "War das interessant?"),
          fbRow,
          arts.length > 1 ? [h("h4", null, `${arts.length} Quellen berichten`), h("div", { class: "srcs" }, arts.map((a) =>
            h("a", { href: a.url, target: "_blank", rel: "noopener noreferrer" }, h("span", { class: "p" }, a.publisher || "Quelle"), h("span", { class: "tt" }, a.title), h("span", { class: "tm" }, ago(a.at)))))] : null,
          s.reasons?.length || s.imp != null ? [
            h("h4", null, "Warum siehst du das?"),
            h("div", { class: "reasons" }, (s.reasons ?? []).map((r) => h("span", { class: "badge soft" }, r)), s.pushed ? h("span", { class: "badge accent" }, "Als Push gesendet") : null),
            s.imp != null ? [h("div", { class: "help", style: { marginTop: "12px" } }, `Wichtigkeit ${s.imp} von 100`), h("div", { class: "meter" }, h("i", { style: { width: `${Math.max(3, Math.min(100, s.imp))}%` } }))] : null,
          ] : null,
        );
      };
      draw();
      try {
        const full = await rpc("story_detail", { p_id: Number(id) });
        if (!full) {
          clear(root, h("div", { class: "empty" }, h("div", { class: "big" }, "🗞️"), h("strong", null, "Meldung nicht mehr vorhanden"), "Ältere Meldungen werden nach einigen Tagen entfernt."));
          return;
        }
        data = full;
        applyLocal(full.id, { read: true });
        draw();
      } catch (e) {
        if (!data) clear(root, h("div", { class: "empty" }, h("div", { class: "big" }, "⚠️"), h("strong", null, "Konnte nicht geladen werden"), e.message));
      }
    },
  });
}

export { EVENT_LABELS, fn };
