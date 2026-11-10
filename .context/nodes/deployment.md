# Bereitstellung und Betrieb

- `Dockerfile` baut derzeit auf `node:20-alpine` und installiert die in `package.json` angegebenen Versionsbereiche mit `npm install --production`. Ein npm-Lockfile existiert nicht. Node.js 20 ist nach dem Node.js-Releaseplan EOL; eine unterstützte LTS-Version und native SQLite-Kompatibilität müssen zusammen getestet werden.
- Compose veröffentlicht Port 3000 nur unter `127.0.0.1` und bindet `./data` nach `/app/data`. Die Anwendung lauscht im Container auf `0.0.0.0`. Ob dieser Port anderweitig erreichbar ist, hängt von der tatsächlichen Host- und Docker-Konfiguration ab.
- TLS, Nginx-Authentifizierung, Header, Weiterleitungen und LAN-/VPN-Ausnahmen sind nicht im Repository definiert. Eine vom Nutzer gezeigte Konfiguration ist eine historische Information und kein Nachweis des gegenwärtigen Serverzustands.
- Das Image setzt keinen nichtprivilegierten `USER`, kein Read-only-Root-Dateisystem und keine Compose-Ressourcenlimits. Änderungen daran benötigen einen Funktionstest der Schreibrechte für `data`.
- Sicherung von `data/budget.sqlite` konsistent mit SQLite-Backup-API oder bei gestoppter Anwendung erstellen; Wiederherstellung separat testen. JSON-Projektexporte sind keine Komplettsicherung der Konten und Sitzungen.
- Die zwei Tests in `tests/` laufen auf Node 24 mit einem `node:sqlite`-Adapter im Speicher, nicht mit produktivem `better-sqlite3` oder Docker. Ein Paket-Testskript, Lockfile, CI und automatische Abhängigkeitsprüfung fehlen.
