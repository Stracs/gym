# Gym

Hannes' Trainings-App. Reines HTML/CSS/JS, keine Abhängigkeit außer `lib/chart.umd.min.js` (Chart.js 4.4.1, lokal, damit es offline läuft).

- Projektseite im Second Brain: `3 Projekte/Gym-App.md` (Script, Log, nächste Schritte)
- Lokal starten: im Second Brain die Vorschau `gym` (Port 8091), oder `python -m http.server 8091` in diesem Ordner
- Daten: `localStorage` Schlüssel `gym.v1`, Fotos in IndexedDB `gym-photos`. Nichts geht ins Netz.
- Offline: `sw.js` (Netz zuerst, sonst Speicher). Bei Änderungen `CACHE` hochzählen.
- Plan (Push / Pull / Beine / Schwächen) steht in `DEFAULT_PLAN` in `app.js` und ist in der App unter „Mehr" änderbar.
- Wochenziele pro Muskel: `WEEK_TARGET` in `app.js`.

Aufs Handy kommt die App erst, wenn sie online liegt (z. B. neben Kompass auf GitHub Pages). Das passiert nur nach Hannes' OK.

## Tests
`node test/logik.test.js` (Rechen-Logik: 1RM, Steigerung, Rekorde, Tagesreihenfolge, Scheiben, Schwächen). Nach jeder Änderung an `app.js` laufen lassen.
