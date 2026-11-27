const test = require('node:test');
const assert = require('node:assert/strict');
const { ajouterTache, supprimerTache, marquerFaite, tachesFaites } = require('../src/taches');
const depart = () => ajouterTache(ajouterTache(ajouterTache([], 'a'), 'b'), 'c');

test('supprimerTache, sans modifier la liste reçue', () => {
  const liste = depart();
  const sans = supprimerTache(liste, 2);
  assert.deepEqual(sans.map((t) => t.id), [1, 3]);
  assert.equal(liste.length, 3);
});
test('marquerFaite, sans modifier la liste ni la tâche', () => {
  const liste = depart();
  const apres = marquerFaite(liste, 1);
  assert.equal(apres.find((t) => t.id === 1).faite, true);
  assert.equal(liste[0].faite, false);
});
test('tachesFaites', () => {
  assert.deepEqual(tachesFaites(marquerFaite(marquerFaite(depart(), 1), 3)).map((t) => t.id), [1, 3]);
  assert.deepEqual(tachesFaites(depart()), []);
});
