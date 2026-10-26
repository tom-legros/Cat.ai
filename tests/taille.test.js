// Taille des messages : rester sous la limite d'un fournisseur sans casser la discussion
const test = require('node:test');
const assert = require('node:assert/strict');
const { raccourcir, compacter, limitesTaille, taille } = require('../principal/taille');

test('raccourcir : texte court intact, texte long coupé avec une note pour le modèle', () => {
  assert.equal(raccourcir('court', 10), 'court');
  const long = raccourcir('x'.repeat(50), 10);
  assert.ok(long.startsWith('x'.repeat(10)) && long.includes('raccourci') && long.includes('lire_fichier'));
});

test('limitesTaille : seulement pour Groq', () => {
  assert.ok(limitesTaille({ baseUrl: 'https://api.groq.com/openai/v1' }));
  assert.equal(limitesTaille({ baseUrl: 'https://openrouter.ai/api/v1' }), null);
  assert.equal(limitesTaille({ type: 'ollama' }), null);
});

const total = (liste) => liste.reduce((n, m) => n + taille(m), 0);

test('compacter : une discussion qui tient déjà ne change pas', () => {
  const liste = [{ role: 'system', content: 'consignes' }, { role: 'user', content: 'salut' }];
  assert.deepEqual(compacter(liste, 1000), liste);
});

test('compacter : raccourcit d abord les résultats d outils, du plus ancien au plus récent', () => {
  const liste = [
    { role: 'system', content: 'consignes' },
    { role: 'user', content: 'lis a.js et b.js' },
    { role: 'assistant', content: '', tool_calls: [{ id: '1', function: { name: 'lire_fichier', arguments: { chemin: 'a.js' } } }] },
    { role: 'tool', content: 'a'.repeat(3000), tool_call_id: '1' },
    { role: 'tool', content: 'b'.repeat(3000), tool_call_id: '2' },
  ];
  const resultat = compacter(liste, 5000);
  assert.ok(total(resultat) <= 5000);
  assert.ok(resultat[3].content.length < 3000, 'le plus ancien est raccourci');
  assert.equal(resultat.length, liste.length, 'aucun message retiré');
});

test('compacter : retire les vieux échanges mais garde les consignes et le dernier message de l’utilisateur', () => {
  const vieux = Array.from({ length: 10 }, (_, i) => [
    { role: 'user', content: `vieille question ${i} ` + 'q'.repeat(500) },
    { role: 'assistant', content: `vieille réponse ${i} ` + 'r'.repeat(500) },
  ]).flat();
  const liste = [{ role: 'system', content: 'consignes' }, ...vieux, { role: 'user', content: 'ma vraie question' }];
  const resultat = compacter(liste, 2000);
  assert.ok(total(resultat) <= 2000);
  assert.equal(resultat[0].content, 'consignes');
  assert.equal(resultat.at(-1).content, 'ma vraie question');
});

test('compacter : ne sépare jamais un appel d outil de son résultat', () => {
  const liste = [
    { role: 'system', content: 'consignes' },
    { role: 'user', content: 'u'.repeat(800) },
    { role: 'assistant', content: '', tool_calls: [{ id: '1', function: { name: 'lire_fichier', arguments: {} } }] },
    { role: 'tool', content: 't'.repeat(700), tool_call_id: '1' },
    { role: 'user', content: 'question' },
  ];
  const resultat = compacter(liste, 400);
  // Si l'appel a été retiré, son résultat aussi
  const appel = resultat.findIndex((m) => m.tool_calls);
  const outil = resultat.findIndex((m) => m.role === 'tool');
  assert.ok((appel === -1) === (outil === -1));
  if (appel !== -1) assert.equal(outil, appel + 1);
  assert.equal(resultat.at(-1).content, 'question');
});

test('compacter : ne modifie pas la liste d origine', () => {
  const liste = [{ role: 'system', content: 'x'.repeat(5000) }, { role: 'user', content: 'q' }];
  compacter(liste, 1000);
  assert.equal(liste[0].content.length, 5000);
});
