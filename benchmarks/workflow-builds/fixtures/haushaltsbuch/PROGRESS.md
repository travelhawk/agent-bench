# Progress: Haushaltsbuch

## Features (from docs/SPEC.md)

- [ ] F1 — Ausgabe erfassen — **T2** (Eingabevalidierung, Kernablauf) — gültige Ausgabe erscheint, ungültige wird mit Feldfehler abgelehnt, Löschen geht
- [ ] F2 — Speichern — **T2** (persistierter Zustand, defekte Daten) — Daten überleben Reload, defekter Speicher führt nicht zum Absturz
- [ ] F3 — Filtern und Summen — **T3** (reine Anzeige) — Monat/Kategorie-Filter und Summe stimmen
- [ ] F4 — CSV-Import und -Export — **T1** (Parser für fremde Eingaben, Formel-Injection) — Rundreise verlustfrei, Fehlerzeilen gemeldet, Injection entschärft
- [ ] F5 — Monatsdiagramm — **T3** (reine Anzeige) — Balken pro Kategorie, leerer Monat mit Hinweis
- [ ] F6 — Handy-Ansicht — **T3** (Layout) — 390 px ohne waagrechtes Scrollen

## Health

- Tests: 1 Unit, 1 E2E grün (Start-Repo)
- Known issues: keine

## Next session should

Alle Features F1–F6 bauen.

## Session log (append-only, newest first)
