# Spec: Haushaltsbuch

Kleine Web-App ohne Server. Eine Person erfasst ihre Ausgaben im Browser und sieht, wofür das Geld geht.
Stack steht fest: Vite + TypeScript ohne Framework, Vitest (jsdom), Playwright. Keine weiteren Laufzeit-Abhängigkeiten.
Sprache der Oberfläche: Deutsch. Beträge in Euro, Format `1.234,56 €`.

## Features

- **F1 Ausgabe erfassen:** Formular mit Betrag (> 0, max. 2 Nachkommastellen), Kategorie (Lebensmittel, Wohnen, Mobilität, Freizeit, Sonstiges), Datum (Standard heute), Notiz (optional, max. 200 Zeichen). Ungültige Eingaben zeigen eine Fehlermeldung am Feld, nichts wird gespeichert. Gültige Ausgaben erscheinen sofort in der Liste, neueste zuerst. Jede Zeile lässt sich löschen.
- **F2 Speichern:** Ausgaben liegen in `localStorage` und sind nach dem Neuladen noch da. Defekte oder fremde Daten im Speicher führen nicht zum Absturz: die App startet leer und zeigt einen Hinweis.
- **F3 Filtern und Summen:** Filter nach Monat (Standard aktueller Monat) und Kategorie (Standard alle). Darüber die Summe der gefilterten Ausgaben.
- **F4 CSV-Import und -Export:** Export der gefilterten Ausgaben als CSV (`datum;kategorie;betrag;notiz`, Semikolon, UTF-8, Dezimalkomma). Import einer solchen Datei: gültige Zeilen werden übernommen, ungültige werden mit Zeilennummer und Grund gemeldet. Notizen mit Semikolon, Anführungszeichen oder Zeilenumbruch überstehen Export und Import unverändert. Formel-Injection beim Export verhindern (Werte, die mit `= + - @` beginnen).
- **F5 Monatsdiagramm:** Balkendiagramm als SVG ohne Bibliothek: Summe pro Kategorie im gewählten Monat. Leerer Monat zeigt „Keine Ausgaben“.
- **F6 Handy-Ansicht:** Bei 390 px Breite ist alles ohne waagrechtes Scrollen bedienbar.

## Nicht Teil

Konten, Server, Login, Budgets, wiederkehrende Ausgaben, andere Währungen.

## Qualität

- Jedes Feature hat Unit-Tests. Kernabläufe (Erfassen, Neuladen, Import/Export) haben je einen E2E-Test.
- `npm run typecheck`, `npm test`, `npm run build`, `npm run e2e` sind grün.

## Decision policy
Once this spec is approved, the build phase decides by a **reversibility** test.

- **Decide-and-log — two-way doors (no interrupt).** Library/pattern choices inside the stack, internal data shape, naming, file layout: pick the reversible default, record a one-line ADR in `docs/adr/`, keep building. Do not ask.
- **Stop-and-ask — one-way doors (rare, batched).** Only changes to this spec's scope. Batch them into one question at the end.

The spec is approved. The next human touch is the final review.
