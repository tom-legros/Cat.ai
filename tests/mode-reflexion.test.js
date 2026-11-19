// Mode de génération : Rapide (think:false) et Réflexion (think:true).
// Transport : think demandé, repli silencieux sur les modèles qui refusent, chantier inchangé,
// caractères de réflexion collectés. Coutures : handler 'chat', IPC capacités, bouton et persistance.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const lire = (nom) => fs.readFileSync(path.join(__dirname, '..', nom), 'utf8');
const { envoyerOllama } = require('../principal/envoi');
const messages = [{ role: 'user', content: 'Question de test' }];
const apresOutil = [...messages, { role: 'tool', content: 'résultat' }];

// Réponse française complète et courte (sous DEBUT_A_VERIFIER) pour rester sur un appel unique
const FR = { message: { content: 'Voici le résultat attendu.' }, done: true, eval_count: 5 };

// Capture des corps envoyés à /api/chat : le champ think de chaque requête, avec une file de réponses.
async function capture(messagerie, modele, options, reponses, t) {
  const corps = [];
  const file = [...reponses];
  t.mock.method(globalThis, 'fetch', async (_url, o) => {
    corps.push(JSON.parse(o.body));
    return file.shift();
  });
  const r = await envoyerOllama(messagerie, modele, () => {}, null, options);
  return { r, corps };
}
const rep = (objet) => new Response(Array.isArray(objet) ? objet.map(JSON.stringify).join('\n') : JSON.stringify(objet) + '\n');

test('mode Réflexion : think:true envoyé quand l\'utilisateur le demande', async (t) => {
  const { corps } = await capture(messages, 'reflexion-ok', { reflexion: true }, [rep(FR)], t);
  assert.deepEqual(corps.map((c) => c.think), [true]);
});

test('mode Rapide par défaut : think:false, comportement historique inchangé', async (t) => {
  const { corps } = await capture(messages, 'reflexion-off', {}, [rep(FR)], t);
  assert.deepEqual(corps.map((c) => c.think), [false]);
});

test('modèle qui refuse la réflexion (400) : repli silencieux sans réflexion, réponse conservée', async (t) => {
  const { r, corps } = await capture(messages, 'reflexion-refus', { reflexion: true },
    [new Response('ce modèle ne sait pas réfléchir', { status: 400 }), rep(FR)], t);
  assert.equal(r.content, FR.message.content);
  assert.deepEqual(corps.map((c) => c.think), [true, false]);
  // Le refus est retenu : l'appel suivant ne tente plus la réflexion (une seule requête, think:false)
  const suite = await capture(messages, 'reflexion-refus', { reflexion: true }, [rep(FR)], t);
  assert.deepEqual(suite.corps.map((c) => c.think), [false]);
});

test('après outil en mode Réflexion : les appels restent en think:true, relance de langue préservée', async (t) => {
  const trames = [
    { message: { content: 'Okay, I will look for the file and then I will see what is in the file. '.repeat(3) } },
    { message: { content: 'Voici la réponse en français.' }, done: true, eval_count: 5 },
  ];
  const { r, corps } = await capture(apresOutil, 'reflexion-outil', { reflexion: true }, [rep(trames[0]), rep(trames[1])], t);
  assert.equal(r.content, trames[1].message.content);
  assert.deepEqual(corps.map((c) => c.think), [true, true]);
});

test('chantier inchangé : think:false même quand la Réflexion est demandée', async (t) => {
  const { corps } = await capture(messages, 'reflexion-chantier', { chantier: true, reflexion: true }, [rep(FR)], t);
  assert.deepEqual(corps.map((c) => c.think), [false]);
});

test('statistiques : caractères de réflexion comptés quand Ollama les envoie, aucun contenu retenu', async (t) => {
  const mesures = [];
  const trames = rep([
    { message: { thinking: 'Je réfléchis au calcul. ' }, done: false },
    { message: { content: 'Voici le résultat attendu.' }, done: true, total_duration: 9000000000, eval_count: 30, eval_duration: 4000000000 },
  ]);
  t.mock.method(globalThis, 'fetch', async () => trames);
  await envoyerOllama(messages, 'reflexion-mesure', () => {}, null, { reflexion: true, onStatistiques: (m) => mesures.push(m) });
  assert.equal(mesures.length, 1);
  assert.equal(mesures[0].reflexionCaracteres, 'Je réfléchis au calcul. '.length);
  assert.equal(mesures[0].reflexion, true);
  assert.doesNotMatch(JSON.stringify(mesures), /réfléchis au calcul|résultat attendu/);
  // Sans phase de réflexion séparée : aucune clé inventée
  const vides = [];
  t.mock.method(globalThis, 'fetch', async () => rep(FR));
  await envoyerOllama(messages, 'reflexion-mesure-vide', () => {}, null, { onStatistiques: (m) => vides.push(m) });
  assert.equal(vides[0].reflexionCaracteres, undefined);
});

test('affichage statistiques : ligne raisonnement quand fournie, absence sinon', () => {
  const source = lire('renderer.js');
  const debut = source.indexOf('function texteStatistiquesOllama(');
  const fin = source.indexOf('\n}', debut) + 2;
  const formater = vm.runInNewContext(source.slice(debut, fin) + '\ntexteStatistiquesOllama;');
  const avec = formater([{ requetes: 1, termine: true, reflexion: true, reflexionCaracteres: 1234, eval_count: 70, eval_duration: 2000000000 }]);
  assert.match(avec, /Raisonnement : 1\s?234 caractères de réflexion/);
  const sans = formater([{ requetes: 1, termine: true, reflexion: false, eval_count: 70, eval_duration: 2000000000 }]);
  assert.doesNotMatch(sans, /Raisonnement/);
});

// Handler 'capacites-modele' : le bouton n'apparaît que pour un modèle Ollama avec la capability « thinking ».
const sourceMain = lire('main.js');
const extraitCapacites = () => sourceMain.slice(sourceMain.indexOf("ipcMain.handle('capacites-modele'"), sourceMain.indexOf('\n});', sourceMain.indexOf("ipcMain.handle('capacites-modele'")) + 4);
function handlerCapacites(config, reponseJson, fetchDefaut) {
  let handler;
  const appels = [];
  vm.runInNewContext(extraitCapacites(), {
    ipcMain: { handle: (_c, fn) => { handler = fn; } },
    infosFournisseur: () => config,
    OLLAMA: 'http://ollama-test',
    AbortSignal,
    fetch: fetchDefaut || (async (url, o) => {
      appels.push({ url, corps: JSON.parse(o.body) });
      return { json: async () => reponseJson };
    }),
  });
  return { lancer: (payload) => handler(null, payload), appels };
}

test('capacités : thinking annoncé par Ollama → bouton Réflexion possible', async () => {
  const h = handlerCapacites({ type: 'ollama' }, { capabilities: ['completion', 'tools', 'thinking'] });
  const r = await h.lancer({ fournisseurId: 'ollama', modele: 'qwen3.5:9b' });
  assert.equal(r.reflexion, true);
  assert.equal(h.appels.length, 1);
  assert.equal(h.appels[0].corps.model, 'qwen3.5:9b');
});

test('capacités : sans capability thinking, erreur réseau ou fournisseur en ligne → pas de bouton', async () => {
  const sans = handlerCapacites({ type: 'ollama' }, { capabilities: ['completion'] });
  assert.equal((await sans.lancer({ fournisseurId: 'ollama', modele: 'autre' })).reflexion, false);
  // fetch qui jette (Ollama arrêté) : le handler renvoie false au lieu de faire planter l'interface
  const echec = handlerCapacites({ type: 'ollama' }, undefined, async () => { throw new Error('Ollama arrêté'); });
  assert.equal((await echec.lancer({ fournisseurId: 'ollama', modele: 'q' })).reflexion, false);
  // Fournisseur en ligne : réponse immédiate, aucun appel à Ollama
  const enLigne = handlerCapacites({ type: 'groq', baseUrl: 'https://api.test/v1' }, { capabilities: ['thinking'] });
  assert.equal((await enLigne.lancer({ fournisseurId: 'groq', modele: 'x' })).reflexion, false);
  assert.equal(enLigne.appels.length, 0, 'aucun appel à Ollama pour un fournisseur en ligne');
});

// Coutures du câblage : payload, persistance, bouton et IPC exposés — vérifiées sur les sources.
test('câblage : payload chat, préférence persistée, bouton masqué si incapable, IPC exposé', () => {
  const renderer = lire('renderer.js');
  assert.match(renderer, /reflexion: reflexion && reflexionPossible/, 'le mode part avec le chat, forcé à false si le modèle ne le permet pas');
  assert.match(renderer, /localStorage\.setItem\("modeReflexion", reflexion \? "1" : "0"\)/);
  assert.match(renderer, /localStorage\.getItem\("modeReflexion"\) === "1"/);
  assert.match(renderer, /boutonReflexion\.hidden = !reflexionPossible/);
  assert.match(renderer, /majModeReflexion\(f\)/, 'vérification au chargement des modèles');
  assert.match(renderer, /majModeReflexion\(fournisseurActif\(\)\)/, 'vérification au changement de modèle');
  const html = lire('index.html');
  const bouton = html.match(/<button id="mode-reflexion"[^>]*>/);
  assert.ok(bouton, 'le bouton Réflexion existe dans la barre du chat');
  assert.match(bouton[0], /aria-haspopup="menu"/);
  assert.match(bouton[0], /hidden/, 'masqué tant que la capacité du modèle n\'est pas connue');
  assert.match(lire('preload.js'), /capacitesModele/);
  assert.match(sourceMain, /fournisseurId = 'ollama', reflexion = false/, 'le handler du chat reçoit le mode');
  assert.match(sourceMain, /reflexion === true \? \{ reflexion: true \} : \{\}/, 'option du transport Ollama seulement');
});
