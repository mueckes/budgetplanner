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


// 1. Vollständigkeits-Check / Kostenfallen-Analyse
app.get('/api/projects/:id/completeness', (req, res) => {
  const items = db.prepare(`
    SELECT b.name FROM budget_items b
    JOIN categories c ON b.category_id = c.id
    WHERE c.project_id = ?
  `).all(req.params.id);

  const existingNames = items.map(i => i.name.toLowerCase());

  // Katalog typischer Kostenfallen je nach Kontext
  const checkList = [
    { key: 'halteverbot', label: 'Halteverbotszone (Schilder & Genehmigung)', hint: 'Verhindert Parkstrafen und lange Tragewege beim Umzug.' },
    { key: 'kaution', label: 'Mietkaution / Kautionsbürgschaft', hint: 'Oft müssen 3 Monatskaltmieten vorab fließen, bevor alte Kautionen frei werden.' },
    { key: 'reinigung', label: 'Endreinigung / Putzmittel', hint: 'Kosten für professionelle Teppich-/Endreinigung oder Materialaufwand.' },
    { key: 'puffer', label: 'Unvorhergesehenes / Notfall-Puffer (10%)', hint: 'Schäden, Spontan-Einkäufe im Baumarkt oder Nachzahlungen.' },
    { key: 'nachsendeauftrag', label: 'Nachsendeauftrag & Ummeldung', hint: 'Post-Nachsendeauftrag (ca. 35–45 €) und Gebühren für Personalausweis/Kfz.' },
    { key: 'verpflegung', label: 'Helfer-Verpflegung', hint: 'Getränke, Snacks und Pizza für Umzugshelfer oder Handwerker.' }
  ];

  const missing = checkList.filter(item => {
    return !existingNames.some(name => name.includes(item.key) || name.includes(item.label.toLowerCase().split(' ')[0]));
  });

  res.json({
    totalChecked: checkList.length,
    missingCount: missing.length,
    suggestions: missing
  });
});

// 2. Periodisierung / Cashflow nach Monaten
app.get('/api/projects/:id/timeline', (req, res) => {
  const items = db.prepare(`
    SELECT b.name, b.due_date, b.cost_min, b.cost_expected, b.cost_max, c.name as category_name
    FROM budget_items b
    JOIN categories c ON b.category_id = c.id
    WHERE c.project_id = ?
    ORDER BY b.due_date ASC
  `).all(req.params.id);

  const timeline = {};

  items.forEach(item => {
    let periodKey = 'Ohne Datum';
    if (item.due_date && item.due_date.length >= 7) {
      periodKey = item.due_date.substring(0, 7); // JJJJ-MM
    }

    if (!timeline[periodKey]) {
      timeline[periodKey] = {
        period: periodKey,
        itemsCount: 0,
        totalMin: 0,
        totalExpected: 0,
        totalMax: 0
      };
    }

    timeline[periodKey].itemsCount += 1;
    timeline[periodKey].totalMin += Number(item.cost_min) || 0;
    timeline[periodKey].totalExpected += Number(item.cost_expected) || 0;
    timeline[periodKey].totalMax += Number(item.cost_max) || 0;
  });

  res.json(Object.values(timeline));
});

// 3. JSON Export des gesamten Projekts
app.get('/api/projects/:id/export', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Projekt nicht gefunden' });

  const categories = db.prepare('SELECT * FROM categories WHERE project_id = ?').all(project.id);
  const items = db.prepare(`
    SELECT b.* FROM budget_items b
    JOIN categories c ON b.category_id = c.id
    WHERE c.project_id = ?
  `).all(project.id);

  const exportData = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    project,
    categories: categories.map(cat => ({
      name: cat.name,
      sort_order: cat.sort_order,
      items: items.filter(i => i.category_id === cat.id).map(i => ({
        name: i.name,
        url: i.url,
        due_date: i.due_date,
        cost_min: i.cost_min,
        cost_expected: i.cost_expected,
        cost_max: i.cost_max
      }))
    }))
  };

  res.setHeader('Content-Disposition', `attachment; filename="budget-${project.id}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(exportData, null, 2));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Budgetplanner läuft auf Port ${PORT}`);
});
