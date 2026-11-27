const test = require('node:test');
const assert = require('node:assert/strict');
const { capitaliser, compterMots } = require('../src/texte');

test('capitaliser', () => {
  assert.equal(capitaliser('bonjour'), 'Bonjour');
  assert.equal(capitaliser('éLAN'), 'ÉLAN');
  assert.equal(capitaliser(''), '');
});
test('compterMots', () => {
  assert.equal(compterMots('le chat dort'), 3);
  assert.equal(compterMots('  le   chat  '), 2);
  assert.equal(compterMots(''), 0);
  assert.equal(compterMots('    '), 0);
});
