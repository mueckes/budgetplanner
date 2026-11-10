# Kosten, Einnahmen und Szenarien

- Jeder Eintrag ist eine Ausgabe (`expense`) oder Einnahme (`income`); gespeicherte Beträge sind positiv. Alte Einträge werden bei Migration als Ausgaben mit aktiven Grenzen übernommen. Neue Einträge haben standardmäßig keine aktive Spanne.
- Ohne aktive Min-/Max-Spanne wird der Planwert in allen Szenarien verwendet. Aktive Spannen können über den Eintrag ein- und ausgeschaltet werden. Dabei bleiben gespeicherte Grenzen erhalten; unberührte Standardgrenzen folgen Änderungen des Planwerts. Leere aktive Grenzen übernehmen den Planwert.
- Szenarien zeigen die Nettobelastung: Plan = Ausgabenplan − Einnahmenplan; günstig = Ausgaben-Min − Einnahmen-Max; ungünstig = Ausgaben-Max − Einnahmen-Min. Negative Werte stehen für einen Überschuss. Plan und Übersicht zeigen zusätzlich Einnahmen und Ausgaben separat. Neue und geänderte aktive Grenzen müssen Min ≤ Plan ≤ Max erfüllen; Altbestände bleiben unangetastet.
- Die Prognose verwendet bei `paid` den Ist-Betrag, sonst den Planbetrag, und verrechnet Einnahmen negativ. Der Budgetrest ist Budget minus Nettoprognose und bei fehlendem Budget `null`. Die Fälligkeitsansicht zeigt gruppierte Planbeträge, keine Kontostandsprognose.
- SQLite speichert weiterhin REAL, Projektsummen werden centweise berechnet. Die Anzeige selbst ersetzt keine Buchführung.
- Version 3.0 der Projektdateien sichert Art und Einstellung der Spanne. Ältere Exporte werden als Ausgaben mit aktiver Spanne importiert; Import erzeugt ein eigenes neues Projekt.
