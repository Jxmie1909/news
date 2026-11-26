# News

Persönliche Nachrichten-App: sammelt Meldungen aus vielen Quellen, bündelt gleiche Ereignisse,
bewertet sie nach deinen Interessen und schickt bei Wichtigem sofort einen Push.

## Aufbau

| Teil | Wo | Wozu |
|---|---|---|
| Web-App | `web/` → GitHub Pages | Oberfläche (lässt sich auf dem iPhone als App installieren) |
| Dienst | `supabase/functions/news/` → Supabase Edge Function | Quellen abrufen, bündeln, bewerten, Push senden |
| Datenbank | `supabase/migrations/` → Supabase | Meldungen, Themen, Einstellungen, Zeitplan (alle 15 Sekunden) |

## Wie eine Meldung zum Push wird

1. Alle 15 Sekunden werden die fälligen Quellen abgerufen (RSS, Nachrichtensuchen zu deinen Themen, Bluesky-Konten von Nachrichtenagenturen, Yahoo-Finanzfeeds).
2. Neue Artikel werden mit ähnlichen Schlagzeilen zu einer Meldung gebündelt.
3. Jede Meldung bekommt eine **Wichtigkeit** (0–100: Art des Ereignisses, Zahl der Quellen, auf Wunsch KI-Einschätzung) und eine **Relevanz** für dich (Themen, Daumen).
4. Liegt die Wichtigkeit über deiner Push-Grenze und passt ein Push-Thema, geht sofort eine Nachricht raus – außer in der Ruhezeit oder wenn das Tageslimit erreicht ist.

## Tests

```bash
bash scripts/local/fresh.sh
```

```bash
node --test tests/unit.test.mjs
```

```bash
node tests/integration.mjs
```

```bash
node tests/e2e.mjs
```

## Wichtige Hinweise

- Der Schlüssel in `web/js/config.js` ist der öffentliche. Er gibt allein auf nichts Zugriff; geschützt ist alles über die Anmeldung.
- Es gibt genau ein Konto. Weitere Registrierungen werden von der Datenbank abgelehnt.
- Kursdaten (Yahoo Finance) sind inoffiziell und ohne Gewähr. Keine Anlageberatung.
