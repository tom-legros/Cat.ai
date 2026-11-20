// Instrumentation du résumé automatique : mesure de bout en bout et champs natifs fermés,
// rattachement à la réponse réussie dans onDone, rubrique d'affichage, contrat du handler 'summarize'.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourceRenderer = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
const sourceMain = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const extraire = (source, debut, fin) => source.slice(source.indexOf(debut), source.indexOf(fin, source.indexOf(debut)));

const NATIFS = { total_duration: 13920000000, load_duration: 5000000, prompt_eval_count: 3000, prompt_eval_duration: 7930000000, eval_count: 199, eval_duration: 5790000000 };
const conversationLongue = () => ({ messages: Array.from({ length: 6 }, () => ({ role: 'user', content: 'a'.repeat(2500) })) });

// Même extraction que tests/resume.test.js, plus un collecteur de performance pour la mesure.
function cadre(mock, { avecPerformance = true } = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', focus() {}, showModal() {} });
    return elements.get(id);
  };
  const appels = []; let sauvegardes = 0;
  const contexte = vm.createContext({
    $: element, streaming: null, envoiEnCours: false,
    messagesEl: { scrollTop: 0, querySelectorAll: () => [] }, input: { focus() {} }, renderConv() {},
    save: () => sauvegardes++, modelSel: { value: 'simule' }, reglages: { actif: 'ollama' },
    window: { api: { summarize: async p => { appels.push(p); return mock(p); } } },
    ...(avecPerformance ? { performance } : {}),
  });
  vm.runInContext(extraire(sourceRenderer, 'const LIMITE_HISTORIQUE', '// Les étiquettes de l’app'), contexte);
  return { contexte, appels, sauvegardes: () => sauvegardes };
}

test('instrumentation : un résumé obtenu fournit la durée, les champs natifs fermés et le comportement inchangé', async () => {
  const c = cadre(() => ({ resume: 'Faits essentiels.', mesures: { ...NATIFS, secret: 'contenu privé' } }));
  const stats = []; const conv = conversationLongue();
  await c.contexte.resumerSiBesoin(conv, {}, stats);
  assert.equal(c.appels.length, 1);
  assert.equal(c.appels[0].avecMesures, true);
  assert.equal(stats.length, 1);
  assert.equal(stats[0].echec, false);
  assert.ok(stats[0].dureeMs >= 0);
  for (const [cle, valeur] of Object.entries(NATIFS)) assert.equal(stats[0][cle], valeur);
  assert.equal(Object.keys(stats[0]).length, 2 + Object.keys(NATIFS).length, 'liste fermée : aucune autre clé');
  assert.doesNotMatch(JSON.stringify(stats), /secret|privé/);
  assert.equal(conv.resume, 'Faits essentiels.');
  assert.equal(conv.resumeJusqua, 2);
  assert.equal(c.sauvegardes(), 1);
});

test('instrumentation : ancien contrat (chaîne seule) toujours accepté, sans champ natif inventé', async () => {
  const c = cadre(() => 'Résumé brut.');
  const stats = []; const conv = conversationLongue();
  await c.contexte.resumerSiBesoin(conv, {}, stats);
  assert.equal(stats[0].echec, false);
  assert.equal(stats[0].total_duration, undefined);
  assert.equal(stats[0].eval_count, undefined);
  assert.equal(conv.resume, 'Résumé brut.');
  assert.equal(conv.resumeJusqua, 2);
});

for (const [nom, mock, natifAttendu] of [
  ['échec null', () => null, false],
  ['échec objet sans résumé', () => ({ resume: null, mesures: { eval_count: 199 } }), true],
]) test('instrumentation : ' + nom + ' mesuré, conversation inchangée', async () => {
  const c = cadre(mock);
  const stats = []; const conv = conversationLongue();
  const avant = JSON.stringify(conv);
  await c.contexte.resumerSiBesoin(conv, {}, stats);
  assert.equal(stats.length, 1);
  assert.equal(stats[0].echec, true);
  assert.ok(stats[0].dureeMs >= 0);
  assert.equal(stats[0].eval_count === 199, natifAttendu);
  assert.equal(JSON.stringify(conv), avant);
  assert.equal(c.sauvegardes(), 0);
});

test('instrumentation : un appel qui lève est mesuré (échec) puis propagé, sans toucher la conversation', async () => {
  const c = cadre(() => { throw new Error('coupe'); });
  const stats = []; const conv = conversationLongue();
  await assert.rejects(c.contexte.resumerSiBesoin(conv, {}, stats), { message: 'coupe' });
  assert.equal(stats.length, 1);
  assert.equal(stats[0].echec, true);
  assert.equal(JSON.stringify(conv), JSON.stringify(conversationLongue()));
  assert.equal(c.sauvegardes(), 0);
});

test('instrumentation : sous le seuil, aucun appel ni mesure', async () => {
  const c = cadre(() => { throw new Error('ne doit pas être appelé'); });
  const stats = []; const conv = { messages: [{ role: 'user', content: 'court' }] };
  await c.contexte.resumerSiBesoin(conv, {}, stats);
  assert.equal(c.appels.length, 0);
  assert.equal(stats.length, 0);
});

test('instrumentation : sans collecteur ni performance global, comportement historique inchangé', async () => {
  const c = cadre(() => 'Résumé.', { avecPerformance: false });
  const conv = conversationLongue();
  await c.contexte.resumerSiBesoin(conv, {});
  assert.equal(c.appels.length, 1);
  assert.equal(conv.resume, 'Résumé.');
  assert.equal(conv.resumeJusqua, 2);
});

test('affichage : rubrique résumé, durées réelles, part de la réponse, absence explicite', () => {
  const extrait = extraire(sourceRenderer, 'function texteResumeAutomatique(', '\n}') + '\n}';
  const formater = vm.runInNewContext(extrait + '\ntexteResumeAutomatique;');
  const texte = formater([{ dureeMs: 13850, echec: false, ...NATIFS }], 20100);
  assert.match(texte, /Appel 1 · résumé obtenu/);
  assert.match(texte, /Durée de bout en bout : 13,85 s/);
  assert.match(texte, /Chargement : 0,0\d s/);
  assert.match(texte, /Traitement du prompt : 7,93 s/);
  assert.match(texte, /Génération : 5,79 s/);
  assert.match(texte, /199 tokens/);
  assert.match(texte, /tokens\/s/);
  assert.match(texte, /Durée native Ollama : 13,92 s/);
  assert.match(texte, /Nombre d'appels : 1 · Durée totale : 13,85 s/);
  assert.match(texte, /Part de la durée de réponse : 68,9\d % \(réponse : 20,1 s\)/);
  const echec = formater([{ dureeMs: 500, echec: true }], 12000);
  assert.match(echec, /échec : aucun résumé obtenu/);
  assert.match(echec, /dont 1 sans résumé obtenu/);
  assert.match(echec, /Chargement : non fourni/);
  assert.match(echec, /Tokens générés : non fourni/);
  assert.match(echec, /Débit : non fourni/);
  assert.match(echec, /Durée native Ollama : non fourni/);
  assert.doesNotMatch(echec + formater([{ dureeMs: 500, echec: true }], undefined), /Infinity|NaN/);
  assert.match(formater([{ dureeMs: 500, echec: true }], undefined), /Part de la durée de réponse : non fournie/);
});

// Rattachement au message : même extraction que les tests « réponse interrompue » de statistiques-ollama.test.js.
function cadreOnDone({ interrompu = false, statistiquesOllama = null, statistiquesResume = [] } = {}) {
  const extrait = extraire(sourceRenderer, 'window.api.onDone(', '\n});') + '\n});';
  let handler;
  const conv = { messages: [] };
  const flux = { id: 7, conv, remplace: null, wrap: { remove() {} }, discussionEntamee: false, actions: [], statistiquesResume, debut: 0, chat: { sautiller() {}, expression() {} } };
  let sauvegardes = 0;
  const contexte = {
    window: { api: { onDone: fn => { handler = fn; } } },
    fluxParId: (id) => id === 7 ? flux : null, current: conv, performance,
    texteDuFlux: () => 'Réponse', afficherFlux() {}, document: { createElement: () => ({}) },
    ajouterActionsMessage() {}, finirFlux() {}, renderConv() {}, save: () => sauvegardes++,
    proposerTitre() {}, // titre par le modèle après la 1re réponse : testé à part (titre.test.js)
  };
  vm.runInNewContext(extrait, contexte);
  handler({ id: 7, interrompu, statistiquesOllama, nombreOutils: statistiquesOllama ? 0 : undefined });
  return { conv };
}

test('rattachement : les mesures du résumé suivent la réponse réussie, comme statistiquesOllama', () => {
  const statsResume = [{ dureeMs: 13850, echec: false }];
  const { conv } = cadreOnDone({ statistiquesOllama: [{ requetes: 1 }], statistiquesResume: statsResume });
  const message = conv.messages[0];
  assert.equal(message.statistiquesResume, statsResume);
  assert.deepEqual(message.statistiquesOllama, [{ requetes: 1 }]);
  assert.ok(Number.isFinite(message.dureeReponse));
});

test('rattachement : sans résumé automatique (seuil sous franchi ou régénération), aucune rubrique', () => {
  const { conv } = cadreOnDone({ statistiquesOllama: [{ requetes: 1 }], statistiquesResume: [] });
  assert.equal(conv.messages[0].statistiquesResume, undefined);
  assert.deepEqual(conv.messages[0].statistiquesOllama, [{ requetes: 1 }]);
});

test('rattachement : réponse interrompue, aucune statistique rattachée', () => {
  const { conv } = cadreOnDone({ interrompu: true, statistiquesOllama: [{ requetes: 1 }], statistiquesResume: [{ dureeMs: 1, echec: false }] });
  assert.equal(conv.messages[0].statistiquesResume, undefined);
  assert.equal(conv.messages[0].statistiquesOllama, undefined);
  assert.equal(conv.messages[0].dureeReponse, undefined);
  assert.equal(conv.messages[0].content, 'Réponse');
});

// Contrat du handler 'summarize' dans main.js : mesures natives seulement avec avecMesures, chaîne seule sinon.
// L'extraction démarre aux fonctions de mesures pour tester le code réel, pas des shims.
const extraitMain = extraire(sourceMain, '// Mesures natives du résumé', '\n});') + '\n});';
function handlerMain(config, fetchMock, { gratuit = true } = {}) {
  let handler;
  vm.runInNewContext(extraitMain, {
    ipcMain: { handle: (_c, fn) => { handler = fn; } },
    lirePrenom: () => 'Alex',
    configFournisseur: async () => config,
    modeleGratuit: () => gratuit,
    OLLAMA: 'http://ollama-test',
    sansReflexion: () => false,
    GARDER_CHARGE: '30m',
    optionsOllama: () => ({}),
    REFLEXION: {},
    prechauffage: null,
    fileOllama: require('../principal/file-ollama').creerFileOllama(),
    AbortSignal,
    fetch: fetchMock,
  });
  return (payload) => handler(null, payload);
}
const configOllama = { type: 'ollama' };

test('summarize : avec mesures, durées natives Ollama en liste fermée, sans contenu ni champ arbitraire', async () => {
  const lancer = handlerMain(configOllama, async () => new Response(JSON.stringify({
    message: { content: '  Résumé des faits  ' }, ...NATIFS, contenu: 'privé', model: 'qwen3.5:9b',
  })));
  const r = await lancer({ model: 'simule', messages: [{ role: 'user', content: 'privé' }], avecMesures: true });
  assert.equal(r.resume, 'Résumé des faits');
  assert.deepEqual(JSON.parse(JSON.stringify(r.mesures)), NATIFS);
  assert.doesNotMatch(JSON.stringify(r), /privé/);
});

test('summarize : sans avecMesures, le contrat historique (chaîne seule) est conservé', async () => {
  const lancer = handlerMain(configOllama, async () => new Response(JSON.stringify({ message: { content: 'Résumé' }, eval_count: 5 })));
  assert.equal(await lancer({ model: 'simule', messages: [] }), 'Résumé');
});

for (const avecMesures of [false, true]) test('summarize : échec HTTP ou levée reste null, mesures demandées = ' + avecMesures, async () => {
  const lancer = handlerMain(configOllama, async () => new Response('non', { status: 500 }));
  assert.equal(await lancer({ model: 'simule', messages: [], avecMesures }), null);
  const lever = handlerMain(configOllama, async () => { throw new Error('coupe'); });
  assert.equal(await lever({ model: 'simule', messages: [], avecMesures }), null);
});

test('summarize : fournisseur en ligne, tokens usage remappés, aucune durée native inventée', async () => {
  const config = { type: 'groq', id: 'groq', nom: 'Groq', baseUrl: 'https://api.test/v1', cle: 'cle-test' };
  const urls = [];
  const lancer = handlerMain(config, async (url) => {
    urls.push(url);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Résumé en ligne' } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
  });
  const r = await lancer({ model: 'simule', messages: [], avecMesures: true });
  assert.match(urls[0], /chat\/completions/);
  assert.equal(r.resume, 'Résumé en ligne');
  assert.deepEqual(JSON.parse(JSON.stringify(r.mesures)), { prompt_eval_count: 100, eval_count: 20 });
});

test('summarize : modèle non gratuit refusé avant tout appel, avec ou sans mesures', async () => {
  const lancer = handlerMain(configOllama, async () => { throw new Error('ne doit pas être appelé'); }, { gratuit: false });
  assert.equal(await lancer({ model: 'simule', messages: [], avecMesures: true }), null);
  assert.equal(await lancer({ model: 'simule', messages: [] }), null);
});
