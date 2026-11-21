// Rendu du markdown dans catai : les marques disparaissent, même quand le texte arrive par petits morceaux
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerRenduMarkdown, coupeSure } = require('../cli/markdown');

function rendre(texte, taille = Infinity, couleurs = false) {
  let sortie = '';
  const md = creerRenduMarkdown((t) => { sortie += t; }, { couleurs });
  const pas = Number.isFinite(taille) ? taille : texte.length || 1;
  for (let i = 0; i < texte.length; i += pas) md.texte(texte.slice(i, i + pas));
  md.fin();
  return sortie;
}

const EXEMPLE = '**Mon classement :**\n  1. **CatFiles** - garde ton *identité*\n  - **FileBot** - `robot`\n## Titre\n```js\nconst a = 2 * 3;\n```\nfin';
const ATTENDU = 'Mon classement :\n  1. CatFiles - garde ton identité\n  • FileBot - robot\nTitre\nconst a = 2 * 3;\nfin';

test('les ** et autres marques ne sont plus écrites', () => {
  assert.equal(rendre(EXEMPLE), ATTENDU);
});

test('le même rendu quelle que soit la taille des morceaux', () => {
  for (const taille of [1, 2, 3, 7]) assert.equal(rendre(EXEMPLE, taille), ATTENDU, `morceaux de ${taille}`);
});

test('en couleurs : gras, italique et code mis en forme', () => {
  const s = rendre('**a** *b* `c`', Infinity, true);
  assert.equal(s, '\x1b[1ma\x1b[22m \x1b[3mb\x1b[23m \x1b[36mc\x1b[39m');
});

test('ce qui n est pas une marque reste tel quel', () => {
  assert.equal(rendre('nom_de_variable et 2 * 3'), 'nom_de_variable et 2 * 3');
  assert.equal(rendre('**pas fermé'), '**pas fermé');
});

test('un « ** » ouvert retient l écriture, le texte avant part tout de suite', () => {
  assert.equal(coupeSure('Bonjour **to'), 'Bonjour '.length);
  assert.equal(coupeSure('Bonjour **toi** et'), 'Bonjour **toi** et'.length);
});

test('tableaux : cellules séparées, ligne de tirets en trait', () => {
  assert.equal(rendre('| a | b |\n|---|---|\n| 1 | 2 |'), 'a │ b\n────┼────\n1 │ 2');
});
