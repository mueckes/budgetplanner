const assert = require('node:assert/strict');
const { parsePrice } = require('../src/money');
assert.equal(parsePrice('1.234,56 €'), 1234.56);
assert.equal(parsePrice('1,234.56'), 1234.56);
assert.equal(parsePrice('1234,56'), 1234.56);
assert.equal(parsePrice('19 USD'), null);
assert.equal(parsePrice('1.2.3'), null);
console.log('Price parsing tests passed');

