// Konten im Container anlegen oder Passwörter zurücksetzen.
const readline = require('readline');
const db = require('./db');
const { validUsername, validPassword, hashPassword } = require('./auth');
const [command, username, option] = process.argv.slice(2);
if (!['add', 'password'].includes(command) || !validUsername(username) || (option && (command !== 'add' || option !== '--claim-existing'))) {
  console.error('Aufruf: node src/manage-users.js add BENUTZER [--claim-existing] | password BENUTZER');
  process.exit(1);
}
if (!process.stdin.isTTY) {
  console.error('Bitte interaktiv auf einem Terminal ausführen.');
  process.exit(1);
}
const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
const unowned = db.prepare('SELECT COUNT(*) AS count FROM projects WHERE owner_id IS NULL').get().count;
if (command === 'add' && option === '--claim-existing' && count > 0) {
  console.error('Bestehende Projekte können nur dem ersten Konto zugewiesen werden.');
  process.exit(1);
}
if (command === 'add' && count === 0 && unowned && option !== '--claim-existing') {
  console.error('Bestehende Projekte vorhanden. Für das erste Konto --claim-existing angeben.');
  process.exit(1);
}
const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
if (command === 'add' && existing) {
  console.error('Dieses Konto existiert bereits.');
  process.exit(1);
}
if (command === 'password' && !existing) {
  console.error('Dieses Konto existiert nicht.');
  process.exit(1);
}
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
// Die Kennworteingabe bleibt unsichtbar und erscheint nicht in der Shell-History.
rl._writeToOutput = function (text) {
  if (!this.hideInput) this.output.write(text);
};
function password(prompt) {
  process.stdout.write(prompt + '\n');
  rl.hideInput = true;
  return new Promise(resolve => rl.question('', value => { rl.hideInput = false; process.stdout.write('\n'); resolve(value); }));
}
(async () => {
  console.log('Das Passwort muss mindestens 12 Zeichen lang sein.');
  const first = await password('Passwort vergeben:');
  const second = await password('Passwort wiederholen:');
  rl.close();
  process.stdin.pause();
  process.stdin.unref?.();
  if (!validPassword(first) || first !== second) throw new Error('Passwort ungültig oder Eingaben stimmen nicht überein.');
  const result = db.transaction(() => {
    if (command === 'password') {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(first), existing.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
      return existing.id;
    }
    // Falls gleichzeitig ein anderes Konto angelegt wurde, niemals Projekte übertragen.
    if (db.prepare('SELECT COUNT(*) AS count FROM users').get().count !== count) throw new Error('Konten wurden gleichzeitig verändert. Bitte erneut versuchen.');
    const id = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hashPassword(first)).lastInsertRowid;
    if (option === '--claim-existing') db.prepare('UPDATE projects SET owner_id = ? WHERE owner_id IS NULL').run(id);
    return id;
  })();
  console.log(command === 'add' ? `Konto ${username} erstellt (ID ${result}).` : `Passwort für ${username} geändert; alte Sitzungen wurden beendet.`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
