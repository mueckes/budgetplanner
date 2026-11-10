# DB Schema (better-sqlite3)

- **users**: `id` (INTEGER PK), `username` (unique, case-insensitive), `password_hash` (scrypt with salt), `created_at`, `display_name` (optional), `email` (optional)
- **sessions**: `token_hash` (SHA-256), `user_id` (FK), `expires_at` (Unix milliseconds)
- **projects**: `id` (INTEGER PK), `name` (TEXT), `description` (TEXT), `created_at` (DATETIME), `budget` (REAL, optional), `archived` (INTEGER, default 0), `owner_id` (FK users.id; old projects remain unassigned until first account claims them)
- **categories**: `id` (INTEGER PK), `project_id` (FK projects.id), `name` (TEXT), `sort_order` (INT)
- **budget_items**: `id` (INTEGER PK), `category_id` (FK categories.id), `name` (TEXT), `url` (TEXT), `due_date` (TEXT ISO), `cost_min` (REAL), `cost_expected` (REAL), `cost_max` (REAL), `status` (planned/ordered/paid), `actual_cost` (REAL, optional), `paid_date` (TEXT ISO, optional)

Fremdschlüssel sind aktiviert; Projekt → Kategorien → Kostenpunkte und Benutzer → Sitzungen verwenden `ON DELETE CASCADE`. `projects.owner_id` ist nullable und hat keinen Lösch-Cascade. Neue Spalten werden beim Start anhand von `table_info` ergänzt; ein versioniertes Migrationssystem existiert nicht. Alte Projekte bleiben ohne Eigentümer, bis das erste Konto sie explizit übernimmt.

Der JSON-Export enthält ein einzelnes Projekt; der validierte Import der Formate 1.0 und 2.0 legt atomar ein neues Projekt des angemeldeten Kontos an. Die Weboberfläche begrenzt Importdateien auf 100.000 Bytes, Express verwendet zusätzlich das Standard-JSON-Limit. Ein vollständiges Export/Import-Roundtrip für große Projekte ist deshalb nicht garantiert. Ein Projekt-Export enthält weder Konten noch Sitzungen und ist kein vollständiges Datenbank-Backup.

Geldwerte sind REAL und Summen JavaScript-Fließkommazahlen; Rundungsabweichungen sind möglich. Eine konkrete Migration auf Cent als Integer muss Altwerte und Backups berücksichtigen.
