// Testet die echten Frontend-Funktionen mit isolierten Formularfeldern.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../src/public/index.html'), 'utf8');
function block(start, end) {
  const begin = html.indexOf(start), finish = html.indexOf(end, begin);
  assert.ok(begin >= 0 && finish > begin);
  return html.slice(begin, finish);
}
const fields = Object.fromEntries(['CategoryId', 'Name', 'Url', 'DueDate', 'Expected', 'Min', 'Max', 'Bounds', 'Kind'].map(name => ['modalItem' + name, { value: '', dataset: {} }]));
fields.modalItemKind.value = 'expense'; fields.modalItemCategoryId.value = '1'; fields.modalItemName.value = 'Test'; fields.modalItemExpected.value = '400';
const calls = [];
const context = vm.createContext({ document: { getElementById: id => fields[id] }, api: async (...args) => calls.push(args), closeItemModal() {}, loadProject() {}, showError: message => { throw Error(message); }, currentProjectId: 1, updateItem: (...args) => calls.push(args) });
vm.runInContext(block('    function parseNum(', '    function escapeHtml(') + block('    async function submitNewItem(', '    // Modal Projekt Handling') + block('    async function updateItemPrice(', '    function deleteItem('), context);
(async () => {
  await context.submitNewItem({ preventDefault() {} });
  assert.equal(calls.at(-1)[2].costMin, 400); assert.equal(calls.at(-1)[2].costMax, 400); assert.equal(calls.at(-1)[2].boundsEnabled, 0);
  fields.modalItemMin.value = ''; fields.modalItemMax.value = '';
  fields.modalItemBounds.checked = true; fields.modalItemKind.value = 'income';
  await context.submitNewItem({ preventDefault() {} });
  assert.equal(calls.at(-1)[2].costMin, 400); assert.equal(calls.at(-1)[2].costMax, 400); assert.equal(calls.at(-1)[2].kind, 'income');
  fields.modalItemMin.value = '300'; fields.modalItemMax.value = '500';
  await context.submitNewItem({ preventDefault() {} });
  assert.equal(calls.at(-1)[2].costMin, 300); assert.equal(calls.at(-1)[2].costMax, 500);
  await context.updateItemPrice(7, 'costMax', '  ');
  assert.deepEqual(calls.at(-1), [7, 'costMax', null]);
  await context.updateItemPrice(7, 'costMin', '0');
  assert.deepEqual(calls.at(-1), [7, 'costMin', 0]);
  // Min-/Max-Spalten fehlen bei deaktivierter Spanne und erscheinen nach Aktivierung.
  let card;
  context.document.getElementById = id => id === 'categoriesContainer' ? { set innerHTML(v) {}, appendChild(c) { card = c; } } : fields[id];
  context.document.createElement = () => ({ addEventListener() {} });
  Object.assign(context, { categoryKey: id => String(id), categoryIsOpen: () => false, rememberCategory() {}, escapeHtml: String, safeUrl: () => '', fmt: String });
  vm.runInContext(block('    function renderCategories(', '    async function checkCompleteness('), context);
  const entry = { id: 1, name: 'Kaution', kind: 'income', status: 'planned', actual_cost: null, cost_expected: 400, cost_min: 300, cost_max: 500, bounds_enabled: 0 };
  context.renderCategories([{ id: 1, name: 'Wohnen', sort_order: 0, items: [entry] }]);
  assert.doesNotMatch(card.innerHTML, /data-label="Min"/); assert.match(card.innerHTML, /Einnahme/);
  entry.bounds_enabled = 1;
  context.renderCategories([{ id: 1, name: 'Wohnen', sort_order: 0, items: [entry] }]);
  assert.match(card.innerHTML, /data-label="Min"/); assert.match(card.innerHTML, /500\.00/);
  console.log('Frontend cost bounds tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
