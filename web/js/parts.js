// Bausteine, die an mehreren Stellen gebraucht werden: KI-Schlüssel, Push auf diesem Gerät, ntfy.
import { fn, updateSettings } from "./api.js";
import { busy, clear, h, isIOS, switchEl, toast } from "./lib.js";
import { disablePush, enablePush, needsInstallFirst, pushStatus, pushSupported } from "./push.js";
import { loadBoot, S, settings } from "./state.js";

/** Eingabe für den Gemini-Schlüssel mit Anleitung. */
export function geminiKeyBox({ onChange } = {}) {
  const root = h("div");
  const draw = () => {
    const s = settings();
    if (s.has_gemini_key) {
      const st = S.boot?.status ?? {};
      const paused = st.llm_paused_until && new Date(st.llm_paused_until) > new Date();
      clear(root,
        h("div", { class: "group" },
          h("div", { class: "row" }, h("span", { class: "e" }, "✨"), h("div", { class: "t" }, h("strong", null, "KI ist verbunden"), h("small", null, `Modell: ${s.llm_model}`)), h("span", { class: "badge " + (paused ? "soft" : "ok") }, paused ? "Pause" : "Aktiv")),
          h("div", { class: "row" }, h("div", { class: "t" }, h("strong", null, "KI-Einordnung nutzen"), h("small", null, "Bewertet Meldungen genauer und fasst sie zusammen.")),
            switchEl(s.llm_enabled, async (v) => { try { await updateSettings({ llm_enabled: v }); await loadBoot(); } catch (e) { toast(e.message); } })),
          st.llm_last_error ? h("div", { class: "row" }, h("div", { class: "t" }, h("small", null, "Hinweis: " + st.llm_last_error))) : null,
          h("div", { class: "row" }, h("div", { class: "t" }, h("small", null, `Heute genutzt: ${st.llm_calls_today ?? 0} von höchstens ${s.llm_daily_budget} Anfragen`)))),
        h("div", { style: { marginTop: "10px" } }, h("button", { class: "btn small danger", onclick: async (e) => {
          busy(e.currentTarget, true);
          try { await fn("remove_key"); await loadBoot(); toast("Schlüssel entfernt."); onChange?.(); draw(); } catch (err) { toast(err.message); draw(); }
        } }, "Schlüssel entfernen")));
      return;
    }
    const input = h("input", { class: "input mono", type: "password", placeholder: "Schlüssel hier einfügen", autocomplete: "off", autocapitalize: "none", spellcheck: false });
    const err = h("div", { class: "error", hidden: true, role: "alert" });
    const btn = h("button", { class: "btn accent block", type: "button", onclick: async () => {
      err.hidden = true;
      const key = input.value.trim();
      if (key.length < 20) { err.textContent = "Bitte füge den vollständigen Schlüssel ein."; err.hidden = false; return; }
      busy(btn, true, "Wird geprüft …");
      try {
        const r = await fn("save_key", { key });
        if (!r.ok) throw new Error(r.error || "Der Schlüssel wurde nicht akzeptiert.");
        await loadBoot();
        toast(r.note ? "Schlüssel gespeichert. " + r.note : "KI verbunden ✨");
        onChange?.();
        draw();
      } catch (e) {
        err.textContent = e.message; err.hidden = false; busy(btn, false);
      }
    } }, "Schlüssel prüfen und speichern");
    clear(root,
      h("ol", { class: "howto" },
        h("li", null, "Öffne ", h("a", { href: "https://aistudio.google.com/apikey", target: "_blank", rel: "noopener noreferrer", style: { color: "var(--accent)", fontWeight: "600" } }, "aistudio.google.com/apikey"), " und melde dich mit deinem Google-Konto an."),
        h("li", null, "Tippe auf ", h("b", null, "API-Schlüssel erstellen"), " und kopiere ihn."),
        h("li", null, "Füge ihn hier ein.")),
      h("label", { class: "field" }, input),
      err, btn,
      h("p", { class: "help" }, "Der Schlüssel wird sicher auf dem Server gespeichert und nie wieder angezeigt. Kostenlos; Google darf Anfragen im kostenlosen Tarif zur Verbesserung nutzen – gesendet werden nur Schlagzeilen und deine Themen."));
  };
  draw();
  return root;
}

/** Push auf diesem Gerät ein-/ausschalten, mit passender Hilfe je nach Lage. */
export function pushBox({ onChange } = {}) {
  const root = h("div");
  const draw = async () => {
    const st = await pushStatus();
    const s = settings();
    if (needsInstallFirst()) {
      return clear(root, h("div", { class: "group" }, h("div", { class: "row col" },
        h("div", { class: "t" }, h("strong", null, "Erst installieren, dann Push"), h("small", null, "Auf dem iPhone funktionieren Push-Nachrichten nur, wenn die App auf dem Home-Bildschirm liegt.")),
        installSteps())));
    }
    if (!st.supported) {
      return clear(root, h("div", { class: "group" }, h("div", { class: "row" }, h("span", { class: "e" }, "🚫"),
        h("div", { class: "t" }, h("strong", null, "Hier nicht verfügbar"), h("small", null, isIOS ? "Bitte iOS 16.4 oder neuer verwenden und die App über den Home-Bildschirm öffnen." : "Dieser Browser unterstützt keine Push-Nachrichten. Nutze unten die Alternative „ntfy“.")))));
    }
    if (st.permission === "denied") {
      return clear(root, h("div", { class: "group" }, h("div", { class: "row" }, h("span", { class: "e" }, "🔕"),
        h("div", { class: "t" }, h("strong", null, "Mitteilungen sind blockiert"), h("small", null, isIOS ? "Öffne Einstellungen → Mitteilungen → News und erlaube Mitteilungen." : "Erlaube Mitteilungen für diese Seite in den Browser-Einstellungen.")))));
    }
    if (st.subscribed) {
      const testBtn = h("button", { class: "btn small accent", type: "button", onclick: async () => {
        busy(testBtn, true);
        try {
          const r = await fn("test_push");
          toast(r.ok ? "Test gesendet – er sollte gleich ankommen." : "Senden fehlgeschlagen: " + (r.error ?? "unbekannt"));
        } catch (e) { toast(e.message); }
        busy(testBtn, false);
      } }, "Test senden");
      return clear(root, h("div", { class: "group" },
        h("div", { class: "row" }, h("span", { class: "e" }, "🔔"), h("div", { class: "t" }, h("strong", null, "Push ist aktiv"), h("small", null, "Dieses Gerät empfängt Nachrichten.")), h("span", { class: "badge ok" }, "Aktiv")),
        h("div", { class: "row" }, testBtn, h("button", { class: "btn small", type: "button", onclick: async (e) => {
          busy(e.currentTarget, true);
          try { await disablePush(); await loadBoot(); onChange?.(); } catch (err) { toast(err.message); }
          draw();
        } }, "Auf diesem Gerät ausschalten"))));
    }
    const btn = h("button", { class: "btn accent block", type: "button", onclick: async () => {
      busy(btn, true);
      try {
        await enablePush(S.boot?.vapid_public_key);
        if (!s.push_enabled) await updateSettings({ push_enabled: true });
        await loadBoot();
        toast("Push eingeschaltet 🔔");
        onChange?.();
      } catch (e) { toast(e.message, { ms: 5000 }); }
      draw();
    } }, "Push-Nachrichten einschalten");
    clear(root, btn, h("p", { class: "help" }, "Dein Gerät fragt gleich nach der Erlaubnis. Bitte „Erlauben“ wählen."));
  };
  draw();
  root._redraw = draw;
  return root;
}

export function installSteps() {
  return h("ol", { class: "howto" },
    h("li", null, "Öffne diese Seite in ", h("b", null, "Safari"), "."),
    h("li", null, "Tippe unten auf ", h("b", null, "Teilen"), " (das Quadrat mit dem Pfeil nach oben)."),
    h("li", null, "Wähle ", h("b", null, "Zum Home-Bildschirm"), " und dann ", h("b", null, "Hinzufügen"), "."),
    h("li", null, "Öffne ", h("b", null, "News"), " über das neue Symbol und schalte hier Push ein."));
}

/** Alternative Zustellung über die App „ntfy“. */
export function ntfyBox() {
  const root = h("div");
  const draw = () => {
    const s = settings();
    clear(root, h("div", { class: "group" },
      h("div", { class: "row" }, h("span", { class: "e" }, "📨"), h("div", { class: "t" }, h("strong", null, "Zusätzlich über ntfy"), h("small", null, "Kostenlose App als zweiter Zustellweg.")),
        switchEl(s.ntfy_enabled, async (v) => { try { await updateSettings({ ntfy_enabled: v }); await loadBoot(); draw(); } catch (e) { toast(e.message); } })),
      s.ntfy_enabled ? h("div", { class: "row col" },
        h("ol", { class: "howto" },
          h("li", null, "Installiere die App ", h("b", null, "ntfy"), " aus dem App Store."),
          h("li", null, "Tippe dort auf ", h("b", null, "+"), " und trage diesen Kanalnamen ein:")),
        h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
          h("code", { class: "mono", style: { flex: "1", background: "var(--surface-2)", padding: "11px 12px", borderRadius: "10px", overflowWrap: "anywhere" } }, s.ntfy_topic),
          h("button", { class: "btn small", onclick: async () => { try { await navigator.clipboard.writeText(s.ntfy_topic); toast("Kopiert."); } catch { toast("Bitte von Hand kopieren."); } } }, "Kopieren")),
        h("p", { class: "help" }, "Halte den Kanalnamen geheim: Wer ihn kennt, kann mitlesen.")) : null));
  };
  draw();
  return root;
}
