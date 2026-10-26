// Choix des modèles côté interface (interface/modeles.js) : le conseillé, les gourmands, celui par défaut.
// Le fichier est un script de page (pas un module) : on l'exécute dans un contexte à part pour lire ses fonctions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const contexte = {};
vm.createContext(contexte);
const source = fs.readFileSync(path.join(__dirname, '..', 'interface', 'modeles.js'), 'utf8');
vm.runInContext(`${source}\nthis.m = { modeleConseille, estGourmand, modeleParDefaut, noteModele };`, contexte);
const { modeleConseille, estGourmand, modeleParDefaut } = contexte.m;

test('conseillé : le premier modèle préféré qui existe chez le fournisseur', () => {
  assert.equal(modeleConseille(['qwen2.5-coder:7b', 'qwen3:8b'], 'ollama'), 'qwen3:8b');
  assert.equal(modeleConseille(['qwen2.5-coder:7b', 'llama3:8b'], 'ollama'), 'qwen2.5-coder:7b');
  assert.equal(modeleConseille(['llama3:8b'], 'ollama'), null);
});

test('conseillé Gemini : la version flash-lite la plus récente et stable', () => {
  const gemini = ['gemini-2.5-flash-lite', 'gemini-3.5-flash-lite', 'gemini-4.0-flash-lite-preview', 'gemini-3.5-flash'];
  assert.equal(modeleConseille(gemini, 'gemini'), 'gemini-3.5-flash-lite');
});

test('gourmands : gros modèles Ollama, gros Groq, Gemini flash sans lite', () => {
  assert.ok(estGourmand('qwen3:14b', 'ollama'));
  assert.ok(estGourmand('llama3:70b', 'ollama'));
  assert.equal(estGourmand('qwen3:8b', 'ollama'), false);
  assert.ok(estGourmand('llama-3.3-70b-versatile', 'groq'));
  assert.ok(estGourmand('gemini-3.5-flash', 'gemini'));
  assert.equal(estGourmand('gemini-3.5-flash-lite', 'gemini'), false);
  assert.equal(estGourmand('nimporte', 'openrouter'), false);
});

test('par défaut : le conseillé, sinon le mieux noté (gratuit, stable, récent)', () => {
  assert.equal(modeleParDefaut(['a:free', 'qwen/qwen3-coder:free'], 'openrouter'), 'qwen/qwen3-coder:free');
  assert.equal(modeleParDefaut(['x/modele-2:free', 'x/modele-3', 'x/modele-1:free'], 'autre'), 'x/modele-3');
  assert.equal(modeleParDefaut(['m-2.0', 'm-3.0-preview', 'm-2.5'], 'autre'), 'm-2.5');
});
