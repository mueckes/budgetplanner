// Isolationstest mit echtem SQLite im Speicher (Node 24); keine Produktionsdaten.
const { DatabaseSync } = require('node:sqlite');
const Module = require('module');
const assert = require('node:assert/strict');
const load = Module._load;
Module._load = function (request, ...args) {
  if (request !== 'better-sqlite3') return load.call(this, request, ...args);
  return class {
    constructor() {
      this.db = new DatabaseSync(':memory:');
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
        all: (...args) => stmt.all(...args), get: (...args) => stmt.get(...args),
        run: (...args) => { const result = stmt.run(...args); return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) }; }
      };
    }
    transaction(fn) { return (...args) => { this.db.exec('BEGIN'); try { const result = fn(...args); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }; }
  };
};
const db = require('../src/db');
const { hashPassword } = require('../src/auth');
const add = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
const a = add.run('anna', hashPassword('beispiel-passwort-anna')).lastInsertRowid;
const b = add.run('bert', hashPassword('beispiel-passwort-bert')).lastInsertRowid;
db.prepare('UPDATE projects SET owner_id = ? WHERE id = 1').run(a);
process.env.PORT = '39072';
require('../src/server');
const base = 'http://127.0.0.1:39072';
async function request(path, method = 'GET', body, cookie, csrf = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (csrf) headers['X-BudgetPlanner'] = '1';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json(), setCookie: res.headers.get('set-cookie'), cookie: res.headers.get('set-cookie')?.split(';')[0] };
}
(async () => {
  assert.equal((await request('/api/projects')).status, 401);
  assert.equal((await request('/api/auth/login', 'POST', { username: 'anna', password: 'falsch' })).status, 401);
  assert.equal((await request('/api/auth/login', 'POST', { username: 'anna', password: 'beispiel-passwort-anna' }, null, false)).status, 403);
  const login = await request('/api/auth/login', 'POST', { username: 'anna', password: 'beispiel-passwort-anna' });
  assert.match(login.setCookie, /HttpOnly/i);
  assert.match(login.setCookie, /Secure/i);
  assert.match(login.setCookie, /SameSite=Strict/i);
  const anna = login.cookie;
  const bert = (await request('/api/auth/login', 'POST', { username: 'bert', password: 'beispiel-passwort-bert' })).cookie;
  assert.ok(anna && bert);
  assert.equal((await request('/api/projects', 'GET', undefined, anna)).data.length, 1);
  assert.equal((await request('/api/projects', 'GET', undefined, bert)).data.length, 0);
  for (const path of ['/api/projects/1', '/api/PROJECTS/%31', '/api/projects/1/export', '/api/projects/1/timeline', '/api/projects/1/completeness']) {
    assert.equal((await request(path, 'GET', undefined, bert)).status, 404, path);
  }
  assert.equal((await request('/api/projects/1', 'DELETE', undefined, bert)).status, 404);
  assert.equal((await request('/api/projects/1', 'PUT', { name: 'Fremd' }, bert)).status, 404);
  assert.equal((await request('/api/projects/1', 'PUT', { name: 'Fremd' }, anna, false)).status, 403);
  assert.equal((await request('/api/categories', 'POST', { projectId: 1, name: 'Fremd' }, bert)).status, 404);
  const category = (await request('/api/categories', 'POST', { projectId: 1, name: 'Eigene' }, anna)).data.id;
  assert.equal((await request('/api/categories/' + category, 'PUT', { name: 'Fremd' }, bert)).status, 404);
  assert.equal((await request('/api/items', 'POST', { categoryId: category, name: 'Fremd', costMin: 1, costExpected: 1, costMax: 1 }, bert)).status, 404);
  const item = (await request('/api/items', 'POST', { categoryId: category, name: 'Eigen', costMin: 1, costExpected: 1, costMax: 1 }, anna)).data.id;
  assert.equal((await request('/api/items/' + item, 'DELETE', undefined, bert)).status, 404);
  assert.equal((await request('/api/items/' + item, 'PUT', { name: 'Fremd' }, bert)).status, 404);
  assert.equal((await request('/api/projects', 'POST', { name: 'Berts Projekt' }, bert)).status, 200);
  const imported = await request('/api/import', 'POST', { version: '1.0', project: { name: 'Import', owner_id: a }, categories: [] }, bert);
  assert.equal(imported.status, 201);
  assert.equal((await request('/api/projects/' + imported.data.id, 'GET', undefined, anna)).status, 404);
  assert.equal((await request('/api/projects/' + imported.data.id, 'GET', undefined, bert)).status, 200);
  assert.equal((await request('/api/auth/profile', 'PUT', { displayName: 'Anna', email: 'falsch' }, anna)).status, 400);
  assert.equal((await request('/api/auth/profile', 'PUT', { displayName: 'Anna Beispiel', email: 'anna@example.org' }, anna)).status, 200);
  assert.equal((await request('/api/auth/me', 'GET', undefined, anna)).data.email, 'anna@example.org');
  assert.equal((await request('/api/auth/me', 'GET', undefined, bert)).data.email, '');
  assert.equal((await request('/api/auth/password', 'PUT', { currentPassword: 'falsch', newPassword: 'neues-passwort-anna' }, anna)).status, 400);
  assert.equal((await request('/api/auth/password', 'PUT', { currentPassword: 'beispiel-passwort-anna', newPassword: 'kurz' }, anna)).status, 400);
  const otherAnna = (await request('/api/auth/login', 'POST', { username: 'anna', password: 'beispiel-passwort-anna' })).cookie;
  assert.equal((await request('/api/auth/password', 'PUT', { currentPassword: 'beispiel-passwort-anna', newPassword: 'neues-passwort-anna' }, anna, false)).status, 403);
  assert.equal((await request('/api/auth/password', 'PUT', { currentPassword: 'beispiel-passwort-anna', newPassword: 'neues-passwort-anna' }, anna)).status, 200);
  assert.equal((await request('/api/auth/me', 'GET', undefined, anna)).status, 200);
  assert.equal((await request('/api/auth/me', 'GET', undefined, otherAnna)).status, 401);
  assert.equal((await request('/api/auth/login', 'POST', { username: 'anna', password: 'beispiel-passwort-anna' })).status, 401);
  assert.equal((await request('/api/auth/login', 'POST', { username: 'anna', password: 'neues-passwort-anna' })).status, 200);
  assert.equal((await request('/api/auth/logout', 'POST', undefined, bert)).status, 200);
  assert.equal((await request('/api/projects', 'GET', undefined, bert)).status, 401);
  console.log('Accounts isolation tests passed');
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
