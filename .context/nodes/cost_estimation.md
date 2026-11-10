# Kosten- und Budgetberechnung

- Pro Kostenpunkt werden `cost_min`, `cost_expected` und `cost_max` getrennt gespeichert. Die API summiert sie je Projekt; ein gewichteter PERT-Erwartungswert oder Wahrscheinlichkeitsmodell wird nicht berechnet.
- Beim manuellen Anlegen werden leere Grenzen beim Speichern mit 90 % bzw. 115 % des Planwerts gefüllt. Beim Produktabruf setzt das Frontend 95 % bzw. 110 % des gefundenen Preises; Vorschläge werden mit 80 % bzw. 130 % angelegt.
- Die Prognose verwendet bei `paid` den erfassten Ist-Betrag, sonst den Planbetrag. `actual` summiert alle erfassten Ist-Beträge unabhängig vom Status. `remaining` ist Budget minus Prognose und bei fehlendem Budget `null`.
- Die Monatsansicht gruppiert die geplanten Beträge nach Fälligkeitsmonat, einschließlich bezahlter Kostenpunkte und undatierter Einträge. Sie berechnet weder Kontostand noch Einnahmen und ist keine Liquiditätsprognose.
- Projektsummen werden in Cent gerundet und addiert. Die Datenbank speichert weiterhin REAL; Monats- und Darstellungssummen sind noch nicht vollständig auf Cent-Arithmetik umgestellt. Die API erzwingt Min ≤ Plan ≤ Max nicht: Insbesondere bei einzelnen Inline-Änderungen müsste ein gemeinsamer Bearbeitungsdialog eingeführt werden. Ungültige Inline-Beträge werden abgelehnt; deutsche Kommawerte und Tausenderpunkte mit Nachkommastellen werden erkannt.

