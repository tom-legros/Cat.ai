// Commandes « / » de la saisie
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { COMMANDES, trouverCommande, filtrerCommandes, discussionEnMarkdown, nomDeFichier } = require('../interface/commandes');
const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('trouverCommande : nom, alias, accents et argument', () => {
  assert.equal(trouverCommande('/nouveau').commande.nom, 'nouveau');
  assert.equal(trouverCommande('/oublier').commande.nom, 'nouveau');
  assert.equal(trouverCommande('/Réflexion').commande.nom, 'reflexion');
  assert.equal(trouverCommande('  /prof  ').commande.nom, 'prof');
  const r = trouverCommande('/renommer Révisions du bac');
  assert.equal(r.commande.nom, 'renommer');
  assert.equal(r.argument, 'Révisions du bac');
  assert.equal(trouverCommande('/modele gemma').argument, 'gemma');
});

test('trouverCommande : une vraie phrase qui commence par / part au chat', () => {
  for (const phrase of ['/etc/hosts c est quoi ?', '/inconnue', 'bonjour /prof', '/prof explique-moi les fractions', '/', '']) {
    assert.equal(trouverCommande(phrase), null, phrase);
  }
});

test('filtrerCommandes : / montre tout, le début filtre, la description rattrape, un espace ferme', () => {
  assert.equal(filtrerCommandes('/').length, COMMANDES.length);
  assert.deepEqual(filtrerCommandes('/re').map((c) => c.nom), ['reflexion', 'renommer', 'recherche', 'reglages']);
  assert.deepEqual(filtrerCommandes('/mém').map((c) => c.nom), ['memoire']);
  assert.deepEqual(filtrerCommandes('/photo').map((c) => c.nom), ['joindre']);
  assert.deepEqual(filtrerCommandes('/renommer '), []);
  assert.deepEqual(filtrerCommandes('salut'), []);
  assert.deepEqual(filtrerCommandes('/zzz'), []);
});

test('les commandes ont des noms uniques et des icônes qui existent', () => {
  const { PIXELS, LIGNES } = require('../interface/icones');
  const noms = COMMANDES.flatMap((c) => [c.nom, ...c.alias]);
  assert.equal(new Set(noms).size, noms.length);
  for (const c of COMMANDES) assert.ok(LIGNES[c.icone] || PIXELS[c.icone], c.icone);
});

test('discussionEnMarkdown et nomDeFichier', () => {
  const md = discussionEnMarkdown({ title: 'Centrer une div', messages: [
    { role: 'user', content: 'comment centrer ?' },
    { role: 'assistant', content: '<think>hmm</think>Avec flex.' },
    { role: 'error', content: 'oups' },
  ] }, 'Cat Ai');
  assert.equal(md, '# Centrer une div\n\n**Toi :**\n\ncomment centrer ?\n\n**Cat Ai :**\n\nAvec flex.\n');
  assert.equal(nomDeFichier('SQL / JS : "exemples"?'), 'SQL JS exemples.md');
  assert.equal(nomDeFichier(''), 'discussion.md');
});

test('renderer : la commande est interceptée avant l envoi, le menu passe avant Entrée et les flèches', () => {
  const r = lire('renderer.js');
  assert.match(r, /const commande = trouverCommande\(texte\);\s*if \(commande\) \{ viderSaisie\(\); executerCommande\(commande\.commande, commande\.argument\); return; \}\s*const destination = current;/);
  assert.match(r, /e\.stopImmediatePropagation\(\);\s*\}, true\);/);
  for (const c of COMMANDES) assert.match(r, new RegExp(`case "${c.nom}"`), c.nom);
  const html = lire('index.html');
  assert.ok(html.indexOf('interface/commandes.js') < html.indexOf('renderer.js'));
  assert.match(html, /id="menu-commandes"/);
});
