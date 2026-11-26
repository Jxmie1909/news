# Übergabe: News-App veröffentlichen

Dieses Projekt wurde in einer früheren Claude-Sitzung vollständig gebaut und lokal getestet.
Es ist **noch nicht online**. Diese Datei beschreibt, was noch zu tun ist. Lies sie ganz, bevor du anfängst.

## Für wen

- Ein einzelner Nutzer, **kein Entwickler**. Bitte auf **Deutsch** und ohne Fachbegriffe antworten.
- iPhone. Die App soll über Safari → „Zum Home-Bildschirm“ installiert werden.
- **Alles muss kostenlos bleiben** (das ist dem Nutzer am wichtigsten). Keine kostenpflichtigen Supabase-Projekte anlegen.
- GitHub: Konto `Jxmie1909`, Repository `news` (öffentlich). GitHub Pages soll die Web-App ausliefern.
- Supabase: Der Nutzer hat eine **kostenlose** Organisation namens **„Jamie“** mit einem Projekt (vermutlich `news`, Region Frankfurt) angelegt.
  Die Organisation „App Org“ ist bezahlt und enthält andere Apps (`planerApp`, `pflegekompass`): **dort nichts anfassen.**
- Der Nutzer hat einen Gemini-Schlüssel. Er soll ihn **in der App** eintragen (Einrichtung, Schritt „Feinschliff“), nie im Chat.

## Was es ist

Siehe `README.md`. Kurz: `web/` = Web-App (ohne Build-Schritt, reines HTML/CSS/JS), `supabase/functions/news/` = ein Dienst für alles
(Abruf im Takt + Aktionen der App), `supabase/migrations/` = Datenbank.

## Schritte zur Veröffentlichung

### 1. Supabase-Projekt finden
`list_projects` → das Projekt in der Organisation „Jamie“. Wenn es nicht sichtbar ist: Der Supabase-Connector ist nur für eine
andere Organisation freigegeben. Dann muss der Nutzer ihn unter https://claude.ai/customize/connectors trennen, neu verbinden und dabei
„Jamie“ auswählen (danach neue Sitzung).

### 2. Datenbank einspielen (Reihenfolge wichtig)
1. `supabase/migrations/20261126000001_init.sql` per `apply_migration`
2. `supabase/migrations/20261126000002_sources.sql`
3. **Noch nicht** die dritte Datei.

Hinweise: Die erste Datei legt einen Trigger auf `auth.users` an (sperrt Registrierungen, sobald es einen Besitzer gibt).
Falls das auf Supabase-Cloud an Rechten scheitert, diesen Block weglassen und dem Nutzer raten, unter
Authentication → Sign In / Providers „Allow new users to sign up“ nach der Einrichtung auszuschalten.

### 3. Dienst einspielen
`deploy_edge_function` mit Name `news`, `entrypoint_path: index.ts`, **`verify_jwt: false`** (der Dienst prüft selbst:
Takt per Geheimnis im Kopf `x-cron-secret`, App-Aktionen per Anmeldung des Besitzers).
Alle `.ts`-Dateien aus `supabase/functions/news/` mitgeben: `index.ts api.ts db.ts feeds.ts http.ts llm.ts prices.ts push.ts score.ts text.ts tick.ts webpush.ts`.
Keine `deno.json` nötig.

### 4. Takt einschalten
```sql
insert into private.secrets (key, value)
values ('function_url', 'https://<PROJEKT-REF>.supabase.co/functions/v1/news')
on conflict (key) do update set value = excluded.value;
```
Dann `supabase/migrations/20261126000003_cron.sql` einspielen (pg_cron alle 15 Sekunden, Aufräumen, pg_net).
Prüfen: `select status_code, count(*) from net._http_response group by 1;` → es müssen laufend `202` hinzukommen.
Solange noch kein Konto angelegt ist, meldet der Dienst `idle` und ruft nichts ab; das ist richtig so.

### 5. Web-App veröffentlichen
1. `web/js/config.js`: `SUPABASE_URL` und `SUPABASE_KEY` eintragen (`get_project_url`, `get_publishable_keys`;
   den alten „anon“-Schlüssel bevorzugen, falls nicht deaktiviert, sonst den `sb_publishable_…`).
2. Nach `main` pushen. `.github/workflows/pages.yml` veröffentlicht den Ordner `web/`.
   Scheitert der Schritt „configure-pages“: Der Nutzer muss einmal im Repository unter Settings → Pages bei „Source“ **GitHub Actions** wählen.
3. Adresse: `https://jxmie1909.github.io/news/`

### 6. Mit dem Nutzer zusammen
1. Er öffnet die Adresse in Safari, legt sein Konto an (E-Mail + Passwort; es wird keine E-Mail verschickt) und geht die Einrichtung durch.
2. Teilen → „Zum Home-Bildschirm“, die App über das Symbol öffnen, im Profil → Push einschalten → „Test senden“.
3. Gemini-Schlüssel in der App eintragen.

### 7. Was nach der Veröffentlichung geprüft werden MUSS (lokal nicht möglich gewesen)
- **Echte Quellen.** Die ~120 Adressen in `…000002_sources.sql` sind aus dem Gedächtnis eingetragen und ungeprüft
  (die Bau-Umgebung hatte keinen Zugriff auf Nachrichtenseiten). Prüfen über die Aktion `probe`:
  ```sql
  select net.http_post(
    url := (select value from private.secrets where key='function_url') || '?action=probe',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from private.secrets where key='cron_secret')),
    body := '{"all": true, "offset": 0, "limit": 40}'::jsonb, timeout_milliseconds := 60000);
  -- danach: select content from net._http_response order by id desc limit 1;
  ```
  (`offset` in 40er-Schritten erhöhen.) Kaputte Adressen in der Tabelle `sources` **und** in der Migrationsdatei korrigieren oder entfernen.
  Besonders unsicher: Bluesky-Kontonamen (`bsky:*`), `rss:finanzen-net`, `rss:handelsblatt`, `rss:wiwo`, `rss:seekingalpha`, `rss:yahoo-finance`,
  `rss:openai`, `rss:heise-ki`, `rss:transfermarkt`, `rss:sport1`, `rss:laut`, `rss:test-de`, `rss:finanztip`.
  Auch prüfen, ob Google News (`gnews:*`) und Yahoo (`yahoo:*`, Kursabfrage in `prices.ts`, Aktiensuche in `api.ts`) von Supabase aus antworten.
- **Zusammenlegen gleicher Meldungen** (`public.ingest`, Regeln „fast deckungsgleich“ und „genügend seltene gemeinsame Wörter“).
  Mit echten Daten ansehen: werden gleiche Ereignisse gebündelt, verschiedene getrennt? Schwellen (0.8 / 1.2 / 0.5) ggf. anpassen.
- **Push auf dem iPhone** (Web-Push, Apple). Der VAPID-„subject“ ist `settings.site_url`; Apple lehnt ungültige Werte ab.
- **Gemini**: Modellname `gemini-flash-lite-latest`; bei 404 sucht der Dienst selbst ein passendes Modell. Kontingentfehler (429) pausieren die KI,
  die App arbeitet dann mit festen Regeln weiter.
- **Supabase-Grenzen**: Takt alle 15 s ≈ 180.000 Funktionsaufrufe/Monat (frei: 500.000). CPU-Zeit je Aufruf und ausgehende Datenmenge im Blick behalten
  (`system_status`, Supabase-Nutzungsseite). `get_advisors` (security) einmal laufen lassen.

## Lokal testen
```bash
bash scripts/local/fresh.sh
```
Braucht lokal: Postgres 16 (`pg_ctlcluster 16 main start`), Docker mit den Images `supabase/gotrue:v2.198.0` und `postgrest/postgrest:v16.6`,
`npm install`. Danach `node --test tests/unit.test.mjs`, `node tests/integration.mjs`, `node tests/e2e.mjs` (alle bestanden am Bautag).
Achtung: `scripts/local/serve.sh` beendet Prozesse per `pkill -f` anhand von Dateinamen. Nie in derselben Befehlszeile ausführen,
in der diese Dateinamen als Text vorkommen (sonst beendet sich die eigene Shell).

## Bekannte Grenzen (dem Nutzer ehrlich gesagt)
- Push kommt etwa 15–90 Sekunden, nachdem eine Meldung in einer überwachten Quelle auftaucht; nicht in Millisekunden.
- Kursdaten von Yahoo Finance sind inoffiziell und ohne Gewähr.
- Kostenlose Kontingente (Supabase, Gemini) können sich ändern.
