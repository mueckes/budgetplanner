# Scraper Policy & Fallback

1. **Schema.org (JSON-LD)**: Suche nach `@type: Product` oder `Offer`. Extrahiere `name` und `offers.price` / `price`.
2. **OpenGraph**: Fallback auf `og:title` und `product:price:amount`.
3. **WAF Protection (403)**: Bei Anti-Bot-Sperren (z. B. Cloudflare/Akamai) gibt das Backend einen 403-Hinweis zurück. Die UI darf nicht crashen, sondern fokussiert das Namensfeld zur Schnelleingabe.
