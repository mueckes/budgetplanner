# DB Schema (better-sqlite3)

- **users**: `id` (INTEGER PK), `username` (unique, case-insensitive), `password_hash` (scrypt with salt), `created_at`, `display_name` (optional), `email` (optional)
- **sessions**: `token_hash` (SHA-256), `user_id` (FK), `expires_at` (Unix milliseconds)
- **projects**: `id` (INTEGER PK), `name` (TEXT), `description` (TEXT), `created_at` (DATETIME), `budget` (REAL, optional), `archived` (INTEGER, default 0), `owner_id` (FK users.id; old projects remain unassigned until first account claims them)
- **categories**: `id` (INTEGER PK), `project_id` (FK projects.id), `name` (TEXT), `sort_order` (INT)
- **budget_items**: `id` (INTEGER PK), `category_id` (FK categories.id), `name` (TEXT), `url` (TEXT), `due_date` (TEXT ISO), `cost_min` (REAL), `cost_expected` (REAL), `cost_max` (REAL), `status` (planned/ordered/paid), `actual_cost` (REAL, optional), `paid_date` (TEXT ISO, optional), `kind` (expense/income), `bounds_enabled` (0/1)

Fremdschlüssel sind aktiviert; Projekt → Kategorien → Kostenpunkte und Benutzer → Sitzungen verwenden `ON DELETE CASCADE`. `projects.owner_id` ist nullable und hat keinen Lösch-Cascade. Neue Spalten werden beim Start anhand von `table_info` ergänzt; ein versioniertes Migrationssystem existiert nicht. Alte Projekte bleiben ohne Eigentümer, bis das erste Konto sie explizit übernimmt.

Der Projekt-Export verwendet Version 3.0 und enthält Art und Spannenstatus. Import unterstützt 1.0 und 2.0 (Ausgabe, Grenzen aktiv) sowie 3.0. Ein Export umfasst ein Projekt, keine Konten; vollständige Backups siehe BACKUP.md. Importdateien sind auf 10 MiB begrenzt.

Bei der Migration bleiben bestehende Werte als Ausgaben mit aktiven Grenzen erhalten. Neue Einträge legen die Spanne standardmäßig deaktiviert an. Die Geldwerte bleiben REAL; Projektsummen werden auf Cent gerundet.
