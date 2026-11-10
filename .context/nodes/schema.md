# DB Schema (better-sqlite3)

- **users**: `id` (INTEGER PK), `username` (unique, case-insensitive), `password_hash` (scrypt with salt), `created_at`
- **sessions**: `token_hash` (SHA-256), `user_id` (FK), `expires_at` (Unix milliseconds)
- **projects**: `id` (INTEGER PK), `name` (TEXT), `description` (TEXT), `created_at` (DATETIME), `budget` (REAL, optional), `archived` (INTEGER, default 0), `owner_id` (FK users.id; old projects remain unassigned until first account claims them)
- **categories**: `id` (INTEGER PK), `project_id` (FK projects.id), `name` (TEXT), `sort_order` (INT)
- **budget_items**: `id` (INTEGER PK), `category_id` (FK categories.id), `name` (TEXT), `url` (TEXT), `due_date` (TEXT ISO), `cost_min` (REAL), `cost_expected` (REAL), `cost_max` (REAL), `status` (planned/ordered/paid), `actual_cost` (REAL, optional), `paid_date` (TEXT ISO, optional)

Fremdschlüssel mit `ON DELETE CASCADE` sind in SQLite aktiviert. Neue Spalten werden beim Start ergänzt; alte Projekte erhalten kein Budget und Posten den Status `planned`. Projektimport erfolgt atomar als neues Projekt. Geldwerte sind weiterhin REAL.
