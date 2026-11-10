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
  const result = spawnSync(process.execPath, [path.join(root, 'src/backup.js')], {
    encoding: 'utf8', env: { ...process.env, NODE_PATH: path.join(__dirname, '../node_modules') }
  });
  assert.equal(result.status, 0, result.stderr);
  const files = fs.readdirSync(path.join(root, 'data/backups'));
  assert.equal(files.length, 1);
  const backup = new Database(path.join(root, 'data/backups', files[0]), { readonly: true });
  assert.equal(backup.pragma('integrity_check', { simple: true }), 'ok');
  assert.ok(backup.prepare("SELECT name FROM sqlite_master WHERE name = 'users'").get());
  backup.close();
  console.log('Native SQLite backup test passed');
} finally { fs.rmSync(root, { recursive: true, force: true }); }

