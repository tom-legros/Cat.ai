// Réglages : une page qu'on fait défiler, un menu de sections à gauche, et l'onglet Apparence
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const html = lire('index.html');
const barre = lire('interface/barre-laterale.js');
const css = lire('style.css');

test('réglages : quatre sections, et chaque lien du menu pointe vers une section qui existe', () => {
  const fenetre = html.slice(html.indexOf('id="reglages-modal"'), html.indexOf('id="maj-modal"'));
  const liens = [...fenetre.matchAll(/class="reglages__lien[^"]*" type="button" data-section="([\w-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(liens, ['reglages-section-cerveau', 'reglages-section-cles', 'reglages-section-apparence', 'reglages-section-avance']);
  for (const id of liens) assert.match(fenetre, new RegExp(`<section class="reglages__section" id="${id}"`));
  // Rien n'est caché derrière un onglet : la clé et son bouton restent atteignables (le vérificateur Electron s'en sert)
  assert.doesNotMatch(fenetre, /<section class="reglages__section"[^>]*hidden/);
  assert.match(fenetre, /id="close-reglages" class="fenetre__fermer" type="button" aria-label="Fermer les réglages"/);
});

test('apparence : largeur normale, replier, et « Réduire les animations » retenu', () => {
  assert.match(html, /id="reglages-sans-animations" type="checkbox" role="switch"/);
  assert.match(barre, /retenir\("sansAnimations", caseAnimations\.checked \? "1" : "0"\)/);
  assert.match(barre, /poignee\.dispatchEvent\(new MouseEvent\("dblclick"\)\)/);
  assert.match(css, /body\.sans-animations \*, body\.sans-animations \*::before, body\.sans-animations \*::after \{ animation: none !important; transition: none !important; \}/);
});
