// Produktiver SQLite-Treiber und Backup-API mit einer isolierten temporären Datenbank.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'budgetplanner-test-'));
try {
  fs.mkdirSync(path.join(root, 'src'));
  for (const file of ['db.js', 'backup.js']) fs.copyFileSync(path.join(__dirname, '../src', file), path.join(root, 'src', file));
  fs.mkdirSync(path.join(root, 'data'));
  const old = new Database(path.join(root, 'data', 'budget.sqlite'));
  old.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT, created_at TEXT);
    CREATE TABLE categories (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, name TEXT NOT NULL, sort_order INTEGER DEFAULT 0);
    CREATE TABLE budget_items (id INTEGER PRIMARY KEY, category_id INTEGER NOT NULL, name TEXT NOT NULL, url TEXT, due_date TEXT, cost_min REAL NOT NULL DEFAULT 0, cost_expected REAL NOT NULL DEFAULT 0, cost_max REAL NOT NULL DEFAULT 0);
    INSERT INTO projects (id, name) VALUES (1, 'Alt'); INSERT INTO categories (id, project_id, name) VALUES (1, 1, 'Alt');
    INSERT INTO budget_items (id, category_id, name, cost_min, cost_expected, cost_max) VALUES (1, 1, 'Alt', 10, 20, 30);`);
  old.close();
  const result = spawnSync(process.execPath, [path.join(root, 'src/backup.js')], {
    encoding: 'utf8', env: { ...process.env, NODE_PATH: path.join(__dirname, '../node_modules') }
  });
  assert.equal(result.status, 0, result.stderr);
  const files = fs.readdirSync(path.join(root, 'data/backups'));
  assert.equal(files.length, 1);
  const backup = new Database(path.join(root, 'data/backups', files[0]), { readonly: true });
  assert.equal(backup.pragma('integrity_check', { simple: true }), 'ok');
  assert.ok(backup.prepare("SELECT name FROM sqlite_master WHERE name = 'users'").get());
  const item = backup.prepare('SELECT kind, bounds_enabled, cost_min, cost_expected, cost_max FROM budget_items').get();
  assert.equal(item.kind, 'expense'); assert.equal(item.bounds_enabled, 1);
  assert.equal(item.cost_min, 10); assert.equal(item.cost_expected, 20); assert.equal(item.cost_max, 30);
  backup.close();
  console.log('Native SQLite backup test passed');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
