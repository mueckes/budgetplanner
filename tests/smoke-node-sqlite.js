// Smoke test with Node 24's SQLite adapter; production continues to use better-sqlite3.
const { DatabaseSync } = require('node:sqlite');
const Module = require('module');
const assert = require('node:assert/strict');
const originalLoad = Module._load;
Module._load = function (request, ...args) {
  if (request !== 'better-sqlite3') return originalLoad.call(this, request, ...args);
  return class TestDatabase {
    constructor() {
      this.db = new DatabaseSync(':memory:');
      // Simulate a database created before these migrations.
      this.db.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT, created_at TEXT);
        CREATE TABLE categories (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, name TEXT NOT NULL, sort_order INTEGER DEFAULT 0, FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE);
        CREATE TABLE budget_items (id INTEGER PRIMARY KEY, category_id INTEGER NOT NULL, name TEXT NOT NULL, url TEXT, due_date TEXT, cost_min REAL NOT NULL DEFAULT 0, cost_expected REAL NOT NULL DEFAULT 0, cost_max REAL NOT NULL DEFAULT 0, FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE CASCADE);
        INSERT INTO projects (id, name) VALUES (1, 'Altbestand');`);
    }
    pragma(sql) { return this.db.prepare('PRAGMA ' + sql).all(); }
    exec(sql) { return this.db.exec(sql); }
    prepare(sql) {
      const stmt = this.db.prepare(sql);
      return {
        all: (...args) => stmt.all(...args),
        get: (...args) => stmt.get(...args),
        run: (...args) => { const result = stmt.run(...args); return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) }; }
      };
    }
    transaction(fn) { return (...args) => { this.db.exec('BEGIN'); try { const result = fn(...args); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }; }
  };
};
process.env.PORT = '39071';
require('../src/server');
const base = 'http://127.0.0.1:39071';
async function request(path, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
(async () => {
  assert.equal((await fetch(base + '/')).headers.get('cache-control'), 'no-store');
  const old = await request('/api/projects/1');
  assert.equal(old.data.project.budget, null);
  assert.equal((await request('/api/projects', 'POST', { name: 'Ohne Budget' })).status, 200);
  const created = await request('/api/projects', 'POST', { name: 'Test', template: 'moving', budget: 100 });
  const id = created.data.id;
  let project = (await request('/api/projects/' + id)).data;
  assert.ok(project.categories.length > 0);
  const categoryId = project.categories[0].id;
  const item = await request('/api/items', 'POST', { categoryId, name: 'Transport', costMin: 10, costExpected: 40, costMax: 60 });
  assert.equal((await request('/api/items/' + item.data.id, 'PUT', { status: 'paid' })).status, 400);
  assert.equal((await request('/api/items/' + item.data.id, 'PUT', { paidDate: '2026-02-30' })).status, 400);
  assert.equal((await request('/api/items/' + item.data.id, 'PUT', { status: 'paid', actualCost: 30, paidDate: '2026-11-10' })).status, 200);
  project = (await request('/api/projects/' + id)).data;
  assert.equal(project.summary.forecast, 30);
  assert.equal(project.summary.remaining, 70);
  const exported = (await request('/api/projects/' + id + '/export')).data;
  const imported = await request('/api/import', 'POST', exported);
  assert.equal(imported.status, 201);
  const restored = (await request('/api/projects/' + imported.data.id)).data;
  assert.equal(restored.categories[0].items[0].actual_cost, 30);
  const legacy = { ...exported, version: '1.0', project: { name: 'Altimport' }, categories: exported.categories.map(cat => ({ ...cat, items: cat.items.map(({ status, actual_cost, paid_date, ...item }) => item) })) };
  assert.equal((await request('/api/import', 'POST', legacy)).status, 201);
  assert.equal((await request('/api/import', 'POST', { ...exported, categories: [{ name: 'x', items: [{}] }] })).status, 400);
  assert.equal((await request('/api/categories/' + categoryId, 'PUT', { name: 'Neu', sortOrder: 3 })).status, 200);
  assert.equal((await request('/api/projects/' + id, 'PUT', { archived: 1, budget: null })).status, 200);
  assert.equal((await request('/api/projects/' + id, 'DELETE')).status, 200);
  assert.equal((await request('/api/projects/' + id)).status, 404);
  console.log('Smoke tests passed');
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
