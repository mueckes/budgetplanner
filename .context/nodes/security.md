# Sicherheitsstatus – Weiterentwicklung

- Konten bleiben getrennt, Sitzungen verwenden zufällige Tokens und Secure-/HttpOnly-/SameSite-Cookies. Neue Passwort-Hashes nutzen scrypt N=131072, r=8, p=1; ältere Hashes werden bei erfolgreicher Anmeldung umgestellt. Web-Prüfungen sind asynchron und parallel begrenzt.
- Zusätzlich zum kontobezogenen Limit begrenzt die Anwendung Anmeldeversuche je IP. Diese Zähler sind flüchtig und nur pro Prozess wirksam; eine vorgelagerte Begrenzung und die tatsächliche Proxy-IP müssen auf dem Server geprüft werden.
- Das Stylesheet wird lokal bereitgestellt; eine CSP beschränkt externe Ressourcen. Da bestehende Oberflächen Inline-Skripte und -Styles benötigen, erlaubt die CSP noch `unsafe-inline` und ist kein vollständiger XSS-Schutz.
- Der URL-Abruf begrenzt Adressen, Antwortgröße, Dauer und parallele Abrufe. Diese Prüfungen sind keine vollständige SSRF-Garantie; zusätzliche Regressionstests und Netzwerk-Egress-Regeln bleiben sinnvoll.
- Docker basiert auf Node 24 und `npm ci` mit Lockfile. Die Abhängigkeiten müssen regelmäßig geprüft und aktualisiert werden. Image-Build, Nginx-Konfiguration, TLS, Firewall und Backup-Abläufe müssen in der Zielumgebung überprüft werden.
- API-Isolationstests prüfen unter anderem fremde Projekte, CSRF-Header und Konten. Ein separater Test prüft die Backup-API mit `better-sqlite3`; es gibt weiterhin keinen vollständigen Browser- oder Penetrationstest.
- Die App prüft Besitz anhand der Pfade zentral. Beim Hinzufügen neuer ressourcenbezogener Endpunkte sind Besitzprüfungen und Negativtests zwingend zu ergänzen.

