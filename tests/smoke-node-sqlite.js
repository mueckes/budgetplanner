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
        INSERT INTO projects (id, name) VALUES (1, 'Altbestand');
        INSERT INTO categories (id, project_id, name) VALUES (1, 1, 'Alt');
        INSERT INTO budget_items (id, category_id, name, cost_min, cost_expected, cost_max) VALUES (1, 1, 'Alt', 10, 20, 30);`);
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
const db = require('../src/db');
const { hashPassword } = require('../src/auth');
const userId = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('tester', hashPassword('test-passwort-sicher')).lastInsertRowid;
db.prepare('UPDATE projects SET owner_id = ? WHERE id = 1').run(userId);
process.env.PORT = '39071';
require('../src/server');
const base = 'http://127.0.0.1:39071';
let cookie = '';
async function request(path, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-BudgetPlanner': '1', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  return { status: response.status, data: await response.json() };
}
(async () => {
  const page = await fetch(base + '/');
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await request('/api/auth/login', 'POST', { username: 'tester', password: 'test-passwort-sicher' })).status, 200);
  const old = await request('/api/projects/1');
  assert.equal(old.data.project.budget, null);
  assert.equal(old.data.categories[0].items[0].kind, 'expense');
  assert.equal(old.data.categories[0].items[0].bounds_enabled, 1);
  assert.equal(old.data.summary.totalMin, 10); assert.equal(old.data.summary.totalMax, 30);
  assert.equal((await request('/api/projects', 'POST', { name: 'Ohne Budget' })).status, 200);
  const created = await request('/api/projects', 'POST', { name: 'Test', template: 'moving', budget: 100 });
  const id = created.data.id;
  let project = (await request('/api/projects/' + id)).data;
  assert.ok(project.categories.length > 0);
  const categoryId = project.categories[0].id;
  const item = await request('/api/items', 'POST', { categoryId, name: 'Transport', costMin: 10, costExpected: 40, costMax: 60 });
  // Gelöschte Grenzen übernehmen den Planwert; explizite Null bleibt eine Eingabe.
  assert.equal((await request('/api/items/' + item.data.id, 'PUT', { costMin: null, costMax: null })).status, 200);
  let costs = (await request('/api/projects/' + id)).data.categories[0].items[0];
  assert.equal(costs.cost_min, 40); assert.equal(costs.cost_max, 40);
  assert.equal((await request('/api/items/' + item.data.id, 'PUT', { costMin: 0, costMax: 0 })).status, 200);
  costs = (await request('/api/projects/' + id)).data.categories[0].items[0];
  assert.equal(costs.cost_min, 0); assert.equal(costs.cost_max, 0);
  assert.equal((await request('/api/items/' + item.data.id, 'PUT', { costMin: null, costMax: null, costExpected: 55 })).status, 200);
  costs = (await request('/api/projects/' + id)).data.categories[0].items[0];
  assert.equal(costs.cost_min, 55); assert.equal(costs.cost_max, 55);
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
  const legacy = { ...exported, version: '1.0', project: { name: 'Altimport' }, categories: exported.categories.map(cat => ({ ...cat, items: cat.items.map(({ status, actual_cost, paid_date, kind, bounds_enabled, ...item }) => item) })) };
  const legacyImport = await request('/api/import', 'POST', legacy);
  assert.equal(legacyImport.status, 201);
  const legacyItem = (await request('/api/projects/' + legacyImport.data.id)).data.categories[0].items[0];
  assert.equal(legacyItem.kind, 'expense'); assert.equal(legacyItem.bounds_enabled, 1);
  assert.equal((await request('/api/import', 'POST', { ...exported, categories: [{ name: 'x', items: [{}] }] })).status, 400);
  assert.equal((await request('/api/categories/' + categoryId, 'PUT', { name: 'Neu', sortOrder: 3 })).status, 200);
  assert.equal((await request('/api/projects/' + id, 'PUT', { archived: 1, budget: null })).status, 200);
  // Ausgaben und Einnahmen: Min/Max bei Einnahmen für Nettoszenarien umkehren.
  const scenario = (await request('/api/projects', 'POST', { name: 'Einnahmen' })).data.id;
  const cat = (await request('/api/categories', 'POST', { projectId: scenario, name: 'Wohnen' })).data.id;
  const expense = await request('/api/items', 'POST', { categoryId: cat, name: 'Neue Kaution', costExpected: 1500 });
  assert.equal(expense.status, 200);
  const income = await request('/api/items', 'POST', { categoryId: cat, name: 'Alte Kaution', kind: 'income', boundsEnabled: 1, costMin: 1000, costExpected: 1200, costMax: 1300 });
  assert.equal(income.status, 200);
  let scenarioData = (await request('/api/projects/' + scenario)).data;
  assert.equal(scenarioData.summary.expenses, 1500); assert.equal(scenarioData.summary.income, 1200);
  assert.equal(scenarioData.summary.totalMin, 200); assert.equal(scenarioData.summary.totalExpected, 300); assert.equal(scenarioData.summary.totalMax, 500);
  let periods = (await request('/api/projects/' + scenario + '/timeline')).data;
  assert.equal(periods[0].totalMin, 200); assert.equal(periods[0].totalMax, 500);
  assert.equal((await request('/api/items/' + income.data.id, 'PUT', { status: 'paid', actualCost: 1100 })).status, 200);
  scenarioData = (await request('/api/projects/' + scenario)).data;
  assert.equal(scenarioData.summary.forecast, 400); assert.equal(scenarioData.summary.actual, -1100);
  const backup = (await request('/api/projects/' + scenario + '/export')).data;
  assert.equal(backup.version, '3.0');
  const copy = await request('/api/import', 'POST', backup);
  assert.equal(copy.status, 201);
  const copied = (await request('/api/projects/' + copy.data.id)).data;
  assert.equal(copied.summary.totalMin, 200); assert.equal(copied.categories[0].items.find(i => i.kind === 'income').bounds_enabled, 1);
  assert.equal((await request('/api/items/' + expense.data.id, 'PUT', { costExpected: 1600 })).status, 200);
  assert.equal((await request('/api/items/' + expense.data.id, 'PUT', { boundsEnabled: 1 })).status, 200);
  assert.equal((await request('/api/items/' + expense.data.id, 'PUT', { boundsEnabled: 0, costExpected: 1500 })).status, 200);
  assert.equal((await request('/api/items/' + income.data.id, 'PUT', { boundsEnabled: 0, costExpected: 1300 })).status, 200);
  scenarioData = (await request('/api/projects/' + scenario)).data;
  assert.equal(scenarioData.summary.totalMin, 200); assert.equal(scenarioData.summary.totalMax, 200);
  assert.equal((await request('/api/items/' + income.data.id, 'PUT', { kind: 'invalid' })).status, 400);
  assert.equal((await request('/api/items', 'POST', { categoryId: cat, name: 'Ungültig', boundsEnabled: 1, costMin: 100, costExpected: 50, costMax: 150 })).status, 400);
  assert.equal((await request('/api/items/' + income.data.id, 'PUT', { boundsEnabled: 2 })).status, 400);
  assert.equal((await request('/api/import', 'POST', { ...backup, categories: [{ name: 'x', items: [{ ...backup.categories[0].items[0], kind: 'invalid' }] }] })).status, 400);
  assert.equal((await request('/api/projects/' + id, 'DELETE')).status, 200);
  assert.equal((await request('/api/projects/' + id)).status, 404);
  console.log('Smoke tests passed');
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
