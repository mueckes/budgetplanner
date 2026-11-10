# Bereitstellung und Betrieb

- Node 24 und npm-Lockfile; `npm ci --omit=dev` im Image. `better-sqlite3` ist eine native Abhängigkeit, deshalb den Image-Build und Start auf dem Zielserver prüfen.
- Port 3000 ist in Compose auf `127.0.0.1` begrenzt. `./data` bleibt dauerhaft eingebunden. Nginx, TLS, Header und Auth-Ausnahmen liegen außerhalb des Repositorys.
- Das Image läuft weiterhin als root, damit vorhandene root-eigene Datenverzeichnisse nicht unerwartet unbeschreibbar werden. Für rootlosen Betrieb müssen zuerst Besitzrechte und Migration auf dem Zielsystem vorbereitet und geprüft werden.
- SQLite-Vollsicherung und Wiederherstellung: `BACKUP.md`. Projekt-JSON ist keine Vollsicherung. Sicherungen extern aufbewahren und Wiederherstellung testen.
- `npm test` führt API-Isolationstests, den nativen SQLite-Backup-Test und Preisparser-Tests aus. GitHub Actions führt diese Tests und den CSS-Build aus. Ein automatisierter Browser- und Docker-Integrationstest steht weiterhin aus.
- Frontend-CSS mit `npm run build:css` nach Änderungen der HTML-Klassen neu erzeugen. CSP erlaubt für die bestehende Oberfläche Inline-Skripte und -Styles.

