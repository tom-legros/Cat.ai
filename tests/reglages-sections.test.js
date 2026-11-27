// Réglages : un onglet à la fois (Cerveau, Appareils, Mémoire, Apparence, Outils), une ligne par réglage
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const html = lire('index.html');
const barre = lire('interface/barre-laterale.js');
const css = lire('style.css');

test('réglages : cinq onglets, un seul visible à la fois ; Cerveau en premier ; chaque lien mène à une section qui existe', () => {
  const fenetre = html.slice(html.indexOf('id="reglages-modal"'), html.indexOf('id="maj-modal"'));
  const liens = [...fenetre.matchAll(/class="reglages__lien[^"]*" type="button" data-section="([\w-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(liens, ['reglages-section-cerveau', 'reglages-section-appareils', 'reglages-section-memoire', 'reglages-section-apparence', 'reglages-section-outils']);
  for (const id of liens) assert.ok(fenetre.includes(`<section class="reglages__section" id="${id}"`), id);
  // Au départ, seul Cerveau est visible ; les autres onglets attendent qu'on clique
  assert.doesNotMatch(fenetre, /<section class="reglages__section" id="reglages-section-cerveau"[^>]*hidden/);
  for (const id of liens.slice(1)) assert.match(fenetre, new RegExp(`<section class="reglages__section" id="${id}"[^>]*hidden>`), id);
  assert.ok(barre.includes('function afficherSection(id, { focus = false } = {})'));
  assert.ok(barre.includes('if (section) section.hidden = !actif;'));
  // Cerveau : Ce PC, Autre PC, En ligne ; chaque bouton montre son panneau
  assert.deepEqual([...fenetre.matchAll(/data-moteur="(\w+)"/g)].map((m) => m[1]), ['pc', 'autre', 'ligne']);
  assert.deepEqual([...fenetre.matchAll(/data-panneau="(\w+)"/g)].map((m) => m[1]), ['pc', 'autre', 'ligne']);
  assert.match(fenetre, /id="close-reglages" class="fenetre__fermer" type="button" aria-label="Fermer les réglages"/);
});

test('apparence : largeur normale, replier, et « Réduire les animations » retenu', () => {
  assert.match(html, /id="reglages-sans-animations" type="checkbox" role="switch"/);
  assert.match(barre, /retenir\("sansAnimations", caseAnimations\.checked \? "1" : "0"\)/);
  assert.match(barre, /poignee\.dispatchEvent\(new MouseEvent\("dblclick"\)\)/);
  assert.match(css, /body\.sans-animations \*, body\.sans-animations \*::before, body\.sans-animations \*::after \{ animation: none !important; transition: none !important; \}/);
});

test('mémoire : ouverte depuis les Réglages, on y revient en la fermant ; plus de bouton dans le menu latéral', () => {
  const cote = html.slice(html.indexOf('<aside class="cote">'), html.indexOf('</aside>'));
  assert.doesNotMatch(cote, /id="open-memory"/);
  assert.match(html, /<section class="reglages__section" id="reglages-section-memoire"[\s\S]*?id="open-memory"/);
  const renderer = lire('renderer.js');
  // En fermant la mémoire, on revient sur l'onglet Mémoire des Réglages (son bouton y reprend le focus)
  assert.ok(renderer.includes('if (nom === "memory") { $("#reglages-modal").hidden = false; afficherSection("reglages-section-memoire"); }'));
});
