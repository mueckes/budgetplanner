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
const fields = Object.fromEntries(['CategoryId', 'Name', 'Url', 'DueDate', 'Expected', 'Min', 'Max'].map(name => ['modalItem' + name, { value: '', dataset: {} }]));
fields.modalItemCategoryId.value = '1'; fields.modalItemName.value = 'Test'; fields.modalItemExpected.value = '400';
const calls = [];
const context = vm.createContext({ document: { getElementById: id => fields[id] }, api: async (...args) => calls.push(args), closeItemModal() {}, loadProject() {}, showError: message => { throw Error(message); }, currentProjectId: 1, updateItem: (...args) => calls.push(args) });
vm.runInContext(block('    function parseNum(', '    function escapeHtml(') + block('    async function submitNewItem(', '    // Modal Projekt Handling') + block('    async function updateItemPrice(', '    function deleteItem('), context);
(async () => {
  await context.submitNewItem({ preventDefault() {} });
  assert.equal(calls.at(-1)[2].costMin, 360); assert.equal(calls.at(-1)[2].costMax, 460);
  fields.modalItemMin.value = ''; fields.modalItemMax.value = '';
  fields.modalItemMin.dataset.edited = fields.modalItemMax.dataset.edited = '1';
  await context.submitNewItem({ preventDefault() {} });
  assert.equal(calls.at(-1)[2].costMin, 400); assert.equal(calls.at(-1)[2].costMax, 400);
  await context.updateItemPrice(7, 'costMax', '  ');
  assert.deepEqual(calls.at(-1), [7, 'costMax', null]);
  await context.updateItemPrice(7, 'costMin', '0');
  assert.deepEqual(calls.at(-1), [7, 'costMin', 0]);
  console.log('Frontend cost bounds tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
