# BudgetPlanner

Projektbasierter Budgetplaner für Docker, Express und SQLite. Die Anwendung ist für den Betrieb hinter einem HTTPS-Reverse-Proxy gedacht; Docker veröffentlicht Port 3000 nur auf localhost.

## Konten einrichten

Vor dem Update eine konsistente SQLite-Sicherung erstellen. Nach dem Start des aktualisierten Containers ein erstes Konto **interaktiv auf dem Server** anlegen:

```bash
docker compose exec budgetplanner node src/manage-users.js add BENUTZER --claim-existing
```

Das Passwort wird zweimal abgefragt und muss mindestens 12 Zeichen lang sein. `--claim-existing` weist alle bisher nicht zugeordneten Projekte ausdrücklich dem ersten Konto zu und ist nur beim ersten Konto erlaubt. Ohne diese Zuordnung sind Altprojekte für Konten nicht sichtbar. Gibt es keine Altprojekte, kann die Option weggelassen werden.

Weitere Konten erhalten keine bestehenden Projekte:

```bash
docker compose exec budgetplanner node src/manage-users.js add BENUTZER
```

Zum Zurücksetzen eines Passworts (bestehende Sitzungen des Kontos werden beendet):

```bash
docker compose exec budgetplanner node src/manage-users.js password BENUTZER
```

Es gibt keine öffentliche Registrierung. Die Anmeldung benötigt HTTPS; Nginx Basic Auth bleibt, falls konfiguriert, ein zusätzlicher Schutz und kann extern eine zweite Anmeldung erfordern. Bestehende LAN-/VPN-Ausnahmen für Nginx umgehen die Kontoanmeldung nicht.

## Tests

Die isolierten API-Tests `tests/smoke-node-sqlite.js` und `tests/accounts-node-sqlite.js` benötigen Node 24 mit `node:sqlite` und installierte Projektabhängigkeiten. Sie nutzen eine SQLite-Datenbank im Speicher und berühren keine Produktionsdaten.
