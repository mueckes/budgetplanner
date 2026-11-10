const express = require('express');
const path = require('path');
const db = require('./db');
const cheerio = require('cheerio');
const dns = require('dns').promises;
const net = require('net');
const http = require('http');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const validAmount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e9;
const validName = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
const validDate = value => value === '' || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
const statuses = ['planned', 'ordered', 'paid'];

// 1. Projekte abrufen oder erstellen
app.get('/api/projects', (req, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY archived, created_at DESC, id DESC').all();
  res.json(projects);
});

const templates = {
  moving: ['Transport', 'Verpackung', 'Altwohnung', 'Neue Wohnung', 'Behörden & Ummeldung', 'Puffer'],
  renovation: ['Planung', 'Böden', 'Wände & Decken', 'Material & Werkzeuge', 'Handwerker', 'Puffer']
};
app.post('/api/projects', (req, res) => {
  const { name, description, template, budget = null } = req.body;
  if (!validName(name) || (budget !== null && !validAmount(budget))) return res.status(400).json({ error: 'Ungültiger Projektname oder Budget' });
  if (template && !Object.hasOwn(templates, template)) return res.status(400).json({ error: 'Unbekannte Vorlage' });
  // Projekt und Kategorien gemeinsam speichern, damit keine halbe Vorlage entsteht.
  const id = db.transaction(() => {
    const result = db.prepare('INSERT INTO projects (name, description, budget) VALUES (?, ?, ?)').run(name.trim(), description || '', budget);
    const insert = db.prepare('INSERT INTO categories (project_id, name, sort_order) VALUES (?, ?, ?)');
    (templates[template] || []).forEach((category, index) => insert.run(result.lastInsertRowid, category, index));
    return result.lastInsertRowid;
  })();
  res.json({ id, name, description });
});

app.put('/api/projects/:id', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Projekt nicht gefunden' });
  const { name = project.name, budget = project.budget, archived = project.archived } = req.body;
  if (!validName(name) || (budget !== null && !validAmount(budget)) || ![0, 1].includes(archived)) return res.status(400).json({ error: 'Ungültige Projektdaten' });
  db.prepare('UPDATE projects SET name = ?, budget = ?, archived = ? WHERE id = ?').run(name.trim(), budget, archived, project.id);
  res.json({ success: true });
});
app.delete('/api/projects/:id', (req, res) => {
  const result = db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.status(result.changes ? 200 : 404).json(result.changes ? { success: true } : { error: 'Projekt nicht gefunden' });
});

// Ein Import erstellt immer ein neues Projekt; die Transaktion verhindert Teilimporte.
app.post('/api/import', (req, res) => {
  const data = req.body;
  const project = data && data.project;
  if (!project || !validName(project.name) || !['1.0', '2.0'].includes(data.version) || !Array.isArray(data.categories) || data.categories.length > 500 || (project.budget != null && !validAmount(project.budget))) return res.status(400).json({ error: 'Ungültige Exportdatei' });
  for (const cat of data.categories) {
    if (!cat || !validName(cat.name) || !Array.isArray(cat.items) || cat.items.length > 5000 || !Number.isSafeInteger(cat.sort_order ?? 0)) return res.status(400).json({ error: 'Ungültige Kategorie' });
    for (const item of cat.items) {
      if (!item || !validName(item.name) || typeof (item.url ?? '') !== 'string' || !validDate(item.due_date || '') || !validDate(item.paid_date || '') || ![item.cost_min, item.cost_expected, item.cost_max].every(validAmount) || !statuses.includes(item.status || 'planned') || (item.actual_cost != null && !validAmount(item.actual_cost)) || (item.status === 'paid' && item.actual_cost == null)) return res.status(400).json({ error: 'Ungültiger Posten' });
    }
  }
  const id = db.transaction(() => {
    const projectId = db.prepare('INSERT INTO projects (name, description, budget, archived) VALUES (?, ?, ?, ?)').run(project.name.trim(), typeof project.description === 'string' ? project.description : '', project.budget ?? null, project.archived === 1 ? 1 : 0).lastInsertRowid;
    const categoryInsert = db.prepare('INSERT INTO categories (project_id, name, sort_order) VALUES (?, ?, ?)');
    const itemInsert = db.prepare('INSERT INTO budget_items (category_id, name, url, due_date, cost_min, cost_expected, cost_max, status, actual_cost, paid_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const cat of data.categories) {
      const catId = categoryInsert.run(projectId, cat.name.trim(), cat.sort_order ?? 0).lastInsertRowid;
      for (const item of cat.items) itemInsert.run(catId, item.name.trim(), item.url || '', item.due_date || '', item.cost_min, item.cost_expected, item.cost_max, item.status || 'planned', item.actual_cost ?? null, item.paid_date || '');
    }
    return projectId;
  })();
  res.status(201).json({ id });
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

  const actual = items.reduce((sum, item) => sum + (item.actual_cost || 0), 0);
  // Bereits bezahlte Posten ersetzen ihren Planwert durch die tatsächlichen Kosten.
  const forecast = items.reduce((sum, item) => sum + (item.status === 'paid' && item.actual_cost !== null ? item.actual_cost : item.cost_expected), 0);
  res.json({
    project,
    categories: structuredCategories,
    summary: { totalMin, totalExpected, totalMax, actual, forecast, remaining: project.budget === null ? null : project.budget - forecast }
  });
});

// 3. Kategorie anlegen
app.post('/api/categories', (req, res) => {
  const { projectId, name } = req.body;
  if (!validName(name)) return res.status(400).json({ error: 'Ungültiger Kategoriename' });
  if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) return res.status(404).json({ error: 'Projekt nicht gefunden' });
  const insert = db.prepare('INSERT INTO categories (project_id, name) VALUES (?, ?)');
  const result = insert.run(projectId, name);
  res.json({ id: result.lastInsertRowid, projectId, name });
});
app.put('/api/categories/:id', (req, res) => {
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!category) return res.status(404).json({ error: 'Kategorie nicht gefunden' });
  const { name = category.name, sortOrder = category.sort_order } = req.body;
  if (!validName(name) || !Number.isSafeInteger(sortOrder) || Math.abs(sortOrder) > 100000) return res.status(400).json({ error: 'Ungültige Kategorie' });
  db.prepare('UPDATE categories SET name = ?, sort_order = ? WHERE id = ?').run(name.trim(), sortOrder, category.id);
  res.json({ success: true });
});
app.delete('/api/categories/:id', (req, res) => {
  const result = db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.status(result.changes ? 200 : 404).json(result.changes ? { success: true } : { error: 'Kategorie nicht gefunden' });
});

// 4. Posten anlegen
app.post('/api/items', (req, res) => {
  const { categoryId, name, url, dueDate, costMin, costExpected, costMax } = req.body;
  if (!validName(name) || (url != null && typeof url !== 'string') || !validDate(dueDate || '') || ![costMin, costExpected, costMax].every(validAmount)) return res.status(400).json({ error: 'Ungültige Postendaten' });
  if (!db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId)) return res.status(404).json({ error: 'Kategorie nicht gefunden' });
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
  const item = db.prepare('SELECT * FROM budget_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Posten nicht gefunden' });
  const { name = item.name, url = item.url || '', dueDate = item.due_date || '', costMin = item.cost_min, costExpected = item.cost_expected, costMax = item.cost_max, status = item.status, actualCost = item.actual_cost, paidDate = item.paid_date || '' } = req.body;
  if (!validName(name) || typeof url !== 'string' || !validDate(dueDate) || !validDate(paidDate) || ![costMin, costExpected, costMax].every(validAmount) || !statuses.includes(status) || (actualCost !== null && !validAmount(actualCost)) || (status === 'paid' && actualCost === null)) return res.status(400).json({ error: 'Ungültige Postendaten; bezahlte Posten benötigen einen Ist-Betrag' });
  const update = db.prepare(`
    UPDATE budget_items
    SET name = ?, url = ?, due_date = ?, cost_min = ?, cost_expected = ?, cost_max = ?, status = ?, actual_cost = ?, paid_date = ?
    WHERE id = ?
  `);
  
  update.run(
    name,
    url,
    dueDate,
    costMin, costExpected, costMax, status, actualCost, paidDate,
    req.params.id
  );
  
  res.json({ success: true });
});

// 5. Posten löschen
app.delete('/api/items/:id', (req, res) => {
  const result = db.prepare('DELETE FROM budget_items WHERE id = ?').run(req.params.id);
  res.status(result.changes ? 200 : 404).json(result.changes ? { success: true } : { error: 'Posten nicht gefunden' });
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
    version: '2.0',
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
        cost_max: i.cost_max,
        status: i.status, actual_cost: i.actual_cost, paid_date: i.paid_date
      }))
    }))
  };

  res.setHeader('Content-Disposition', `attachment; filename="budget-${project.id}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(exportData, null, 2));
});

// Nur öffentliche IPv4-Adressen zulassen; DNS-Ergebnis direkt für die Verbindung verwenden.
const blocked = new net.BlockList();
[['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]].forEach(([address, prefix]) => blocked.addSubnet(address, prefix));
async function readPublicPage(input) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Ungültige URL');
  const addresses = await Promise.race([
    dns.lookup(url.hostname, { all: true, family: 4 }),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('DNS-Zeitüberschreitung')), 6000); timer.unref(); })
  ]);
  if (!addresses.length || addresses.some(({ address }) => blocked.check(address))) throw new Error('Adresse nicht erlaubt');
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).get(url, {
      // Node kann je nach Version eine Adresse oder eine Liste anfordern.
      lookup: (_host, options, callback) => options.all
        ? callback(null, [addresses[0]]) : callback(null, addresses[0].address, 4),
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html', 'Accept-Language': 'de-DE,de;q=0.9' }
    }, response => {
      // Weiterleitungen bewusst ablehnen, damit sie keine internen Ziele umgehen.
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        return reject(new Error(`Website meldet Status ${response.statusCode}`));
      }
      let size = 0;
      const chunks = [];
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) request.destroy(new Error('Antwort zu groß'));
        else chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      response.on('error', reject);
    });
    const timer = setTimeout(() => request.destroy(new Error('Zeitüberschreitung')), 6000);
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
  });
}

// URL-Metadaten & Preis extrahieren (Schema.org / JSON-LD + OpenGraph)
app.post('/api/scrape-url', async (req, res) => {
  const { url } = req.body;
  if (typeof url !== 'string' || !url.startsWith('http')) {
    return res.status(400).json({ error: 'Ungültige URL' });
  }

  try {
    const html = await readPublicPage(url);
    const $ = cheerio.load(html);

    let title = null;
    let price = null;

    // 1. Priorität: Schema.org JSON-LD
    $('script[type="application/ld+json"]').each((_, elem) => {
      try {
        const rawJson = $(elem).html();
        if (!rawJson) return;
        const data = JSON.parse(rawJson);

        const findProductData = (obj) => {
          if (!obj) return;
          if (Array.isArray(obj)) {
            obj.forEach(findProductData);
            return;
          }
          if (typeof obj === 'object') {
            const type = obj['@type'];
            if (type === 'Product' || type === 'Offer' || (Array.isArray(type) && type.includes('Product'))) {
              if (!title && obj.name) title = String(obj.name).trim();
              
              // Preis auslesen
              const offers = obj.offers;
              if (offers) {
                if (Array.isArray(offers) && offers[0]?.price) {
                  price = parseFloat(String(offers[0].price).replace(',', '.'));
                } else if (offers.price) {
                  price = parseFloat(String(offers.price).replace(',', '.'));
                }
              } else if (obj.price) {
                price = parseFloat(String(obj.price).replace(',', '.'));
              }
            }
            if (obj['@graph']) findProductData(obj['@graph']);
          }
        };

        findProductData(data);
      } catch (e) {
        // Ignorieren bei fehlerhaftem JSON
      }
    });

    // 2. Priorität: OpenGraph & Twitter Metatags
    if (!title) {
      title = $('meta[property="og:title"]').attr('content') ||
              $('meta[name="twitter:title"]').attr('content') ||
              $('title').text().trim();
    }

    if (!price) {
      const ogPrice = $('meta[property="product:price:amount"]').attr('content') ||
                      $('meta[property="og:price:amount"]').attr('content') ||
                      $('meta[name="twitter:data1"]').attr('content');
      if (ogPrice) {
        const parsed = parseFloat(String(ogPrice).replace(',', '.'));
        if (!isNaN(parsed)) price = parsed;
      }
    }

    // Titel säubern (unnötige Brand-Suffixe wie " - Amazon.de" oder " | IKEA" kürzen)
    if (title && title.length > 80) {
      title = title.substring(0, 80) + '...';
    }

    res.json({
      title: title || 'Unbekannter Artikel',
      price: price || null,
      url
    });

  } catch (err) {
    res.status(500).json({ error: 'Konnte URL nicht abrufen: ' + err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Budgetplanner läuft auf Port ${PORT}`);
});
