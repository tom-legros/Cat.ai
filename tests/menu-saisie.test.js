// Clic droit : corrections d'un mot souligné, puis couper / copier / coller
const test = require('node:test');
const assert = require('node:assert/strict');
const { lignesMenu } = require('../principal/menu-saisie');

test('lignesMenu : un mot souligné dans la saisie propose ses corrections', () => {
  const lignes = lignesMenu({ isEditable: true, misspelledWord: 'bonjoru', dictionarySuggestions: ['bonjour', 'bonjours'], selectionText: '' });
  assert.deepEqual(lignes.slice(0, 2).map((l) => [l.action, l.valeur]), [['corriger', 'bonjour'], ['corriger', 'bonjours']]);
  assert.equal(lignes[2].action, 'apprendre');
  assert.equal(lignes.at(-1).action, 'coller');
});

test('lignesMenu : hors de la saisie, seulement copier un texte sélectionné', () => {
  assert.deepEqual(lignesMenu({ isEditable: false, selectionText: 'du texte' }).map((l) => l.action), ['copier']);
  assert.deepEqual(lignesMenu({ isEditable: false, selectionText: '  ', misspelledWord: 'x' }), []);
  assert.deepEqual(lignesMenu({ isEditable: true, selectionText: 'mot' }).map((l) => l.action), ['couper', 'copier', 'coller']);
});
