// Les consignes de personnalité sont partagées avec la CLI.
const test = require('node:test');
require('./helpers/machine-normale.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('la salutation dépend du début de discussion, l’assistant reste neutre et le mode prof reste présent', () => {
  const source = fs.readFileSync(path.join(__dirname, '../interface/personnalite.js'), 'utf8');
  const contexte = vm.createContext({
    prenom: 'Alex', perso: {}, project: '', knownProjects: [], memory: [], prof: true,
    modelSel: { value: 'qwen3.5:9b' }, fournisseurActif: () => ({ nom: 'Ollama' }),
    fournisseurLocal: () => true
  });
  vm.runInContext(source, contexte);
  const premier = vm.runInContext('systemPrompt()', contexte);
  const suivant = vm.runInContext('systemPrompt({ discussionEntamee: true })', contexte);
  assert.match(premier, /Au premier échange, tu peux saluer/);
  assert.match(suivant, /Va directement à la réponse, sans resaluer/);
  assert.doesNotMatch(suivant, /Au premier échange/);
  for (const consignes of [premier, suivant]) {
    assert.match(consignes, /Tu es Cat Ai, l'assistant de bureau de Alex/);
    assert.match(consignes, /Présente-toi seulement si on te demande qui tu es/);
    assert.match(consignes, /MODE PROF ACTIVÉ/);
    // L'assistant ne doit plus avoir de personnalité de chat imposée
    assert.doesNotMatch(consignes, /chat noir|félin|feline|malicieux|ronron|griffe|sieste|croquettes|miaou|compagnon en pixels/i);
  }
  const capture = vm.runInContext(`systemPrompt({modele:'gemini-flash', fournisseur:{nom:'Gemini'}, modeProf:false})`, contexte);
  assert.match(capture, /modèle gemini-flash/);
  assert.doesNotMatch(capture, /MODE PROF ACTIVÉ/);
});

test('séparation assistant / mascotte : phrases amusantes au clic seulement, consignes utiles conservées', () => {
  const source = fs.readFileSync(path.join(__dirname, '../interface/personnalite.js'), 'utf8');
  const contexte = vm.createContext({
    prenom: 'Alex', perso: {}, project: '', knownProjects: [], memory: [], prof: false,
    modelSel: { value: 'qwen3.5:9b' }, fournisseurActif: () => ({ nom: 'Ollama' }),
    fournisseurLocal: () => true
  });
  vm.runInContext(source, contexte);
  const [REPLIQUES, consignes] = vm.runInContext('[REPLIQUES, systemPrompt()]', contexte);
  // La mascotte garde ses phrases amusantes, réservées au clic
  assert.ok(REPLIQUES.clics.length >= 3);
  assert.ok(REPLIQUES.clics.some((r) => /ronron|griffe/i.test(r)), 'les clics restent féins');
  // Plus de réplique amusante en dehors du clic ; les messages restants sont fonctionnels
  for (const cle of ['accueil', 'heures', 'longueSession', 'fichierRecu']) assert.equal(REPLIQUES[cle], undefined, cle);
  assert.equal(Object.keys(REPLIQUES.projets).length, 0, 'aucune réplique de projet de base ; perso.json peut en ajouter');
  for (const cle of ['reveil', 'ollamaOff', 'prof', 'normal']) {
    assert.equal(typeof REPLIQUES[cle], 'string');
    assert.doesNotMatch(REPLIQUES[cle], /sieste|ronron|griffe|croquettes|renifl|oreilles|caresses/i, cle);
  }
  // Aucune phrase de clic ne fuite dans les consignes du modèle
  for (const phrase of REPLIQUES.clics) assert.ok(!consignes.includes(phrase));
  // Les consignes utiles à la qualité restent présentes
  for (const ancre of ['Aucun emoji', 'blocs ```', 'chercher_web', 'lire_page_web', 'lire_document',
    "N'invente jamais d'adresse", 'Ne prétends pas enregistrer de souvenir', 'comme un bon prof',
    'sans formule de politesse à la fin']) {
    assert.ok(consignes.includes(ancre), ancre);
  }
});

test('les salutations isolées sont retirées même quand Ollama coupe les mots et le prénom', () => {
  const source = fs.readFileSync(path.join(__dirname, '../interface/personnalite.js'), 'utf8');
  const filtrer = vm.runInNewContext(source + '\nsansSalutation;');
  for (const [reponse, attendue] of [
    ['Salut ! Pas de souci, voici une branche Git.', 'Pas de souci, voici une branche Git.'],
    ['Bonjour Alex ! Un commit est un point dans l’historique.', 'Un commit est un point dans l’historique.'],
    ['Bonsoir.\n\n    exemple de code', '    exemple de code'],
    ['**Salut !** Prêt à te parler de branches Git ?', 'Prêt à te parler de branches Git ?'],
    ['__Bonjour Alex__ ! Une branche isole un travail.', 'Une branche isole un travail.'],
    ['*Bonsoir !* Un commit enregistre un état.', 'Un commit enregistre un état.'],
    ['Une branche est un pointeur. Salut !', 'Une branche est un pointeur. Salut !']
  ]) {
    const morceaux = Array.from(reponse, (_, i) => filtrer(reponse.slice(0, i + 1), 'Alex', false));
    assert.ok(morceaux.every((m) => !m || attendue.startsWith(m)), reponse);
    assert.equal(filtrer(reponse, 'Alex', true), attendue);
  }
  for (const texte of ['« Salut ! » est familier.', 'Bonjour est une formule de politesse.', '> Salut !\n\nUne citation.', 'BonjourAlex !', '**Salut** est un mot familier.', '**Salut ! Quelle nouvelle**', '`Salut !`']) {
    assert.equal(filtrer(texte, 'Alex', true), texte);
  }
  assert.equal(filtrer('Une', 'Alex', true), 'Une');
  assert.equal(filtrer('Bon', 'Alex', true), 'Bon');
});

test('trois tours de Discussion conservent l’historique envoyé à Ollama et filtrent les salutations après le premier', async (t) => {
  const { discuter } = require('../principal/agent');
  const { envoyerOllama } = require('../principal/envoi');
  const { LIMITES_OLLAMA } = require('../principal/taille');
  const lire = (nom) => fs.readFileSync(path.join(__dirname, '..', nom), 'utf8');
  const renderer = lire('renderer.js');
  // Exécuter les fonctions du renderer dans un environnement minimal, sans lancer la fenêtre.
  const entre = (debut, fin) => renderer.slice(renderer.indexOf(debut), renderer.indexOf(fin, renderer.indexOf(debut)));
  const trames = [
    ['Sa', 'lut !', ' Ça va bien.'],
    ['*', '*Sa', 'lut !*', '*', ' Une branche Git est un pointeur.'],
    ['Bonjour A', 'lex !', ' Un commit enregistre un état.']
  ];
  const requetes = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const morceaux = trames[requetes.length];
    requetes.push(JSON.parse(options.body));
    return new Response(morceaux.map((content) => JSON.stringify({ message: { content } })).concat('{"done":true}').join('\n'));
  });
  const contexte = vm.createContext({
    prenom: 'Alex', perso: {}, project: '', knownProjects: [], memory: [], prof: false,
    modelSel: { value: 'qwen3.5:9b' }, fournisseurActif: () => ({ nom: 'Ollama', type: 'ollama' }),
    fournisseurLocal: () => true, reglages: { actif: 'ollama' },
    reflexion: false, reflexionPossible: false, modeAuto: false, project: null, // mode de génération (Réflexion) : hors périmètre de ce test
    fluxParConv: new Map(), preparations: new Map(), current: null, performance, crypto: require('node:crypto').webcrypto,
    fluxParId(id) { for (const flux of contexte.fluxParConv.values()) if (flux.id === id) return flux; return null; },
    setTimeout, clearTimeout, machineLegere: false, RENDU_LEGER: 250,
    bulle: { closest: () => ({}), classList: { add() {}, remove() {} } },
    chat: { sautiller() {}, expression() {} }, renderMarkdown: (s) => s, animerQcm: () => {}, envoyerDepuisQcm: () => () => {},
    renderList() {}, compterMessage() {}, resumerSiBesoin() {}, projectInfo: () => '',
    majBoutonEnvoi() {}, majVeille() {}, budgetConsignes: () => '', fonctionsExperimentales: () => true,
    enBas: () => false, ajouterActionsMessage() {}, finirFlux(flux) { contexte.fluxParConv.delete(flux.conv); },
    save() {}, addMessage: () => ({ bulle: contexte.bulle, chat: contexte.chat }),
    LIGNE_ACTION: /[^]*/g,
    window: { api: { chat: (p) => { contexte.demande = p; }, onChunk: (fn) => { contexte.morceau = fn; }, onDone: (fn) => { contexte.fin = fn; } } }
  });
  vm.runInContext([
    lire('interface/personnalite.js'),
    entre('function configurationDuTour(', 'async function send('),
    entre('const sansEtiquettes', 'function budgetConsignes'),
    entre('async function lancerReponse', 'const SILENCE_LONG'),
    entre('window.api.onChunk(', "// Retire le JSON brut"),
    entre('window.api.onDone(', 'window.api.onError(')
  ].join('\n'), contexte);
  const conv = contexte.current = { messages: [] };
  const questions = ['Salut Cat, comment tu vas ?', 'Explique-moi simplement à quoi sert une branche Git.', 'Et un commit ?'];
  const attendues = ['Salut ! Ça va bien.', 'Une branche Git est un pointeur.', 'Un commit enregistre un état.'];
  for (const [i, question] of questions.entries()) {
    conv.messages.push({ role: 'user', content: question });
    contexte.question = question;
    await vm.runInContext('lancerReponse(current, question)', contexte);
    const { id, messages } = contexte.demande;
    const etiquette = i === 1 ? '\n\nAction de test \n\n' : '';
    if (etiquette) contexte.fluxParConv.get(contexte.current).text = etiquette;
    await discuter({
      messages, modele: 'qwen3.5:9b', envoyer: envoyerOllama, limites: LIMITES_OLLAMA, ctx: {},
      ev: { morceau: (text) => {
        contexte.morceau({ id, text });
        if (i) assert.doesNotMatch(contexte.bulle.innerHTML.replace(/[^]*/g, '').trim(), /^(?:sa(?:l|lut)?\b|bonjour\b)/i);
      } }
    });
    contexte.fin({ id });
    assert.equal(conv.messages.at(-1).content, (etiquette + attendues[i]).trim());
    const tours = requetes[i].messages.filter((m) => m.role !== 'system');
    assert.deepEqual(tours.map((m) => m.role), Array.from({ length: 2 * i + 1 }, (_, j) => j % 2 ? 'assistant' : 'user'));
    for (let j = 0; j <= i; j++) {
      assert.ok(tours[2 * j].content.endsWith(questions[j]));
      if (j < i) assert.equal(tours[2 * j + 1].content, attendues[j]);
    }
    assert.match(requetes[i].messages[0].content, i === 0 ? /Au premier échange/ : /sans resaluer/);
    if (i > 0) assert.match(tours.at(-1).content, /La conversation continue/);
  }
});


test('continuité : le rappel variable ne détruit pas le préfixe des consignes et de la mémoire', () => {
  const source = fs.readFileSync(path.join(__dirname, '../interface/personnalite.js'), 'utf8');
  const contexte = vm.createContext({ prenom: 'Test', perso: {}, project: '', knownProjects: [], memory: ['Souvenir synthétique'], prof: true,
    modelSel: { value: 'qwen3.5:9b' }, fournisseurActif: () => ({ nom: 'Ollama' }), fournisseurLocal: () => true });
  vm.runInContext(source, contexte);
  const premier = vm.runInContext('systemPrompt()', contexte);
  const suivant = vm.runInContext('systemPrompt({ discussionEntamee: true })', contexte);
  let prefixe = 0;
  while (premier[prefixe] && premier[prefixe] === suivant[prefixe]) prefixe++;
  assert.ok(prefixe > premier.indexOf('Souvenir synthétique'));
  assert.ok(prefixe > premier.indexOf('MODE PROF ACTIVÉ'));
  assert.ok(prefixe >= Math.min(premier.length, suivant.length) - 150);
});
