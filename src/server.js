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

// 1. Projekte abrufen oder erstellen
app.get('/api/projects', (req, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  res.json(projects);
});

const templates = {
  moving: ['Transport', 'Verpackung', 'Altwohnung', 'Neue Wohnung', 'Behörden & Ummeldung', 'Puffer'],
  renovation: ['Planung', 'Böden', 'Wände & Decken', 'Material & Werkzeuge', 'Handwerker', 'Puffer']
};
app.post('/api/projects', (req, res) => {
  const { name, description, template } = req.body;
  if (template && !Object.hasOwn(templates, template)) return res.status(400).json({ error: 'Unbekannte Vorlage' });
  // Projekt und Kategorien gemeinsam speichern, damit keine halbe Vorlage entsteht.
  const id = db.transaction(() => {
    const result = db.prepare('INSERT INTO projects (name, description) VALUES (?, ?)').run(name, description || '');
    const insert = db.prepare('INSERT INTO categories (project_id, name, sort_order) VALUES (?, ?, ?)');
    (templates[template] || []).forEach((category, index) => insert.run(result.lastInsertRowid, category, index));
    return result.lastInsertRowid;
  })();
  res.json({ id, name, description });
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
      lookup: (_host, _options, callback) => callback(null, addresses[0].address, 4),
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
