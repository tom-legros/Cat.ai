// Titre d'une discussion proposé par le modèle après la première réponse
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { consigneTitre, nettoyerTitre } = require('../principal/titre');
const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('nettoyerTitre : garde un vrai titre, enlève guillemets, « Titre : », gras, point final et réflexion', () => {
  assert.equal(nettoyerTitre('Exemples de code SQL et JavaScript'), 'Exemples de code SQL et JavaScript');
  assert.equal(nettoyerTitre('« Exemples de code SQL »'), 'Exemples de code SQL');
  assert.equal(nettoyerTitre('"Idées de projets Python."'), 'Idées de projets Python');
  assert.equal(nettoyerTitre('Titre : **La photosynthèse expliquée**'), 'La photosynthèse expliquée');
  assert.equal(nettoyerTitre('<think>je réfléchis</think>\nRéviser la Seconde Guerre mondiale'), 'Réviser la Seconde Guerre mondiale');
  assert.equal(nettoyerTitre('\n\n  Premier titre\nSecond paragraphe'), 'Premier titre');
});

test('nettoyerTitre : rien d’utilisable → null (la discussion garde son titre) ; trop long → coupé à un mot entier', () => {
  for (const vide of ['', '   ', '..', '« »', null, undefined]) assert.equal(nettoyerTitre(vide), null, String(vide));
  const long = nettoyerTitre('Une très longue phrase qui ressemble plus à une réponse complète qu’à un titre de discussion court');
  assert.ok(long.length <= 60, long);
  assert.doesNotMatch(long, /\s$/);
  assert.ok('Une très longue phrase qui ressemble plus à une réponse complète'.startsWith(long), long);
});

test('consigneTitre : courte, en français, avec le premier message raccourci', () => {
  const consigne = consigneTitre('a'.repeat(5000));
  assert.match(consigne, /titre court \(3 à 6 mots, en français\)/);
  assert.ok(consigne.length < 900, String(consigne.length));
});

test('main : seulement Ollama, jamais sur une petite machine, abandon si Ollama est occupé, réponse courte sans réflexion', () => {
  const main = lire('main.js');
  assert.match(main, /ipcMain\.handle\('titre-discussion', async \(_e, \{ model, premierMessage \} = \{\}\) => \{(?:\s*\/\/.*)*\s*if \(!model \|\| !premierMessage \|\| LEGERE\) return null;\s*if \(fileOllama\.occupee\) return \{ occupe: true \};/);
  assert.match(main, /think: false, keep_alive: GARDER_CHARGE, options: \{ \.\.\.optionsOllama\(model\), num_predict: 24/);
  assert.match(lire('preload.js'), /titreDiscussion: \(payload\) => ipcRenderer\.invoke\('titre-discussion', payload\)/);
});

function cadreTitre({ titre = 'Exemples de code SQL', local = true, titreChoisi = false, reponses = 1 } = {}) {
  const source = lire('renderer.js');
  const debut = source.indexOf('async function proposerTitre(');
  const fin = source.indexOf('\n}', debut) + 2;
  const messages = [{ role: 'user', content: 'écrit un bout de code en sql puis en js' }];
  for (let i = 0; i < reponses; i++) messages.push({ role: 'assistant', content: 'Voici…' });
  const conv = { title: 'écrit un bout de code en sql puis en', messages, ...(titreChoisi ? { titreChoisi: true } : {}) };
  const c = { convs: [conv], demandes: [], saves: 0, listes: 0, titresEnCours: new Set(), titre };
  Object.assign(c, {
    window: { api: { titreDiscussion: async (p) => { c.demandes.push(p); return c.titre; } } },
    save: () => c.saves++, renderList: () => c.listes++,
  });
  vm.runInNewContext(source.slice(debut, fin) + '\nthis.proposerTitre = proposerTitre;', c);
  return { c, conv, flux: { local, modele: 'qwen3.5:9b' } };
}

test('proposerTitre : après la première réponse avec Ollama, le titre du modèle remplace les premiers mots, une seule fois', async () => {
  const { c, conv, flux } = cadreTitre();
  await c.proposerTitre(conv, flux, false);
  assert.equal(conv.title, 'Exemples de code SQL');
  assert.equal(conv.titreIA, true);
  assert.equal(c.saves, 1);
  assert.equal(c.demandes[0].model, 'qwen3.5:9b');
  await c.proposerTitre(conv, flux, false); // déjà tenté : on ne redemande pas
  assert.equal(c.demandes.length, 1);
});

test('proposerTitre : Ollama occupé ne compte pas comme une tentative, on réessaie à la réponse suivante', async () => {
  const { c, conv, flux } = cadreTitre({ titre: { occupe: true } });
  await c.proposerTitre(conv, flux, false);
  assert.equal(conv.title, 'écrit un bout de code en sql puis en');
  assert.notEqual(conv.titreIA, true);
  assert.equal(c.saves, 0);
  c.titre = 'Exemples de code SQL';
  conv.messages.push({ role: 'user', content: 'et en python ?' }, { role: 'assistant', content: 'Voici…' });
  await c.proposerTitre(conv, flux, false);
  assert.equal(conv.title, 'Exemples de code SQL');
  assert.equal(c.demandes.length, 2);
});

test('proposerTitre : jamais en ligne, jamais après un renommage, ni après la quatrième réponse, ni si la réponse est coupée', async () => {
  for (const [nom, options, interrompu] of [
    ['fournisseur en ligne', { local: false }, false],
    ['renommé à la main', { titreChoisi: true }, false],
    ['quatrième réponse', { reponses: 4 }, false],
    ['réponse interrompue', {}, true],
  ]) {
    const { c, conv, flux } = cadreTitre(options);
    const avant = conv.title;
    await c.proposerTitre(conv, flux, interrompu);
    assert.equal(conv.title, avant, nom);
    assert.equal(c.demandes.length, 0, nom);
  }
  // Le modèle ne renvoie rien d'utilisable : le titre reste
  const { c, conv, flux } = cadreTitre({ titre: null });
  await c.proposerTitre(conv, flux, false);
  assert.equal(conv.title, 'écrit un bout de code en sql puis en');
});
