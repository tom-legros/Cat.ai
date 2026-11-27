const test = require('node:test');
const assert = require('node:assert/strict');
const { somme } = require('../src/calcul');

test('somme additionne deux nombres', () => {
  assert.equal(somme(2, 3), 5);
});
