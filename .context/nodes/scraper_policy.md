# URL-Scraper: aktuelles Verhalten

- `POST /api/scrape-url` erfordert ein angemeldetes Konto und den CSRF-Header. Die URL wird mit `URL` geparst; nur HTTP(S) ohne Benutzerinfo ist zulässig.
- `readPublicPage` löst IPv4-Adressen auf, sperrt die im Code aufgeführten privaten und reservierten Bereiche und bindet die Verbindung an eine geprüfte Adresse. IPv6 und HTTP-Weiterleitungen werden nicht unterstützt. DNS und HTTP haben jeweils sechs Sekunden Timeout; die Antwort ist auf 2 MiB begrenzt.
- Cheerio liest zuerst JSON-LD-Produkt-/Angebotsdaten, dann OpenGraph/Twitter-Metadaten und den HTML-Titel. Die Preisverarbeitung erkennt gängige Zahlenformate und lehnt nicht interpretierbare Angaben ab. Währung und komplexe Angebotsstrukturen werden weiterhin nicht zuverlässig erkannt. Preis muss vor Übernahme geprüft werden.
- Shops können den Abruf blockieren oder eine Weiterleitung verlangen. Der Server liefert Fehler als JSON mit Status 500; bei einer Meldung mit 403 erklärt die UI den manuellen Fallback. Name, Preis und Link können weiterhin manuell eingegeben werden.
- Der Scraper begrenzt gleichzeitige Abrufe pro Prozess auf vier; dies ist kein dauerhaftes oder verteiltes Rate-Limit. SSRF-Regressionstests einschließlich IP-Darstellungen, DNS und Redirects fehlen im Repository. Netzwerk-Egress-Regeln wären eine zusätzliche Absicherung.

