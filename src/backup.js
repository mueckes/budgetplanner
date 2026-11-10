// Konsistente SQLite-Sicherung: docker compose exec budgetplanner node src/backup.js
const fs = require('fs');
const path = require('path');
const db = require('./db');
const directory = path.join(__dirname, '../data/backups');
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const name = `budget-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`;
const target = path.join(directory, name);
db.backup(target).then(() => {
  fs.chmodSync(target, 0o600);
  console.log(`Sicherung erstellt: ${target}`);
}).catch(error => { console.error('Sicherung fehlgeschlagen:', error.message); process.exitCode = 1; });

