
const test = require('node:test');
require('./helpers/machine-normale.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { envoyerOllama } = require('../principal/envoi');
const messages = [{ role: 'user', content: 'Donnée privée à ne pas journaliser' }];

test('statistiques Ollama : valeurs natives, premier fragment, aucun contenu privé', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response([
    { message: { content: 'Réponse' }, done: false },
    { done: true, total_duration: 3000000000, load_duration: 1000000000, prompt_eval_count: 30, prompt_eval_duration: 500000000, eval_count: 50, eval_duration: 1500000000, autre: 'secret' },
  ].map(JSON.stringify).join('\n')));
  const mesures = [], morceaux = [];
  const r = await envoyerOllama(messages, 'qwen3.5:9b', s => morceaux.push(s), null, { onStatistiques: m => mesures.push(m) });
  assert.equal(mesures.length, 1);
  assert.equal(mesures[0].eval_count, 50);
  assert.equal(mesures[0].eval_duration, 1500000000);
  assert.equal(mesures[0].termine, true);
  assert.equal(mesures[0].requetes, 1);
  assert.ok(mesures[0].premierFragmentMs >= 0);
  assert.ok(mesures[0].dureeMs >= mesures[0].premierFragmentMs);
  assert.doesNotMatch(JSON.stringify(mesures), /secret|privée|Réponse/);
  assert.deepEqual(r, { content: 'Réponse', toolCalls: [] });
  assert.deepEqual(morceaux, ['Réponse']);
});

test('statistiques Ollama : refus outils compté, champs manquants non inventés', async (t) => {
  let n = 0; const mesures = [];
  t.mock.method(globalThis, 'fetch', async () => ++n === 1
    ? new Response('does not support tools', { status: 400 })
    : new Response('{"done":true,"eval_count":null,"eval_duration":-1}\n'));
  await envoyerOllama(messages, 'modele-test', () => {}, null, { onStatistiques: m => mesures.push(m) });
  assert.equal(mesures[0].requetes, 2);
  assert.equal(mesures[0].premierFragmentMs, undefined);
  assert.equal(mesures[0].eval_count, undefined);
  assert.equal(mesures[0].eval_duration, undefined);
});

test('statistiques Ollama : relance de langue visible, y compris appel abandonné', async (t) => {
  let n = 0; const mesures = [];
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(++n === 1
    ? { message: { content: 'Okay, I will look for the file and then I will see what is in the file. '.repeat(3) } }
    : { message: { content: 'Voici la réponse.' }, done: true, eval_count: 5 }) + '\n'));
  await envoyerOllama([...messages, { role: 'tool', content: 'résultat' }], 'qwen3.5:9b', () => {}, null, { onStatistiques: m => mesures.push(m) });
  assert.equal(mesures.length, 2);
  assert.deepEqual(mesures.map(m => [m.reflexion, m.termine]), [[false, false], [true, true]]);
});

test('statistiques Ollama : annulation reste une erreur et chantier inchangé', async (t) => {
  const mesures = [];
  t.mock.method(globalThis, 'fetch', async () => { throw Object.assign(new Error('stop'), { name: 'AbortError' }); });
  await assert.rejects(envoyerOllama(messages, 'qwen3.5:9b', () => {}, null, { onStatistiques: m => mesures.push(m) }), { name: 'AbortError' });
  assert.equal(mesures.length, 1); assert.equal(mesures[0].termine, false);
  t.mock.method(globalThis, 'fetch', async () => new Response('{"done":true}\n'));
  await envoyerOllama(messages, 'qwen3.5:9b', () => {}, null, { chantier: true, onStatistiques: m => mesures.push(m) });
  assert.equal(mesures.length, 1);
});

test('affichage statistiques : unités réelles, débit et absence explicite', () => {
  const source = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
  const debut = source.indexOf('function texteStatistiquesOllama(');
  assert.ok(debut >= 0);
  const fin = source.indexOf('\n}', debut) + 2;
  const formater = vm.runInNewContext(source.slice(debut, fin) + '\ntexteStatistiquesOllama;');
  const texte = formater([{ requetes: 1, termine: true, reflexion: false, total_duration: 2000000000, eval_count: 70, eval_duration: 2000000000 }]);
  assert.match(texte, /35.*tokens\/s/);
  assert.match(texte, /70 tokens/);
  assert.match(texte, /Chargement : non fourni/);
  assert.doesNotMatch(formater([{ requetes: 1, termine: false, eval_count: 0, eval_duration: 0 }]), /Infinity|NaN/);
});


for (const regeneration of [false, true]) test('réponse interrompue préservée après ajout des statistiques, régénération = ' + regeneration, () => {
  const source = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
  const debut = source.indexOf('window.api.onError(');
  const fin = source.indexOf('\n});', debut) + 4;
  const precedent = { role: 'assistant', content: 'Réponse précédente' };
  const conv = { messages: regeneration ? [precedent] : [] };
  let handler, sauve = 0;
  const wrap = { classList: { add() {} } };
  const bulle = { closest: () => wrap, appendChild() {} };
  const flux = { id: 1, conv, remplace: regeneration ? precedent : null, wrap, el: bulle, actions: ['a lu le fichier'], chat: { expression() {} } };
  const contexte = {
    window: { api: { onError: fn => { handler = fn; } } },
    fluxParId: (id) => id === 1 ? flux : null,
    current: conv, texteDuFlux: () => 'Début de réponse', afficherFlux() {},
    document: { createElement: () => ({}) }, ajouterActionsMessage() {},
    save: () => sauve++, finirFlux() {}, erreursEnAttente: new Map(),
  };
  vm.runInNewContext(source.slice(debut, fin), contexte);
  handler({ id: 1, error: 'Flux coupé' });
  assert.equal(conv.messages.length, 1);
  if (regeneration) {
    assert.equal(conv.messages[0], precedent); assert.equal(sauve, 0);
  } else {
    assert.equal(conv.messages[0].interrompu, true);
    assert.equal(conv.messages[0].content, 'Début de réponse');
    assert.equal(conv.messages[0].erreurGeneration, 'Flux coupé');
    assert.equal(conv.messages[0].dureeReponse, undefined);
    assert.equal(sauve, 1);
  }
});
