const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, '../data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(path.join(dbDir, 'budget.sqlite'));
db.pragma('foreign_keys = ON');

// Tabellen initialisieren
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS budget_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    url TEXT,
    due_date TEXT,
    cost_min REAL NOT NULL DEFAULT 0,
    cost_expected REAL NOT NULL DEFAULT 0,
    cost_max REAL NOT NULL DEFAULT 0,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
  );
`);

// Bestehende Datenbanken schrittweise erweitern, ohne vorhandene Werte zu verändern.
for (const [table, column, definition] of [
  ['projects', 'budget', 'REAL'], ['projects', 'archived', 'INTEGER NOT NULL DEFAULT 0'],
  ['budget_items', 'status', "TEXT NOT NULL DEFAULT 'planned'"],
  ['budget_items', 'actual_cost', 'REAL'], ['budget_items', 'paid_date', 'TEXT']
]) {
  if (!db.pragma(`table_info(${table})`).some(field => field.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

module.exports = db;
