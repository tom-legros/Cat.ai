const test = require('node:test');
const assert = require('node:assert/strict');
const { ajouterTache } = require('../src/taches');

test('ajouterTache donne un nouvel id', () => {
  const liste = ajouterTache(ajouterTache([], 'courses'), 'ménage');
  assert.deepEqual(liste.map((t) => t.id), [1, 2]);
});
