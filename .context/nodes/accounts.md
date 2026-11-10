# Konten und Projektzugriff

- Keine öffentliche Registrierung. Der Serveradministrator legt Konten interaktiv im Container an; Passwörter werden gesalzen mit scrypt gespeichert.
- Vor dem Update ein SQLite-Backup erstellen. Bestehende Projekte sind bis zur ausdrücklichen Zuordnung nicht sichtbar.
- Erstes Konto mit Altprojekten: `docker compose exec budgetplanner node src/manage-users.js add BENUTZER --claim-existing`. Dieser Schritt ordnet alle bisherigen nicht zugeordneten Projekte diesem ersten Konto zu. Ohne Altprojekte kann `--claim-existing` weggelassen werden.
- Weitere Konten: `docker compose exec budgetplanner node src/manage-users.js add BENUTZER`. Ein Konto sieht ausschließlich seine eigenen Projekte; ein Import erstellt ein eigenes Projekt.
- Bei der interaktiven Passwortabfrage erscheint die Beschriftung über einer leeren Eingabezeile; während der Eingabe werden keine Zeichen angezeigt.
- Passwort zurücksetzen: `docker compose exec budgetplanner node src/manage-users.js password BENUTZER`; alle bisherigen Sitzungen dieses Kontos werden beendet.
- Unter „Konto“ kann jede Person den eigenen Anzeigenamen und eine optionale E-Mail-Adresse ändern. Die E-Mail-Adresse ist nur ein Kontaktdatum; es gibt keinen Mailversand oder Passwort-Reset per E-Mail.
- Das eigene Passwort kann nach Bestätigung des aktuellen Passworts geändert werden; andere Sitzungen des Kontos werden dabei beendet.
- Anmeldung über HTTPS erforderlich: Das Sitzungs-Cookie ist Secure, HttpOnly und SameSite=Strict; es läuft nach zwölf Stunden ab. Schreibende API-Anfragen benötigen einen zusätzlichen Header als CSRF-Schutz. CORS darf nicht ungeprüft für fremde Origins freigegeben werden.
- Ein externer Nginx kann Basic Auth und Netzfreigaben ergänzen; die tatsächlich laufende Konfiguration liegt außerhalb des Repositorys und muss gesondert geprüft werden. Eine vorgeschaltete Anmeldung ersetzt die Anwendungskonten nicht.
- `src/auth.js` prüft die Besitzerzuordnung für Projekt-, Kategorie- und Kostenpunkt-Routen anhand der Pfade; neue Routen müssen ausdrücklich berücksichtigt und negativ getestet werden. Cookie-Tokens werden nur als SHA-256-Hash in SQLite gespeichert.
- Login und Passwortprüfung nutzen synchrones `scryptSync` mit Node-Standardparametern. Fehlversuche werden pro IP und Benutzername im Speicher auf zehn pro 15 Minuten begrenzt; Neustarts löschen die Zähler. Unterschiedliche Benutzernamen teilen sich kein globales Limit.
- Express vertraut Proxy-Headern nur von Loopback-Adressen. Bei Docker-Bridge-Networking kann die Anwendung statt der tatsächlichen Client-IP eine Gateway-Adresse sehen. Die tatsächliche Proxy-Kette ist vor einer Rate-Limit-Konfiguration zu verifizieren.
- Bekannte Restrisiken und fehlende Prüfungen stehen in `security.md`; die isolierten Tests ersetzen weder Produktionstests noch eine unabhängige Sicherheitsprüfung.
