// Les agents du mode chantier : valeurs par défaut et garde-fous
const test = require('node:test');
const assert = require('node:assert/strict');
const { rolesDepuis, changerRole } = require('../principal/roles');

const infos = (id) => ({
  ollama: { type: 'ollama' },
  gemini: { type: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  openrouter: { type: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
})[id] || null;

test('rolesDepuis : sans clé, tout tourne sur le PC ; avec une clé Gemini, le chef est en ligne', () => {
  const local = rolesDepuis({ modeles: { ollama: 'qwen3:8b' }, fournisseurs: {} });
  assert.deepEqual(local.chef, { fournisseur: 'ollama', modele: 'qwen3:8b' });
  assert.deepEqual(local.verificateur, local.chef);
  assert.equal(local.verificateurCommeChef, true);
  const enLigne = rolesDepuis({ modeles: { ollama: 'qwen3:8b', gemini: 'gemini-flash-lite' }, fournisseurs: { gemini: { cleChiffree: 'x' } } });
  assert.deepEqual(enLigne.chef, { fournisseur: 'gemini', modele: 'gemini-flash-lite' });
  assert.deepEqual(enLigne.ouvrier, { fournisseur: 'ollama', modele: 'qwen3:8b' });
});

test("changerRole : l'ouvrier reste sur le PC, et aucun modèle payant n'est retenu", () => {
  assert.match(changerRole({}, 'ouvrier', { fournisseur: 'gemini', modele: 'gemini-flash' }, infos).erreur, /sur ton PC/);
  assert.match(changerRole({}, 'chef', { fournisseur: 'gemini', modele: 'gemini-pro' }, infos).erreur, /pas gratuit/);
  assert.match(changerRole({}, 'chef', { fournisseur: 'openrouter', modele: 'gpt-payant' }, infos).erreur, /pas gratuit/);
  assert.match(changerRole({}, 'chef', { fournisseur: 'inconnu', modele: 'x' }, infos).erreur, /inconnu/);
  assert.match(changerRole({}, 'patron', { fournisseur: 'ollama', modele: 'x' }, infos).erreur, /Agent inconnu/);
});

test('changerRole : un choix valable est retenu, et le vérificateur peut redevenir le chef', () => {
  let r = changerRole({ modeles: {} }, 'chef', { fournisseur: 'gemini', modele: 'gemini-flash-lite' }, infos).reglages;
  r = changerRole(r, 'verificateur', { fournisseur: 'ollama', modele: 'qwen3:8b' }, infos).reglages;
  assert.equal(rolesDepuis(r).verificateurCommeChef, false);
  assert.deepEqual(rolesDepuis(r).verificateur, { fournisseur: 'ollama', modele: 'qwen3:8b' });
  r = changerRole(r, 'verificateur', null, infos).reglages;
  assert.deepEqual(rolesDepuis(r).verificateur, { fournisseur: 'gemini', modele: 'gemini-flash-lite' });
});
