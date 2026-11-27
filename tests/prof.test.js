// Mode prof : les blocs de code sont retirés des réponses, même coupés entre plusieurs morceaux
const test = require('node:test');
const assert = require('node:assert/strict');
const { BLOC_RETIRE, creerFiltreCode, retirerCode } = require('../principal/prof');

const REPONSE = "Pour trier, utilise `sort`. Par exemple :\n```js\nnotes.sort((a, b) => a - b);\n```\nÀ toi d'essayer ! Que renvoie `sort` ?";
const ATTENDU = `Pour trier, utilise \`sort\`. Par exemple :\n${BLOC_RETIRE}\nÀ toi d'essayer ! Que renvoie \`sort\` ?`;

test('retirerCode : le bloc disparaît, le code en ligne et le reste du texte restent', () => {
  assert.equal(retirerCode(REPONSE), ATTENDU);
  assert.equal(retirerCode('Pas de code ici.'), 'Pas de code ici.');
});

test('creerFiltreCode : même résultat quel que soit le découpage en morceaux, accents graves coupés compris', () => {
  for (const taille of [1, 2, 3, 5, 7, 13]) {
    let affiche = '';
    const filtre = creerFiltreCode((t) => { affiche += t; });
    for (let i = 0; i < REPONSE.length; i += taille) filtre.morceau(REPONSE.slice(i, i + taille));
    filtre.fin();
    assert.equal(affiche, ATTENDU, `morceaux de ${taille}`);
    assert.equal(filtre.longueur(), ATTENDU.length);
  }
});

test('creerFiltreCode : un bloc jamais fermé est retiré jusqu à la fin, et la réponse suivante repart normalement', () => {
  let affiche = '';
  const filtre = creerFiltreCode((t) => { affiche += t; });
  filtre.morceau('Voici :\n```python\ndef trier(notes):\n    return sorted(notes)');
  filtre.fin();
  assert.equal(affiche, `Voici :\n${BLOC_RETIRE}`);
  filtre.morceau('Et maintenant ?');
  filtre.fin();
  assert.equal(affiche, `Voici :\n${BLOC_RETIRE}Et maintenant ?`);
});

test('creerFiltreCode : un ou deux accents graves en fin de réponse sont affichés', () => {
  let affiche = '';
  const filtre = creerFiltreCode((t) => { affiche += t; });
  filtre.morceau('Regarde la variable `x`');
  filtre.fin();
  assert.equal(affiche, 'Regarde la variable `x`');
});
