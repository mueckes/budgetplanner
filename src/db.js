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
  ['projects', 'owner_id', 'INTEGER REFERENCES users(id)'],
  ['budget_items', 'status', "TEXT NOT NULL DEFAULT 'planned'"],
  ['budget_items', 'actual_cost', 'REAL'], ['budget_items', 'paid_date', 'TEXT'],
  // Altbestände behalten ihre vorhandenen Schätzgrenzen; neue Einträge wählen sie ausdrücklich.
  ['budget_items', 'kind', "TEXT NOT NULL DEFAULT 'expense'"],
  ['budget_items', 'bounds_enabled', 'INTEGER NOT NULL DEFAULT 1']
]) {
  if (!db.pragma(`table_info(${table})`).some(field => field.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Konten und Sitzungen bleiben lokal; Klartext-Passwörter und Session-Tokens werden nie gespeichert.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects(owner_id);
  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
`);

// Profilfelder auch bei bereits eingerichteten Konten ergänzen.
for (const [column, definition] of [['display_name', 'TEXT'], ['email', 'TEXT']]) {
  if (!db.pragma('table_info(users)').some(field => field.name === column)) {
    db.exec(`ALTER TABLE users ADD COLUMN ${column} ${definition}`);
  }
}

module.exports = db;
