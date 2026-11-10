# Codex Agent Rules: BudgetPlanner

1. **Graph-First Navigation:**
   - Lies bei Unklarheiten über Zusammenhänge zuerst `.context/graph.yaml`.
   - Lade niemals die gesamte `src/public/index.html` oder `src/server.js`, wenn du nur einen Teilbereich bearbeitest.

2. **On-Demand Node Loading:**
   - Ändert der Task das Datenmodell? -> Lade `.context/nodes/schema.md`.
   - Betrifft es die Schätzlogik? -> Lade `.context/nodes/pert_logic.md`.
   - Betrifft es das Deployment/Nginx? -> Lade `.context/nodes/deployment.md`.

3. **Präzises Patching:**
   - Erzeuge bei Code-Änderungen nur Diffs oder zeige exakte Funktionsblöcke. Wiederhole keine unveränderten 500 Zeilen HTML/JS.

4. **Wissensgraph synchron halten:**
   - Wird ein neuer Endpunkt oder ein neues Tabellenelement hinzugefügt, aktualisiere den entsprechenden Node in `.context/graph.yaml`.
