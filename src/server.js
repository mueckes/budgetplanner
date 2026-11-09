const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 1. Projekte abrufen oder erstellen
app.get('/api/projects', (req, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  res.json(projects);
});

app.post('/api/projects', (req, res) => {
  const { name, description } = req.body;
  const insert = db.prepare('INSERT INTO projects (name, description) VALUES (?, ?)');
  const result = insert.run(name, description || '');
  res.json({ id: result.lastInsertRowid, name, description });
});

// 2. Gesamtes Projekt inklusive Kategorien, Items & Aggregationen laden
app.get('/api/projects/:id', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Projekt nicht gefunden' });

  const categories = db.prepare('SELECT * FROM categories WHERE project_id = ? ORDER BY sort_order, id').all(project.id);
  const items = db.prepare(`
    SELECT b.* FROM budget_items b
    JOIN categories c ON b.category_id = c.id
    WHERE c.project_id = ?
    ORDER BY b.due_date ASC, b.id ASC
  `).all(project.id);

  // Kategorien mit Items verknüpfen
  const structuredCategories = categories.map(cat => ({
    ...cat,
    items: items.filter(item => item.category_id === cat.id)
  }));

  // Aggregationen (Min, Erwartet, Max) berechnen
  const totalMin = items.reduce((acc, i) => acc + (Number(i.cost_min) || 0), 0);
  const totalExpected = items.reduce((acc, i) => acc + (Number(i.cost_expected) || 0), 0);
  const totalMax = items.reduce((acc, i) => acc + (Number(i.cost_max) || 0), 0);

  res.json({
    project,
    categories: structuredCategories,
    summary: { totalMin, totalExpected, totalMax }
  });
});

// 3. Kategorie anlegen
app.post('/api/categories', (req, res) => {
  const { projectId, name } = req.body;
  const insert = db.prepare('INSERT INTO categories (project_id, name) VALUES (?, ?)');
  const result = insert.run(projectId, name);
  res.json({ id: result.lastInsertRowid, projectId, name });
});

// 4. Posten anlegen
app.post('/api/items', (req, res) => {
  const { categoryId, name, url, dueDate, costMin, costExpected, costMax } = req.body;
  const insert = db.prepare(`
    INSERT INTO budget_items (category_id, name, url, due_date, cost_min, cost_expected, cost_max)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = insert.run(
    categoryId,
    name,
    url || '',
    dueDate || '',
    Number(costMin) || 0,
    Number(costExpected) || 0,
    Number(costMax) || 0
  );
  res.json({ id: result.lastInsertRowid });
});

// Posten aktualisieren (Inline-Editing)
app.put('/api/items/:id', (req, res) => {
  const { name, url, dueDate, costMin, costExpected, costMax } = req.body;
  const update = db.prepare(`
    UPDATE budget_items
    SET name = COALESCE(?, name),
        url = COALESCE(?, url),
        due_date = COALESCE(?, due_date),
        cost_min = COALESCE(?, cost_min),
        cost_expected = COALESCE(?, cost_expected),
        cost_max = COALESCE(?, cost_max)
    WHERE id = ?
  `);
  
  update.run(
    name,
    url,
    dueDate,
    costMin !== undefined ? Number(costMin) : null,
    costExpected !== undefined ? Number(costExpected) : null,
    costMax !== undefined ? Number(costMax) : null,
    req.params.id
  );
  
  res.json({ success: true });
});

// 5. Posten löschen
app.delete('/api/items/:id', (req, res) => {
  db.prepare('DELETE FROM budget_items WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Budgetplanner läuft auf Port ${PORT}`);
});
