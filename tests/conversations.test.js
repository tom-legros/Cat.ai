
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
const entre = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
const suspendre = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function cadre() {
  const classes = new Set(); const wrap = { classList: { add: n => classes.add(n) } };
  const bulle = { innerHTML: '', classList: { add() {}, remove() {} }, closest: () => wrap };
  const c = vm.createContext({
    performance, crypto: require('node:crypto').webcrypto, Date, clearInterval, veilleSilence: null,
    current: { id: 'origine', messages: [{ role: 'user', content: 'Question' }] },
    fluxParConv: new Map(), preparations: new Map(), erreursEnAttente: new Map(),
    prof: false, reflexion: false, reflexionPossible: true, modelSel: { value: 'qwen3.5:9b' }, reglages: { actif: 'ollama' },
    compterMessage() {}, renderList() {}, afficherFlux() {}, budgetConsignes: () => '',
    majBoutonEnvoi() {}, majVeille() {}, majSaisie() {}, ligneAttente() {},
    rendrePiecesA: (conv, liste) => { (c.piecesRendues ??= []).push({ conv, liste }); },
    retenirRecent() {},
    addMessage: (...args) => { c.ajout = args; return { bulle, chat: { reflechit: false } }; },
    systemPrompt: ({ modele }) => 'Consignes ' + modele,
    fournisseurActif: () => ({ type: c.reglages.actif }),
    projectInfo: async () => '', resumerSiBesoin: async () => {},
    messagesPourLeModele: (conv, modeProf) => [...conv.messages, { role: 'system', content: 'Prof ' + modeProf }],
    window: { api: { chat: p => { (c.demandes ?? (c.demandes = [])).push(p); }, onChunk: (fn) => { c.morceau = fn; } } },
  });
  c.conversationOccupee = (conv) => c.fluxParConv.has(conv) || c.preparations.has(conv);
  c.fluxParId = (id) => { for (const flux of c.fluxParConv.values()) if (flux.id === id) return flux; return null; };
  vm.runInContext(entre('function configurationDuTour(', 'async function send(') + entre('async function lancerReponse(', '// Les étiquettes de l’app peuvent') + entre('window.api.onChunk(', '// Retire le JSON brut'), c);
  return { c, bulle, classes };
}
const dejaPret = (c) => (c.demandes ?? []);

test('une réponse garde fournisseur, modèle, modes et consignes pendant son résumé', async () => {
  const { c } = cadre(); const attente = suspendre();
  c.resumerSiBesoin = (_conv, _bulle, _stats, choix) => { c.choixResume = choix; return attente.promise; };
  const t = c.lancerReponse(c.current, 'Question');
  c.reglages.actif = 'gemini'; c.modelSel.value = 'gemini-flash'; c.prof = true; c.reflexion = true;
  attente.resolve(); await t;
  assert.equal(c.demandes.at(-1).fournisseurId, 'ollama'); assert.equal(c.demandes.at(-1).model, 'qwen3.5:9b');
  assert.equal(c.demandes.at(-1).prof, false); assert.equal(c.demandes.at(-1).reflexion, false);
  assert.equal(c.choixResume.model, 'qwen3.5:9b'); assert.equal(c.choixResume.fournisseurId, 'ollama');
  assert.equal(c.demandes.at(-1).messages[0].content, 'Consignes qwen3.5:9b');
  assert.equal(c.demandes.at(-1).messages.at(-1).content, 'Prof false');
});
test('une erreur de préparation ne laisse pas une réponse en attente sans diagnostic', async () => {
  const { c, bulle, classes } = cadre(); c.projectInfo = async () => { throw Error('Projet indisponible'); };
  await c.lancerReponse(c.current, 'Question');
  assert.match(bulle.textContent, /Projet indisponible/); assert.equal(classes.has('error'), true);
  assert.equal(dejaPret(c).length, 0); assert.equal(c.fluxParConv.size, 0);
});
test('les identifiants de réponse ne dépendent pas de deux horloges à la même milliseconde', async () => {
  const { c } = cadre(); c.Date = { now: () => 100 };
  await c.lancerReponse(c.current, 'Question'); const premier = c.demandes.at(-1).id;
  await c.lancerReponse(c.current, 'Question'); assert.notEqual(c.demandes.at(-1).id, premier);
});

test('un échec immédiat de l’envoi libère l’état de génération', async () => {
  const { c, bulle } = cadre(); c.window.api.chat = () => { throw Error('IPC indisponible'); };
  await c.lancerReponse(c.current, 'Question');
  assert.equal(c.fluxParConv.size, 0);
  assert.match(bulle.textContent, /IPC indisponible/);
});

test('une erreur de détection du projet est signalée et libère la préparation', async () => {
  const { c } = cadre(); let termine = false;
  Object.assign(c, { pieces: [], detectProject: async () => { throw Error('Dossier indisponible'); }, renderPieces() {},
    terminerPreparation() { termine = true; } });
  vm.runInContext(entre('async function send(', 'function terminerPreparation('), c);
  await c.send('Bonjour');
  assert.equal(termine, true);
  assert.equal(c.ajout[0], 'error'); assert.match(c.ajout[1], /Dossier indisponible/);
  assert.equal(dejaPret(c).length, 0);
});

test('le message reste dans sa conversation si on navigue pendant la vérification du dossier', async () => {
  const { c } = cadre(); const attente = suspendre(); const origine = c.current;
  Object.assign(c, { MAX_IMAGES: 3, pieces: [], project: '', convs: [origine], messagesEnvoyes: 0, renderPieces() {}, save() {}, terminerPreparation() {},
    detectProject: () => attente.promise, lancerReponse: async (conv, text, contexte, remplace, configuration) => { c.destination = conv; c.configuration = configuration; } });
  vm.runInContext(entre('async function send(', 'function terminerPreparation('), c);
  const t = c.send('Bonjour'); c.current = { id: 'autre', messages: [] };
  c.modelSel.value = 'autre-modele'; c.reglages.actif = 'gemini';
  attente.resolve(null); await t;
  assert.equal(c.destination, origine); assert.equal(origine.messages.at(-1).content, 'Bonjour');
  assert.equal(c.current.messages.length, 0);
  assert.equal(c.configuration.choix.model, 'qwen3.5:9b');
  assert.equal(c.configuration.choix.fournisseurId, 'ollama');
});

/* --- Indépendance des discussions côté interface --- */
test('deux discussions génèrent en même temps : flux séparés, requêtes séparées, modèles figés', async () => {
  const { c } = cadre();
  const peu = c.current;
  const autre = { id: 'autre', messages: [{ role: 'user', content: 'Salut' }] };
  await c.lancerReponse(peu, 'Question');
  c.reglages.actif = 'groq'; c.modelSel.value = 'llama-atlas'; // autre fournisseur pendant la première génération
  await c.lancerReponse(autre, 'Salut');
  assert.equal(c.demandes.length, 2);
  assert.notEqual(c.demandes[0].id, c.demandes[1].id);
  assert.equal(c.demandes[0].model, 'qwen3.5:9b', 'la première discussion garde son modèle');
  assert.equal(c.demandes[1].model, 'llama-atlas');
  assert.equal(c.fluxParConv.size, 2, 'deux réponses vivantes en même temps');
  assert.equal(c.fluxParConv.get(peu).local, true);
  assert.equal(c.fluxParConv.get(autre).local, false, 'la seconde peut être en ligne (Gemini/Groq) pendant Ollama');
});
test('les fragments vont à la bonne discussion, même en naviguant', async () => {
  const { c } = cadre();
  const peu = c.current;
  const autre = { id: 'autre', messages: [{ role: 'user', content: 'Salut' }] };
  await c.lancerReponse(peu, 'Question');
  await c.lancerReponse(autre, 'Salut');
  c.morceau({ id: c.demandes[0].id, text: 'Réponse A ' });
  c.morceau({ id: c.demandes[1].id, text: 'Réponse B' });
  assert.equal(c.fluxParConv.get(peu).text, 'Réponse A ');
  assert.equal(c.fluxParConv.get(autre).text, 'Réponse B');
  c.current = autre; // navigation : la bulle de « autre » est affichée, celle de « peu » reste vivante
  c.morceau({ id: c.demandes[0].id, text: 'suite' });
  assert.equal(c.fluxParConv.get(peu).text, 'Réponse A suite');
  assert.equal(c.fluxParConv.get(peu).conv, peu);
});
test('un envoi dans une discussion occupée est refusé, une autre discussion passe', async () => {
  const { c } = cadre();
  const occupee = c.current;
  Object.assign(c, { MAX_IMAGES: 3, pieces: [], project: '', convs: [occupee], messagesEnvoyes: 0, renderPieces() {}, save() {}, detectProject: async () => null,
    terminerPreparation(conv) { c.preparations.delete(conv); } });
  vm.runInContext(entre('async function send(', 'function terminerPreparation('), c);
  c.preparations.set(occupee, { conv: occupee });
  await c.send('Encore'); // destination = la discussion occupée : refusé, sans erreur ni requête
  assert.equal(dejaPret(c).length, 0);
  assert.equal(occupee.messages.length, 1);
  const autre = { id: 'autre', messages: [] };
  await c.send('Salut', autre); // pendant ce temps, une autre discussion peut envoyer
  assert.equal(c.demandes.length, 1);
  assert.equal(autre.messages.at(-1).content, 'Salut');
  assert.equal(c.fluxParConv.get(autre).conv, autre);
  assert.equal(c.fluxParConv.get(occupee), undefined);
  assert.equal(c.fluxParConv.size, 1);
});
test('la fin d’un flux libère sa discussion seulement : celle du milieu continue', async () => {
  const { c } = cadre();
  const un = { id: 'un', messages: [{ role: 'user', content: 'Un' }] };
  const deux = { id: 'deux', messages: [{ role: 'user', content: 'Deux' }] };
  await c.lancerReponse(un, 'Un');
  await c.lancerReponse(deux, 'Deux');
  finFluxTest(c, c.demandes[0].id);
  assert.equal(c.fluxParConv.has(un), false, 'finie');
  assert.equal(c.fluxParConv.has(deux), true, 'toujours vivante');
  assert.equal(c.fluxParConv.size, 1);
});
function finFluxTest(c, id) {
  // finirFlux, extrait comme le vrai renderer : la fin d'une réponse libère sa discussion
  vm.runInContext(entre('function finirFlux(', 'window.api.onDone('), c);
  c.finirFlux(c.fluxParId(id));
}

/* --- Messages : actions et conversation vidée --- */
function cadreSuppression() {
  const elements = new Map();
  const element = id => { if (!elements.has(id)) elements.set(id, { value: '', focus() {}, showModal() {}, textContent: '' }); return elements.get(id); };
  let sauvegardes = 0, rendus = 0;
  const c = vm.createContext({
    $: element, conversationOccupee: () => false, erreursEnAttente: new Map(),
    current: null, convs: [], save: () => sauvegardes++, renderConv: () => rendus++,
    modelSel: { value: 'simule' }, reglages: { actif: 'ollama' },
    input: { focus() {} }, messagesEl: { scrollTop: 0, querySelectorAll: () => [] },
  });
  vm.runInContext(entre('function ouvrirActionMessage(', '// Le texte suit la réponse'), c);
  return { c, element, sauvegardes: () => sauvegardes, rendus: () => rendus };
}

test('supprimer le dernier message retire la discussion vide de l’historique et rend l’accueil', () => {
  const { c, element, sauvegardes, rendus } = cadreSuppression();
  const conv = { id: 'seule', messages: [{ role: 'user', content: 'Seul message' }], resumeJusqua: 1 };
  c.convs = [conv]; c.current = conv;
  c.erreursEnAttente.set(conv, { wrap: {}, bulle: {} });
  c.ouvrirActionMessage(conv, conv.messages[0], 'supprimer');
  element('#message-dialog').onsubmit({ submitter: { value: 'valider' } });
  assert.deepEqual(c.convs, []);
  assert.equal(c.current, null);
  assert.equal(c.erreursEnAttente.has(conv), false);
  assert.equal(sauvegardes(), 1); assert.equal(rendus(), 1);
});

test('modifier toujours possible, mais la discussion occupée refuse tout changement', () => {
  const { c, element, sauvegardes } = cadreSuppression();
  const conv = { id: 'trois', messages: [{ role: 'user', content: 'Un' }, { role: 'assistant', content: 'Deux' }, { role: 'user', content: 'Trois' }] };
  c.convs = [conv]; c.current = conv;
  c.ouvrirActionMessage(conv, conv.messages[2], 'supprimer');
  element('#message-dialog').onsubmit({ submitter: { value: 'valider' } });
  assert.deepEqual(conv.messages.map(m => m.content), ['Un', 'Deux']);
  assert.deepEqual(c.convs, [conv]); // il reste des messages : la discussion reste
  assert.equal(c.current, conv);
  assert.equal(sauvegardes(), 1);
});

function fauxElement(tag) {
  const e = { tag, enfants: [], classes: new Set(), attributs: {}, innerHTML: '', textContent: '', type: null };
  e.append = (...cs) => e.enfants.push(...cs);
  e.setAttribute = (k, v) => { e.attributs[k] = v; };
  e.classList = { add: (...n) => n.forEach(x => e.classes.add(x)) };
  e.children = e.enfants;
  Object.defineProperty(e, 'lastElementChild', { get: () => e.enfants.at(-1) });
  return e;
}
test('barres d’actions : Modifier seulement sur l’utilisateur ; Copier, Régénérer et Supprimer sur la réponse', () => {
  const c = vm.createContext({});
  // Tout le monde DOM vit dans le vm : les objets qui traversent la frontière seraient enveloppés
  const prelude = `
    const fauxElement = (tag) => {
      const e = { tag, enfants: [], classes: new Set(), attributs: {}, innerHTML: '', textContent: '', type: null };
      e.append = (...cs) => e.enfants.push(...cs);
      e.setAttribute = (k, v) => { e.attributs[k] = v; };
      e.classList = { add: (...n) => n.forEach(x => e.classes.add(x)) };
      Object.defineProperty(e, 'lastElementChild', { get: () => e.enfants.at(-1) });
      return e;
    };
    const document = { createElement: (tag) => fauxElement(tag) };
    const icone = (dessin) => '<i>' + dessin + '</i>';
    const ouvrirActionMessage = () => {}; const regenererReponse = () => {};
  `;
  const inspection = `
    (() => {
      const conv = { messages: [{ role: 'user', content: 'Question' }, { role: 'assistant', content: 'Réponse' }] };
      const utilisateur = document.createElement('div');
      const reponse = document.createElement('div'); const corps = document.createElement('div');
      reponse.append(document.createElement('canvas'), corps);
      ajouterActionsMessage(utilisateur, conv, conv.messages[0]);
      ajouterActionsMessage(reponse, conv, conv.messages[1]);
      const convPasDerniere = { messages: [...conv.messages, { role: 'user', content: 'Suite' }] };
      const ancienne = document.createElement('div'); const corpsAncienne = document.createElement('div');
      ancienne.append(document.createElement('canvas'), corpsAncienne);
      ajouterActionsMessage(ancienne, convPasDerniere, convPasDerniere.messages[1]);
      const titres = (barre) => barre.enfants.filter((x) => x.tag === 'button').map((b) => b.title);
      return {
        utilisateur: titres(utilisateur.enfants.at(-1)),
        reponse: titres(reponse.lastElementChild.enfants.at(-1)),
        ancienne: titres(ancienne.lastElementChild.enfants.at(-1)),
        barreReponseDansCorps: reponse.enfants.at(-1) === corps && corps.enfants.length === 1,
        barreUtilisateurALaRacine: utilisateur.enfants.length === 1 && utilisateur.enfants[0].tag === 'div',
      };
    })()
  `;
  const rapport = vm.runInContext(prelude + entre('function ajouterActionsMessage(', 'function ouvrirActionMessage(') + inspection, c);
  assert.deepEqual([...rapport.utilisateur], ['Copier le message', 'Modifier le message', 'Supprimer le message']);
  assert.deepEqual([...rapport.reponse], ['Copier le message', 'Régénérer la dernière réponse', 'Supprimer le message']);
  assert.deepEqual([...rapport.ancienne], ['Copier le message', 'Supprimer le message']);
  assert.deepEqual([rapport.barreReponseDansCorps, rapport.barreUtilisateurALaRacine], [true, true]);
});

