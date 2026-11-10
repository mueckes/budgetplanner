# Sicherung und Wiederherstellung

Die Projektexporte enthalten jeweils nur ein Projekt. Für eine vollständige Sicherung aller Konten und Projekte auf dem Server:

```sh
docker compose exec budgetplanner node src/backup.js
```

Die konsistente SQLite-Kopie liegt unter `data/backups/`. Zusätzlich regelmäßig an einen getrennten, geschützten Ort kopieren und den Zugriff einschränken: Sie enthält persönliche Daten und Passwort-Hashes. Die Datei nicht in Git hochladen. Nur eine Kopie auf demselben Laufwerk schützt nicht vor dessen Ausfall.

Wiederherstellung nach Prüfung der Sicherung, bei gestoppter Anwendung (Dateinamen ersetzen):

```sh
docker compose stop budgetplanner
cp -a data/budget.sqlite data/budget.sqlite.vor-wiederherstellung
cp data/backups/DATEINAME.sqlite data/budget.sqlite
docker compose up -d budgetplanner
```

Vorher sicherstellen, dass die Sicherungsdatei existiert und lesbar ist. Die Schritte ersetzen den aktuellen Datenstand. Eine Wiederherstellung zuerst auf einer getrennten Testinstallation ausprobieren. Falls SQLite-WAL-Dateien vorhanden sind, die Datenbank nicht durch bloßes Kopieren im laufenden Betrieb sichern; diese Anleitung verwendet für die laufende Sicherung die SQLite-Backup-API. Während der Wiederherstellung müssen alle Prozesse, die die Datenbank benutzen, gestoppt sein; ggf. alte `budget.sqlite-wal` und `budget.sqlite-shm` nach deren Sicherung entfernen, bevor die Sicherung eingespielt wird.

