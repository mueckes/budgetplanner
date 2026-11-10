# Sicherheitsstatus – Quellcodeprüfung 2026-11-10

Grundlage: `main`-Commit `48e92b1210d4bbea408a9d5a6fb3eedcc842f4ce`. Keine Prüfung der live laufenden Nginx-, Firewall-, TLS- oder Backup-Konfiguration; keine unabhängige Penetrationsprüfung.

## Vorhandene Schutzmaßnahmen

- Getrennte Konten mit scrypt-Salt, zufälligen Sitzungstokens (nur SHA-256-Hash in SQLite), Secure-/HttpOnly-/SameSite-Strict-Cookie und Besitzprüfung in `src/auth.js`.
- Schreibende API-Aufrufe benötigen einen anwendungsspezifischen Header; wirksam als Browser-CSRF-Barriere nur solange keine fremden Origins diesen Header per CORS zulassen.
- URL-Scraper prüft IPv4-Ziele, bindet DNS-Ergebnisse an die Verbindung, lehnt Redirects ab und begrenzt Antwortgröße und Laufzeit. Er ist nur nach Anmeldung erreichbar.
- Eingabewerte werden vielfach validiert, Datenbankabfragen nutzen vorbereitete Statements; Link-Protokolle werden bei der Ausgabe auf HTTP(S) eingeschränkt.

## Nachgewiesene Grenzen / Prioritäten

1. `node:20-alpine` ist eine EOL-Laufzeit. Auf unterstütztes LTS wechseln und insbesondere `better-sqlite3` im echten Image prüfen.
2. Anmelde-Hashes verwenden Node-scrypt-Standardparameter N=16384, r=8, p=1 und synchrone Berechnung. Prüfen und versioniert migrieren: OWASP empfiehlt stärkere scrypt-Parameter; synchrone Berechnung blockiert den Event-Loop.
3. Fehlversuchslimit gilt pro IP und Benutzername, wird beim Neustart gelöscht und verhindert keine verteilten Versuche oder viele unterschiedliche Namen. Proxy-Quell-IP und vorgelagerte Nginx-Limits sind zu prüfen.
4. Die authentisierte Oberfläche lädt ungepinnten ausführbaren Code von `cdn.tailwindcss.com`; der Drittanbieter liegt damit in der Vertrauensgrenze. Tailwind lokal zur Buildzeit erzeugen und CSP schrittweise prüfen; laufende Nginx-Header sind nicht untersucht.
5. SSRF-Sperren, Proxy-Konfiguration, Wiederherstellung und Browser-Flows besitzen keine vollständige automatisierte Sicherheits-/Integrationstestabdeckung. Vor Produktionsfreigaben Isolationstests mit echter `better-sqlite3`-Datenbank und Docker ergänzen.

Die vorhandenen Tests prüfen unter anderem fremde Projektzugriffe, CSRF-Header, Cookie-Merkmale und Passwortwechsel mit einem Node-24-SQLite-Adapter. Sie sind kein Nachweis für alle Pfade oder den laufenden Server.
