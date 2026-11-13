// Flèches dans la saisie : retrouver ses anciens messages
const test = require('node:test');
const assert = require('node:assert/strict');
const { anciensMessages, parcourirAnciens } = require('../interface/saisie');

test('anciensMessages : seulement ce que l\'utilisateur a tapé, sans doublons qui se suivent', () => {
  const messages = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'x' }, { role: 'user', content: 'a' }, { role: 'user', content: 'long contenu', affichage: 'b' }];
  assert.deepEqual(anciensMessages(messages), ['a', 'b']);
  assert.deepEqual(anciensMessages(undefined), []);
});

test('parcourirAnciens : on remonte, on redescend, et le brouillon revient', () => {
  const anciens = ['un', 'deux'];
  let e = parcourirAnciens(anciens, null, -1, 'brouillon');
  assert.equal(e.texte, 'deux');
  e = parcourirAnciens(anciens, e, -1, 'deux');
  assert.equal(e.texte, 'un');
  assert.equal(parcourirAnciens(anciens, e, -1, 'un'), null); // plus rien au-dessus
  e = parcourirAnciens(anciens, e, 1, 'un');
  e = parcourirAnciens(anciens, e, 1, 'deux');
  assert.equal(e.texte, 'brouillon');
  assert.equal(parcourirAnciens(anciens, e, 1, 'brouillon'), null);
  assert.equal(parcourirAnciens([], null, -1, ''), null);
});
