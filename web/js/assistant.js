// KI-Assistent: Chat, der Meldungen erklärt und auf Zuruf den Algorithmus umstellt.
import { fn } from "./api.js";
import { add, clear, h, openSheet, store, toast } from "./lib.js";
import { loadBoot, settings } from "./state.js";

let history = store.get("chat", []);

const IDEAS_GENERAL = ["Was war heute wichtig?", "Ich bekomme zu viele Pushes", "Warum kam der letzte Push?", "Keine Analystenmeinungen mehr"];
const IDEAS_STORY = ["Erklär mir das einfach", "Warum ist das wichtig?", "Mehr davon als Push", "So etwas nicht mehr zeigen"];

export function openAssistant({ story = null } = {}) {
  let busyNow = false;
  // Bei einer Meldung beginnt ein eigenes Gespräch; sonst geht das letzte weiter
  let turns = story ? [] : history.slice(-20);
  openSheet({
    title: story ? "Frag zur Meldung" : "Assistent",
    render: (body, api) => {
      const list = h("div", { class: "chat" });
      const input = h("textarea", { class: "input chat-input", rows: 1, placeholder: story ? "Deine Frage …" : "Schreib mir …", enterkeyhint: "send" });
      const sendBtn = h("button", { class: "btn accent chat-send", type: "button", "aria-label": "Senden" }, "↑");
      const ideas = h("div", { class: "chiprow", style: { margin: "0", padding: "0 0 8px" } });

      const bubble = (t) => h("div", { class: "msg " + t.role },
        h("div", { class: "bubble" }, t.text),
        t.actions?.length ? h("div", { class: "did" }, t.actions.map((a) => h("div", null, "✓ " + a))) : null);

      const draw = () => {
        const out = [];
        if (story) out.push(h("div", { class: "chat-context" }, h("small", null, "Zur Meldung"), h("strong", null, story.title)));
        if (!turns.length) {
          out.push(h("div", { class: "chat-hello" },
            h("div", { class: "big" }, "✨"),
            h("strong", null, story ? "Was möchtest du dazu wissen?" : "Wie kann ich helfen?"),
            h("p", null, story
              ? "Ich erkläre dir die Meldung oder passe an, wie oft du so etwas siehst."
              : "Ich erkläre dir Nachrichten und stelle deine App um. Sag einfach in deinen Worten, was dich stört oder was du willst.")));
        }
        for (const t of turns) out.push(bubble(t));
        if (busyNow) out.push(h("div", { class: "msg assistant" }, h("div", { class: "bubble typing" }, h("i"), h("i"), h("i"))));
        clear(list, out);
        clear(ideas, (!turns.length ? (story ? IDEAS_STORY : IDEAS_GENERAL) : []).map((t) => h("button", { type: "button", class: "chip small scroll", onclick: () => send(t) }, t)));
        ideas.hidden = turns.length > 0;
        requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
      };

      const send = async (text) => {
        text = (text ?? input.value).trim();
        if (!text || busyNow) return;
        if (!settings().has_gemini_key) return toast("Dafür brauchst du die KI-Verbindung (Profil → KI-Einordnung).", { ms: 5000 });
        input.value = "";
        input.style.height = "";
        turns.push({ role: "user", text });
        busyNow = true;
        draw();
        try {
          const r = await fn("assistant", { messages: turns.map((t) => ({ role: t.role, text: t.text })), story_id: story?.id ?? null });
          if (!r.ok) throw new Error(r.error || "Der Assistent ist gerade nicht erreichbar.");
          turns.push({ role: "assistant", text: r.text, actions: r.actions ?? [] });
          if (r.actions?.length) {
            loadBoot().catch(() => {});
            fn("rescore").catch(() => {});
          }
        } catch (e) {
          turns.push({ role: "assistant", text: "Das hat nicht geklappt: " + e.message });
        }
        busyNow = false;
        if (!story) { history = turns.slice(-20); store.set("chat", history); }
        draw();
      };

      input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(120, input.scrollHeight) + "px"; });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
      sendBtn.addEventListener("click", () => send());

      add(body, list);
      api.setFoot(ideas, h("div", { class: "chat-bar" }, input, sendBtn),
        !story && turns.length ? h("button", { class: "chat-reset", type: "button", onclick: () => { turns = []; history = []; store.del("chat"); draw(); } }, "Gespräch leeren") : null);
      draw();
    },
  });
}
