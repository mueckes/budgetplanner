const crypto = require('crypto');
const db = require('./db');

const cookieName = 'budget_session';
const lifetime = 12 * 60 * 60 * 1000;
const attempts = new Map();
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
const validUsername = value => typeof value === 'string' && /^[a-zA-Z0-9_.-]{3,40}$/.test(value);
const validPassword = value => typeof value === 'string' && value.length >= 12 && Buffer.byteLength(value, 'utf8') <= 256;

// Individuelles Salt und scrypt erschweren Offline-Passwortangriffe.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(password, salt, 64).toString('hex');
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return expected.length === 64 && crypto.timingSafeEqual(actual, expected);
}
// Auch unbekannte Benutzernamen durchlaufen scrypt, um die Antwortzeit anzugleichen.
const dummyHash = hashPassword(crypto.randomBytes(32).toString('hex'));

function installAuth(app) {
  // Nur der lokale Nginx darf Proxy-Informationen übermitteln.
  app.set('trust proxy', 'loopback');
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-BudgetPlanner') !== '1') return res.status(403).json({ error: 'Ungültige Anfrage' });
    next();
  });
  app.post('/api/auth/login', (req, res) => {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    const { username, password } = req.body || {};
    const key = req.ip + ':' + (validUsername(username) ? username.toLowerCase() : 'invalid');
    if (!attempts.has(key) && attempts.size >= 10000) return res.status(429).json({ error: 'Zu viele Versuche. Bitte später erneut versuchen.' });
    const entry = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
    if (entry.count >= 10) return res.status(429).json({ error: 'Zu viele Versuche. Bitte später erneut versuchen.' });
    const user = validUsername(username) ? db.prepare('SELECT * FROM users WHERE username = ?').get(username) : null;
    const passwordOk = typeof password === 'string' && Buffer.byteLength(password, 'utf8') <= 256 && verifyPassword(password, user ? user.password_hash : dummyHash);
    if (!user || !passwordOk) {
      entry.count++;
      attempts.set(key, entry);
      return res.status(401).json({ error: 'Benutzername oder Passwort falsch' });
    }
    attempts.delete(key);
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), user.id, now + lifetime);
    res.cookie(cookieName, token, { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: lifetime });
    res.json({ username: user.username });
  });
  app.use('/api', (req, res, next) => {
    const cookie = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(cookieName + '='));
    const token = cookie ? cookie.slice(cookieName.length + 1) : '';
    if (!/^[a-f0-9]{64}$/.test(token)) return res.status(401).json({ error: 'Bitte anmelden' });
    const session = db.prepare('SELECT u.id, u.username, u.display_name, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?').get(hashToken(token), Date.now());
    if (!session) return res.status(401).json({ error: 'Bitte anmelden' });
    req.user = session;
    req.sessionToken = token;
    next();
  });
  app.get('/api/auth/me', (req, res) => res.json({ username: req.user.username, displayName: req.user.display_name || req.user.username, email: req.user.email || '' }));
  app.put('/api/auth/profile', (req, res) => {
    const { displayName, email } = req.body || {};
    if (typeof displayName !== 'string' || !displayName.trim() || displayName.trim().length > 80 || typeof email !== 'string' || email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return res.status(400).json({ error: 'Bitte einen gültigen Anzeigenamen und eine gültige E-Mail-Adresse eingeben.' });
    db.prepare('UPDATE users SET display_name = ?, email = ? WHERE id = ?').run(displayName.trim(), email.trim(), req.user.id);
    res.json({ displayName: displayName.trim(), email: email.trim() });
  });
  app.put('/api/auth/password', (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || Buffer.byteLength(currentPassword, 'utf8') > 256 || !validPassword(newPassword)) return res.status(400).json({ error: 'Neues Passwort muss mindestens 12 Zeichen lang sein.' });
    const now = Date.now();
    const key = 'password:' + req.ip + ':' + req.user.id;
    const old = attempts.get(key);
    const entry = old && old.until > now ? old : { count: 0, until: now + 15 * 60 * 1000 };
    if (entry.count >= 10) return res.status(429).json({ error: 'Zu viele Versuche. Bitte später erneut versuchen.' });
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(currentPassword, user.password_hash)) {
      entry.count++;
      attempts.set(key, entry);
      return res.status(400).json({ error: 'Das aktuelle Passwort ist falsch.' });
    }
    attempts.delete(key);
    // Andere Sitzungen beenden; die Sitzung, in der das Passwort geändert wurde, bleibt aktiv.
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, hashToken(req.sessionToken));
    })();
    res.json({ success: true });
  });
  app.post('/api/auth/logout', (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(req.sessionToken));
    res.clearCookie(cookieName, { httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
    res.json({ success: true });
  });
  // Für jede ressourcenbezogene Route wird der Besitz serverseitig geprüft.
  app.use('/api', (req, res, next) => {
    let path;
    try { path = decodeURIComponent(req.path).toLowerCase(); } catch { return res.status(400).json({ error: 'Ungültiger Pfad' }); }
    const project = path.match(/^\/projects\/([^/]+)(?:\/|$)/);
    const category = path.match(/^\/categories\/([^/]+)(?:\/|$)/);
    const item = path.match(/^\/items\/([^/]+)(?:\/|$)/);
    let owner;
    if (project) owner = db.prepare('SELECT owner_id FROM projects WHERE id = ?').get(project[1]);
    else if (category) owner = db.prepare('SELECT p.owner_id FROM categories c JOIN projects p ON p.id = c.project_id WHERE c.id = ?').get(category[1]);
    else if (item) owner = db.prepare('SELECT p.owner_id FROM budget_items b JOIN categories c ON c.id = b.category_id JOIN projects p ON p.id = c.project_id WHERE b.id = ?').get(item[1]);
    else if (req.method === 'POST' && /^\/categories\/?$/.test(path)) owner = db.prepare('SELECT owner_id FROM projects WHERE id = ?').get(req.body?.projectId ?? null);
    else if (req.method === 'POST' && /^\/items\/?$/.test(path)) owner = db.prepare('SELECT p.owner_id FROM categories c JOIN projects p ON p.id = c.project_id WHERE c.id = ?').get(req.body?.categoryId ?? null);
    else return next();
    if (!owner || owner.owner_id !== req.user.id) return res.status(404).json({ error: 'Nicht gefunden' });
    next();
  });
}
module.exports = { installAuth, validUsername, validPassword, hashPassword };
