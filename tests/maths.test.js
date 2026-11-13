// Formules de maths : repérées dans le texte du modèle, sans toucher au code ni aux prix
const test = require('node:test');
const assert = require('node:assert/strict');
const { protegerMaths } = require('../interface/maths');

const formules = (src) => protegerMaths(src).formules;

test('protegerMaths : formule en bloc ($$…$$ et \\[…\\]), même sur plusieurs lignes', () => {
  assert.deepEqual(formules('Équation :\n$$\n6\\text{CO}_2 + 6\\text{H}_2\\text{O}\n$$\nFin.'), [{ tex: '6\\text{CO}_2 + 6\\text{H}_2\\text{O}', bloc: true }]);
  assert.deepEqual(formules('\\[ x^2 \\]'), [{ tex: 'x^2', bloc: true }]);
});

test('protegerMaths : formule dans une phrase ($…$ et \\(…\\))', () => {
  const trouvees = formules('Le rapport $\\frac{a}{b}$ et \\(x_1\\) ici.').map((f) => f.tex).sort();
  assert.deepEqual(trouvees, ['\\frac{a}{b}', 'x_1']);
});

test('protegerMaths : les _ des formules ne restent plus dans le texte (sinon le Markdown en ferait de l italique)', () => {
  const { texte } = protegerMaths('On a $\\text{C}_6\\text{H}_{12}$ et $\\text{O}_2$.');
  assert.doesNotMatch(texte, /_/);
});

test('protegerMaths : le code et les prix ne sont jamais pris pour des formules', () => {
  assert.deepEqual(formules('```bash\necho "$HOME et $PATH"\n```'), []);
  assert.deepEqual(formules('Lance `echo $USER$` dans le terminal.'), []);
  assert.deepEqual(formules('Ça coûte 5$ et le menu 10$.'), []);
  assert.deepEqual(formules('Entre 3 $ et 4 $ selon le jour.'), []);
});

test('protegerMaths : un repère écrit par le modèle est retiré', () => {
  const { texte, formules: liste } = protegerMaths('faux 0 repère');
  assert.equal(texte, 'faux 0 repère');
  assert.deepEqual(liste, []);
});
