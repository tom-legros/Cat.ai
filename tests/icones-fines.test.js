// Le pixel art reste l'identité (chat, logo, titre de l'accueil) ; le reste de l'interface a des icônes fines
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PIXELS, LIGNES, MONOGRAMMES, icone } = require('../interface/icones');
const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('chaque icône de l’interface a sa version fine (ou une lettre pour les modèles)', () => {
  for (const nom of Object.keys(PIXELS)) assert.ok(LIGNES[nom] || MONOGRAMMES[nom], nom);
  assert.match(icone('copier'), /class="icone icone-px icone-ligne" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"/);
  assert.match(icone('modeleQwen'), /icone-lettre[\s\S]*>Q<\/text>/);
  assert.match(icone('inconnue'), /shape-rendering="crispEdges"/); // un nom inconnu garde la puce pixel, rien ne casse
});

test('police pixel : seulement le logo, l’accueil et la mascotte', () => {
  const css = lire('style.css');
  const fin = css.slice(css.indexOf('/* ---------- Icônes fines et titres sobres'));
  assert.match(fin, /\.page__titre \{ font: 600 28px\/1\.2 var\(--police-texte\)/);
  assert.match(fin, /\.fenetre__titre, \.fiche__genre, \.demarrage__titre, \.depot__texte \{ font-family: var\(--police-texte\); \}/);
  assert.match(fin, /\.etiquette \{ font: 600 11px var\(--police-texte\)/);
  assert.match(css, /\.accueil__titre \{[^}]*var\(--police-pixel\)/); // l'identité reste
});
