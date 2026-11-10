# DB Schema (better-sqlite3)

- **projects**: `id` (INTEGER PK), `name` (TEXT), `description` (TEXT), `created_at` (DATETIME)
- **categories**: `id` (INTEGER PK), `project_id` (FK projects.id), `name` (TEXT), `sort_order` (INT)
- **budget_items**: `id` (INTEGER PK), `category_id` (FK categories.id), `name` (TEXT), `url` (TEXT), `due_date` (TEXT ISO), `cost_min` (REAL), `cost_expected` (REAL), `cost_max` (REAL)

Constraint: Kaskadierendes Löschen über App-Transaktionen gesteuert.
