// Vérifie la bibliothèque réellement installée, sans navigateur ni faux moteur de rendu.
const test = require('node:test');
const assert = require('node:assert/strict');
const katex = require('katex');

test('KaTeX : une option trust héritée ne doit pas autoriser un lien', () => {
  const options = Object.assign(Object.create({ trust: true }), { output: 'mathml', throwOnError: false });
  const rendu = katex.renderToString(String.raw`\href{https://exemple.invalid}{clic}`, options);
  assert.doesNotMatch(rendu, /href=/);
});

test('KaTeX : une formule ordinaire conserve son rendu MathML', () => {
  const rendu = katex.renderToString(String.raw`x^2 + \frac{1}{2}`, { output: 'mathml', throwOnError: false });
  assert.match(rendu, /<math/);
  assert.match(rendu, /<mfrac>/);
  assert.doesNotMatch(rendu, /katex-error/);
});
