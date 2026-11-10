# Konten und Projektzugriff

- Keine öffentliche Registrierung. Der Serveradministrator legt Konten interaktiv im Container an; Passwörter werden gesalzen mit scrypt gespeichert.
- Vor dem Update ein SQLite-Backup erstellen. Bestehende Projekte sind bis zur ausdrücklichen Zuordnung nicht sichtbar.
- Erstes Konto mit Altprojekten: `docker compose exec budgetplanner node src/manage-users.js add BENUTZER --claim-existing`. Dieser Schritt ordnet alle bisherigen nicht zugeordneten Projekte diesem ersten Konto zu. Ohne Altprojekte kann `--claim-existing` weggelassen werden.
- Weitere Konten: `docker compose exec budgetplanner node src/manage-users.js add BENUTZER`. Ein Konto sieht ausschließlich seine eigenen Projekte; ein Import erstellt ein eigenes Projekt.
- Passwort zurücksetzen: `docker compose exec budgetplanner node src/manage-users.js password BENUTZER`; alle bisherigen Sitzungen dieses Kontos werden beendet.
- Unter „Konto“ kann jede Person den eigenen Anzeigenamen und eine optionale E-Mail-Adresse ändern. Die E-Mail-Adresse ist nur ein Kontaktdatum; es gibt keinen Mailversand oder Passwort-Reset per E-Mail.
- Das eigene Passwort kann nach Bestätigung des aktuellen Passworts geändert werden; andere Sitzungen des Kontos werden dabei beendet.
- Anmeldung über HTTPS erforderlich: Das Sitzungs-Cookie ist Secure, HttpOnly und SameSite=Strict; es läuft nach zwölf Stunden ab. Schreibende API-Anfragen benötigen einen zusätzlichen Header als CSRF-Schutz.
- Nginx Basic Auth bleibt eine zusätzliche vorgelagerte Zugangskontrolle; für externe Nutzer muss gegebenenfalls auch dort Zugang erteilt werden. Die bestehende LAN-/VPN-Freigabe ersetzt nicht die neue Anmeldung.
- Jede Projekt-, Kategorie- und Kostenpunkt-Route muss den Besitzer serverseitig prüfen. Cookie-Tokens werden nur als Hash in SQLite gespeichert. Das Limit für fehlgeschlagene Anmeldungen liegt bei zehn Versuchen pro 15 Minuten und Kombination aus Quell-IP und Benutzername und wird beim Neustart zurückgesetzt. Hinter Docker kann die Quell-IP die des Proxys sein.
