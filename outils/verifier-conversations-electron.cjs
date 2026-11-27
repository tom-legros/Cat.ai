// Vérification du vrai renderer Electron, transports simulés, profil temporaire sans données personnelles.
// Un seul scénario : les discussions indépendantes.
// Phase A (moteur) : file Ollama, confirmations d'écriture séquentielles, annulation du premier envoi.
// Phase B (interface) : deux discussions envoient en même temps par le vrai composeur, navigation pendant
// une génération, résultats et fragments rattachés à leur discussion, carré ciblé, messages (édition
// réservée aux messages de l'utilisateur, suppression jusqu'à conversation vide).
// Lancer : node_modules/.bin/electron outils/verifier-conversations-electron.cjs
const { app, ipcMain, dialog } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '..');
const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-conversations-'));
const dossierA = path.join(profil, 'projet-a'), dossierB = path.join(profil, 'projet-b');
fs.mkdirSync(dossierA); fs.mkdirSync(dossierB);
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dossierB] });
app.setAppPath(repo);
app.setPath('userData', profil);
app.setPath('documents', profil);
fs.writeFileSync(path.join(profil, 'settings.json'), JSON.stringify({ prenom: 'Test', projectDir: dossierA }));
fs.writeFileSync(path.join(profil, 'fournisseurs.json'), JSON.stringify({ actif: 'ollama', modeles: { ollama: 'qwen3.5:9b' } }));
let libererTransportA;
const appelsTransport = [];
const arretsTest = [];
global.fetch = async (url, options = {}) => {
  const u = new URL(url);
  if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') throw Error('Réseau externe désactivé dans ce test');
  if (u.pathname === '/api/chat' && JSON.parse(options.body).stream) {
    const corps = JSON.parse(options.body);
    appelsTransport.push(corps.model);
    if (corps.model === 'qwen3.5:9b' && !libererTransportA) await new Promise(resolve => { libererTransportA = resolve; });
    const retourOutil = corps.messages.some(m => m.role === 'tool');
    return new Response(JSON.stringify({ done: true, message: retourOutil ? { content: 'Terminé.' }
      : { content: '', tool_calls: [{ function: { name: 'ecrire_fichier', arguments: { chemin: 'preuve.txt', contenu: corps.model } } }] } }) + '\n');
  }
  const data = u.pathname === '/api/tags' || u.pathname === '/api/ps'
    ? { models: [{ name: 'qwen3.5:9b', size: 6000000000, size_vram: 6000000000 }] }
    : u.pathname === '/api/show' ? { capabilities: ['completion', 'thinking'] }
    : { version: '0.20.0', done: true, message: { content: '' } };
  return new Response(JSON.stringify(data));
};
const resultats = [];
const pause = ms => new Promise(r => setTimeout(r, ms));
let termine = false;
function finir(code, erreur) {
  if (termine) return;
  termine = true;
  const bilan = { transport: 'simulé', resultats, erreur: erreur?.stack };
  fs.writeFileSync(path.join(profil, 'resultat.json'), JSON.stringify(bilan, null, 2));
  console.log(JSON.stringify({ profil, ...bilan }));
  app.exit(code);
}
setTimeout(() => finir(1, Error('Limite de 90 secondes')), 90000);
require(path.join(repo, 'main.js'));

async function attendre(js, expression) {
  for (let i = 0; i < 100; i++) { if (await js(expression)) return; await pause(50); }
  throw Error('Condition non atteinte : ' + expression);
}
const capturer = async (index, nombre) => { for (let i = 0; i < 100 && requetesUI.length < nombre; i++) await pause(50); assert.ok(requetesUI[index], 'l’envoi part par le vrai composeur'); };
let requetesUI = [];

// Phase A — la file du processus principal et les confirmations d'écriture, avec le vrai handler chat.
async function verifierFileOllamaEtConfirmations(js) {
  await js(`window.finsTest = []; window.etatsTest = [];
    window.api.onDone(p => finsTest.push(p)); window.api.onChatEtat(p => etatsTest.push(p));
    window.api.chat({id:'A', model:'qwen3.5:9b', fournisseurId:'ollama', messages:[{role:'user',content:'Crée preuve.txt'}]});`);
  for (let i = 0; i < 100 && !libererTransportA; i++) await pause(50);
  assert.ok(libererTransportA, 'le premier transport a démarré');
  await js('window.api.openProject()'); // le sélecteur natif est simulé, le handler et le dossier sont réels
  await attendre(js, 'document.querySelector("#projet-groupe").hidden === false');
  libererTransportA();
  await attendre(js,'confirmationEnCours !== null');
  assert.equal(await js('document.querySelector("#diff-chemin").textContent'), path.join(dossierA, 'preuve.txt'));
  resultats.push('Outils : dossier A conservé après sélection du dossier B pendant le transport');
  await js(`window.api.chat({id:'B', model:'qwen3.5:4b', fournisseurId:'ollama', messages:[{role:'user',content:'Crée preuve.txt'}]});
    window.sauvegardeTest = window.api.saveCode({chemin:'manuel.txt', contenu:'Enregistrement manuel'}); void 0;`);
  await attendre(js,'etatsTest.some(e => e.id === "B" && e.etat === "attente-ollama")');
  assert.equal(appelsTransport.includes('qwen3.5:4b'), false);
  await pause(100); await js('window.api.stop("A")');
  await attendre(js,'finsTest.some(e => e.id === "A" && e.interrompu)');
  await attendre(js,'document.querySelector("#diff-chemin").textContent.endsWith("manuel.txt") && !document.querySelector("#diff-modal").hidden');
  await attendre(js,'!document.querySelector("#diff-accepter").disabled');
  await js('document.querySelector("#diff-accepter").click()');
  assert.equal((await js('sauvegardeTest')).ok, true);
  await attendre(js,'document.querySelector("#diff-chemin").textContent.endsWith("preuve.txt") && !document.querySelector("#diff-modal").hidden');
  assert.equal(await js('document.querySelector("#diff-chemin").textContent'), path.join(dossierB, 'preuve.txt'));
  await attendre(js,'!document.querySelector("#diff-accepter").disabled');
  await js('document.querySelector("#diff-accepter").click()');
  await attendre(js,'finsTest.some(e => e.id === "B" && !e.interrompu)');
  assert.equal(fs.existsSync(path.join(dossierA, 'preuve.txt')), false);
  assert.equal(fs.readFileSync(path.join(dossierB, 'preuve.txt'), 'utf8'), 'qwen3.5:4b');
  assert.equal(fs.readFileSync(path.join(dossierB, 'manuel.txt'), 'utf8'), 'Enregistrement manuel');
  resultats.push('File Ollama : B attend A puis démarre ; annulation A sans écriture ni refus de B/Enregistrer');
  resultats.push('Confirmations : affichage séquentiel, validations réelles et fichiers temporaires vérifiés');
}

// Phase B — deux discussions en parallèle dans le renderer : envois par le vrai composeur,
// le « transport » est remplacé par le vérificateur (les évènements chat-chunk/chat-done partent d'ici).
async function verifierDiscussionsEnParallele(js, fenetre) {
  ipcMain.removeAllListeners('chat'); ipcMain.removeAllListeners('chat-stop');
  requetesUI = [];
  ipcMain.on('chat', (event, payload) => { requetesUI.push({ event, payload }); });
  ipcMain.on('chat-stop', (_e, id) => { arretsTest.push(id); });
  await js(`window.origine = { id: 'test-origine', title: 'Origine', messages: [] };
    window.autre = { id: 'test-autre', title: 'Autre', messages: [] };
    convs = [origine, autre]; current = origine; renderConv();`);
  // Historique : recherche filtrante, Échap l'efface, suppression en deux temps, persistance réelle
  await js(`window.histA = { id: 'hist-a', title: 'Recherche Python', messages: [{ role: 'user', content: 'Comment écrire une boucle en Python ?' }] };
    window.histB = { id: 'hist-b', title: 'Recette de crêpes', messages: [{ role: 'user', content: 'Farine, lait, œufs.' }] };
    convs = [histA, histB]; current = histA; renderConv();`);
  assert.equal(await js('document.querySelectorAll("#conv-list li").length'), 2);
  await js(`document.querySelector('#conv-recherche').value = 'python';
    document.querySelector('#conv-recherche').dispatchEvent(new Event('input', { bubbles: true }));`);
  assert.equal(await js('document.querySelectorAll("#conv-list li").length'), 1);
  assert.equal(await js('document.querySelector("#conv-statut").textContent'), '1 discussion trouvée.');
  await js(`document.querySelector('#conv-recherche').value = 'introuvable';
    document.querySelector('#conv-recherche').dispatchEvent(new Event('input', { bubbles: true }));`);
  assert.equal(await js('document.querySelectorAll("#conv-list li").length'), 0);
  assert.match(await js('document.querySelector("#conv-statut").textContent'), /Aucune discussion/);
  await js(`document.querySelector('#conv-recherche').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
  assert.equal(await js('document.querySelector("#conv-recherche").value'), '');
  assert.equal(await js('document.querySelectorAll("#conv-list li").length'), 2);
  await js(`document.querySelector('#conv-list li:not(.is-active) .suppr').click();`);
  assert.equal(await js('document.querySelectorAll("#conv-list li").length'), 2);
  assert.equal(await js('!!document.querySelector(".conv__confirmation")'), true);
  assert.equal(await js('document.activeElement.textContent'), 'Garder');
  await js(`document.querySelector('.conv__confirmation .lien:not(.lien--danger)').click();`);
  assert.equal(await js('document.querySelectorAll("#conv-list li").length'), 2);
  await js(`document.querySelector('#conv-list li:not(.is-active) .suppr').click();
    document.querySelector('.conv__confirmation .lien--danger').click();`);
  assert.equal(await js('document.querySelectorAll("#conv-list li").length'), 1);
  assert.equal(await js('document.activeElement.matches("#conv-list .conv__ouvrir, #new-chat")'), true);
  resultats.push('Historique : recherche filtrante, Échap l’efface, suppression confirmée et focus rendu');
  // Persistance : l'état est écrit sur le disque par le vrai handler, et relu tel quel
  await js(`convs = [histA, histB]; current = histA; renderConv();`);
  await js('save().then(() => true)');
  await pause(100);
  const disqueConvs = JSON.parse(fs.readFileSync(path.join(profil, 'conversations.json'), 'utf8'));
  assert.equal(disqueConvs.length, 2);
  assert.equal(disqueConvs[0].title, 'Recherche Python');
  assert.equal((await js('window.api.loadConvs()')).length, 2);
  resultats.push('Historique : persistance réelle sur le disque et relecture par loadConvs');
  await js(`convs = [origine, autre]; current = origine; renderConv();`);
  // Composeur : les deux modes portent un libellé lisible (et non une icône seule)
  assert.deepEqual(await js(`[...document.querySelectorAll('#mode-prof .pastille__etiquette, #mode-reflexion .pastille__etiquette')].map(e => e.textContent)`),
    ['Prof', 'Rapide']);
  // Sélecteur unique : fournisseur + modèle dans un seul menu, recherche filtrante, Échap rend le focus
  await js(`document.querySelector('#modele-raccourci').click();`);
  await attendre(js, '!document.querySelector("#menu-modeles").hidden');
  assert.equal(await js('!!document.querySelector("#menu-modeles .menu-modeles__recherche")'), true);
  assert.deepEqual(await js(`[...document.querySelectorAll('#menu-modeles .menu-modeles__titre--fournisseur')].map(e => e.textContent)`), ['Ollama']);
  assert.ok(await js(`document.querySelectorAll('#menu-modeles .menu-modeles__choix').length >= 1`));
  await js(`{ const r = document.querySelector('#menu-modeles .menu-modeles__recherche');
    r.value = 'qwen3.5'; r.dispatchEvent(new Event('input')); }`);
  assert.deepEqual(await js(`[...document.querySelectorAll('#menu-modeles .menu-modeles__liste .menu-modele .menu-modele__nom')].map(e => e.textContent)`), ['qwen3.5:9b']);
  await js(`document.querySelector('#menu-modeles .menu-modeles__recherche')
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
  assert.equal(await js('document.querySelector("#menu-modeles").hidden'), true);
  assert.equal(await js('document.activeElement.id'), 'modele-raccourci');
  resultats.push('Sélecteur unique : fournisseur + modèle groupés, recherche filtrante, Échap ferme et rend le focus au bouton');
  // Ergonomie : l'historique est au clavier, Ctrl+K ouvre le sélecteur, les fenêtres gardent le focus
  assert.equal(await js('document.querySelectorAll("#conv-list button.conv__ouvrir").length'), 2);
  assert.equal(await js('document.querySelector("#conv-list li.is-active .conv__ouvrir").getAttribute("aria-current")'), 'page');
  await js(`document.querySelector('#conv-list li:not(.is-active) .conv__ouvrir').focus();`);
  assert.equal(await js('document.activeElement.matches("#conv-list .conv__ouvrir")'), true);
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));`);
  assert.equal(await js('document.querySelector("#menu-modeles").hidden'), false);
  assert.equal(await js('document.activeElement.classList.contains("menu-modeles__recherche")'), true);
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));`);
  assert.equal(await js('document.querySelector("#menu-modeles").hidden'), true);
  assert.equal(await js('document.activeElement.id'), 'modele-raccourci');
  // Réglages : aria-modal, Maj+Tab boucle vers la dernière commande, Échap ferme et rend le focus
  await js(`document.querySelector('#open-reglages').click();`);
  assert.equal(await js('document.querySelector("#reglages-modal").getAttribute("aria-modal")'), 'true');
  assert.equal(await js('document.activeElement.id'), 'close-reglages');
  await js(`document.querySelector('#close-reglages').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));`);
  assert.equal(await js('document.activeElement.id !== "close-reglages" && document.querySelector("#reglages-modal").contains(document.activeElement)'), true);
  await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
  assert.equal(await js('document.querySelector("#reglages-modal").hidden'), true);
  assert.equal(await js('document.activeElement.id'), 'open-reglages');
  // Mémoire : même contrat de fenêtre modale
  await js(`document.querySelector('#open-memory').click();`);
  assert.equal(await js('document.querySelector("#memory-modal").getAttribute("aria-modal")'), 'true');
  assert.equal(await js('document.activeElement.id'), 'close-memory');
  await js(`document.querySelector('#memory-modal').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
  assert.equal(await js('document.activeElement.id'), 'open-memory');
  resultats.push('Ergonomie : historique focusable et annoncé, Ctrl+K ouvre/ferme le sélecteur, fenêtres modales qui bouclent le focus et le rendent');
  // Réglages : une clé factice est enregistrée pour de vrai, jamais en clair, puis supprimée en deux temps
  await js(`document.querySelector('#open-reglages').click();`);
  // Les clés sont dans Cerveau › En ligne (un onglet à la fois)
  await js(`document.querySelector('[data-section="reglages-section-cerveau"]').click(); document.querySelector('[data-moteur="ligne"]').click();`);
  const carteGroq = `[...document.querySelectorAll('.fournisseur')].find(c => c.querySelector('.fournisseur__nom')?.textContent === 'Groq')`;
  await js(`{ const c = ${carteGroq}; c.querySelector('input[type="password"]').value = 'gsk_faux_pour_verification';
    c.requestSubmit(); }`);
  await attendre(js, `(${carteGroq})?.querySelector('.fournisseur__etat')?.textContent === 'Clé enregistrée'`);
  assert.equal(await js(`reglages.fournisseurs.find(f => f.id === 'groq').aCle`), true);
  let disque = JSON.parse(fs.readFileSync(path.join(profil, 'fournisseurs.json'), 'utf8'));
  assert.ok(disque.fournisseurs.groq.cleChiffree, 'la clé est écrite sur le disque');
  assert.doesNotMatch(JSON.stringify(disque), /gsk_faux_pour_verification/, 'aucune clé en clair sur le disque');
  // Premier clic : la clé reste, la confirmation s'affiche et le choix sûr a le focus
  await js(`(${carteGroq}).querySelector('.fournisseur__oublier').click();`);
  assert.equal(await js(`!!(${carteGroq}).querySelector('.fournisseur__confirmation')`), true);
  assert.equal(await js('document.activeElement.textContent'), 'Garder');
  disque = JSON.parse(fs.readFileSync(path.join(profil, 'fournisseurs.json'), 'utf8'));
  assert.ok(disque.fournisseurs.groq.cleChiffree, 'la clé reste tant que la confirmation n’est pas donnée');
  // « Garder » referme la demande sans toucher à la clé
  await js(`(${carteGroq}).querySelector('.fournisseur__confirmation .lien:not(.lien--danger)').click();`);
  assert.equal(await js(`!!(${carteGroq}).querySelector('.fournisseur__etat.is-ok')`), true);
  // Confirmation explicite : la clé disparaît du disque, le focus revient à la carte
  await js(`(${carteGroq}).querySelector('.fournisseur__oublier').click();`);
  await js(`(${carteGroq}).querySelector('.lien--danger').click();`);
  await attendre(js, `(${carteGroq})?.querySelector('.fournisseur__etat')?.textContent === 'Pas de clé'`);
  disque = JSON.parse(fs.readFileSync(path.join(profil, 'fournisseurs.json'), 'utf8'));
  assert.equal(disque.fournisseurs.groq?.cleChiffree, undefined);
  assert.equal(await js(`document.activeElement.matches('.fournisseur[data-fournisseur="groq"] .bouton')`), true);
  await js(`document.querySelector('#close-reglages').click();`);
  resultats.push('Réglages : clé factice chiffrée sur disque (jamais en clair), suppression en deux temps avec « Garder », focus rendu à la carte');
  // Envoi réel dans « origine » : le transport ne répond pas encore (génération en cours)
  await js(`document.querySelector('#input').value = 'Question origine';
    document.querySelector('#composer').requestSubmit();`);
  await capturer(0, 1);
  assert.equal(requetesUI[0].payload.model, 'qwen3.5:9b');
  assert.ok(requetesUI[0].payload.messages.at(-1).content.includes('Question origine'));
  // Pendant ce temps : navigation, fournisseur en ligne, pièce jointe, envoi réel dans « autre »
  // (le fournisseur simulé est déclaré côté renderer : le préchauffage Ollama ne doit pas le toucher)
  await js(`current = autre; renderConv();
    if (!reglages.fournisseurs.some(f => f.id === 'gemini')) reglages.fournisseurs.push({ id: 'gemini', type: 'openai', nom: 'Gemini simulé' });
    reglages.actif = 'gemini';
    modelSel.insertAdjacentHTML('beforeend', '<option value="autre-modele"></option>');
    modelSel.value = 'autre-modele';
    pieces.push({ nom: 'note.txt', contenu: 'Contenu du document', joint: 'Contenu du document', document: 'doc-test' }); renderPieces();
    document.querySelector('#input').value = 'Question autre';
    document.querySelector('#composer').requestSubmit();`);
  await capturer(1, 2);
  assert.equal(requetesUI[1].payload.fournisseurId, 'gemini');
  assert.equal(requetesUI[1].payload.model, 'autre-modele');
  assert.deepEqual(requetesUI[1].payload.documents, ['doc-test']);
  assert.deepEqual(await js('[origine.messages.length, autre.messages.length, fluxParConv.size]'), [1, 1, 2]);
  assert.equal(await js('document.querySelectorAll("#conv-list li.is-en-cours").length'), 2);
  // Une discussion qui reçoit un message remonte en tête de l'historique
  assert.equal(await js('convs[0].id'), 'test-autre');
  resultats.push('Interface : deux envois en même temps (Ollama retenu, fournisseur en ligne simulé), pièce jointe emportée, les deux discussions marquées en cours');
  // Formats : un .pptx est refusé au moment de le joindre, avec un message dédié (pas après envoi)
  const cheminPptx = path.join(profil, 'diapo.pptx');
  fs.writeFileSync(cheminPptx, 'faux pptx');
  const refusPptx = await js(`window.api.readDropped(${JSON.stringify(cheminPptx)})`);
  assert.match(refusPptx.erreur, /Word, PowerPoint ou Excel/);
  assert.match(refusPptx.erreur, /Exporte-le en PDF/);
  resultats.push('Composeur : libellés Prof/Rapide et dossier affiché seulement quand il est ouvert ; .pptx refusé avant l’envoi avec la solution PDF');
  // La réponse Gemini se rattache à « autre » ; la génération d'« origine » reste vivante
  requetesUI[1].event.sender.send('chat-chunk', { id: requetesUI[1].payload.id, text: 'Réponse gemini.' });
  await pause(100);
  requetesUI[1].event.sender.send('chat-done', { id: requetesUI[1].payload.id, statistiquesOllama: [], nombreOutils: 0 });
  await attendre(js, `autre.messages.at(-1)?.content === 'Réponse gemini.'`);
  assert.equal(await js('fluxParConv.size'), 1);
  assert.equal(await js('!!fluxParConv.get(origine)'), true);
  assert.equal(await js('document.querySelectorAll("#conv-list li.is-en-cours").length'), 1);
  // Un fragment pour « origine » pendant qu'on regarde « autre » : routé par identifiant
  requetesUI[0].event.sender.send('chat-chunk', { id: requetesUI[0].payload.id, text: 'Réponse origine. ' });
  await pause(100);
  assert.ok(await js(`fluxParConv.get(origine).text.includes('Réponse origine')`));
  // Retour dans « origine » : la bulle vivante reprend sa place, le carré suit la discussion affichée
  await js('current = origine; renderConv();');
  assert.equal(await js('document.querySelectorAll("#messages .msg").length'), 2); // le message de l'utilisateur + la bulle vivante
  assert.ok(await js(`document.querySelector('#messages .msg.assistant .bulle-msg').textContent.includes('Réponse origine')`));
  assert.equal(await js('document.querySelector("#send").classList.contains("is-stop")'), true);
  resultats.push('Résultats par discussion : réponse Gemini rattachée après navigation, bulle d’« Origine » intacte, carré affiché pour elle');
  // Le carré n'arrête que la discussion affichée : « autre » a déjà fini, « origine » reçoit l'arrêt
  await js('document.querySelector("#send").click();');
  for (let i = 0; i < 100 && !arretsTest.length; i++) await pause(50);
  assert.equal(arretsTest.length, 1);
  assert.equal(arretsTest[0], requetesUI[0].payload.id);
  await pause(100);
  requetesUI[0].event.sender.send('chat-done', { id: requetesUI[0].payload.id, interrompu: true });
  await attendre(js, `origine.messages.length === 2 && origine.messages.at(-1).content.includes('Réponse origine')`);
  assert.equal(await js('fluxParConv.size'), 0);
  assert.equal(await js('document.querySelector("#send").classList.contains("is-stop")'), false);
  resultats.push('Annulation ciblée : le carré n’envoie l’arrêt que pour la discussion affichée ; la réponse interrompue reste enregistrée');
  // Les barres d'actions : la réponse du chat garde Copier/Régénérer/Supprimer, sans Modifier
  assert.deepEqual(await js(`[...document.querySelectorAll('#messages .msg.assistant button')].map(b => b.title)`),
    ['Copier le message', 'Régénérer la dernière réponse', 'Supprimer le message']);
  assert.deepEqual(await js(`[...document.querySelectorAll('#messages .msg.user button')].map(b => b.title)`),
    ['Copier le message', 'Modifier le message', 'Supprimer le message']);
  // L'édition est aussi refusée au niveau de la fonction : aucune boite ne s'ouvre pour une réponse du chat
  await js(`ouvrirActionMessage(origine, origine.messages[1], 'modifier');`);
  assert.equal(await js('document.querySelector("#message-dialog").open'), false);
  // Modifier un message utilisateur du préfixe résumé : le résumé est invalidé
  await js(`origine.resume = 'Résumé existant'; origine.resumeJusqua = 1;
    ouvrirActionMessage(origine, origine.messages[0], 'modifier');
    document.querySelector('#message-dialog-texte').value = 'Question corrigée';`);
  await attendre(js, '!document.querySelector("#message-dialog-valider").disabled');
  await js(`document.querySelector('#message-dialog form').requestSubmit(document.querySelector('#message-dialog-valider'));`);
  await pause(100);
  assert.equal(await js('origine.messages[0].content'), 'Question corrigée');
  assert.equal(await js('origine.resume === undefined && origine.resumeJusqua === undefined'), true);
  resultats.push('Messages : Modifier seulement sur les messages de l’utilisateur ; résumé conservé hors préfixe, invalidé dans le préfixe');
  // Supprimer le dernier message : la discussion vidée sort de l'historique, retour au nouveau chat
  await js(`window.seule = { id: 'test-seule', title: 'Seule', messages: [{ role: 'user', content: 'Seul message' }] };
    convs = [seule]; current = seule; renderConv();
    ouvrirActionMessage(seule, seule.messages[0], 'supprimer');`);
  await attendre(js, '!document.querySelector("#message-dialog-valider").disabled');
  await js(`document.querySelector('#message-dialog form').requestSubmit(document.querySelector('#message-dialog-valider'));`);
  await pause(100);
  assert.deepEqual(await js('[convs.length, current]'), [0, null]);
  assert.equal(await js('document.querySelectorAll("#messages .msg").length'), 0);
  assert.equal(await js('document.querySelector("#welcome").hidden'), false);
  resultats.push('Conversation vidée : supprimer le dernier message retire la discussion de l’historique et rend l’accueil');
  // Persistance après fermeture : l'état écrit est relu au redémarrage de la fenêtre
  await js(`convs = [origine, autre]; current = origine; renderConv(); save().then(() => true);`);
  await pause(100);
  const disqueFinal = JSON.parse(fs.readFileSync(path.join(profil, 'conversations.json'), 'utf8'));
  assert.ok(disqueFinal.some((c) => c.id === 'test-origine'));
  assert.ok(disqueFinal.some((c) => c.id === 'test-autre'));
  const recharge = new Promise((resolve) => fenetre.webContents.once('did-finish-load', resolve));
  fenetre.webContents.reload();
  await recharge;
  for (let i = 0; i < 100; i++) { try { if (await js('typeof interfacePrete !== "undefined" && interfacePrete')) break; } catch {} await pause(100); }
  await attendre(js, 'typeof convs !== "undefined" && convs.length >= 2');
  assert.ok(await js('convs.some((c) => c.id === "test-origine")'));
  assert.equal(await js('current'), null);
  resultats.push('Historique : persistance réelle et relecture après redémarrage de la fenêtre');
}

app.on('browser-window-created', (_event, fenetre) => {
  fenetre.webContents.once('did-finish-load', async () => {
    const js = texte => fenetre.webContents.executeJavaScript(texte);
    fenetre.webContents.on('console-message', (_e, niveau, message) => {
      if (niveau >= 2) { try { fenetre.webContents.executeJavaScript(`window.__erreurs.push(${JSON.stringify(message)})`); } catch {} }
    });
    try {
      for (let i = 0; i < 100; i++) {
        if (await js('typeof interfacePrete !== "undefined" && interfacePrete && !!modelSel.value')) break;
        await pause(100);
      }
      await js('window.__erreurs = [];');
      await verifierFileOllamaEtConfirmations(js);
      await verifierDiscussionsEnParallele(js, fenetre);
      finir(0);
    } catch (err) {
      try {
        const etat = await js(`({ flux: fluxParConv.size, preparations: preparations.size, confirmation: confirmationEnCours,
          actif: reglages.actif, modele: modelSel.value, options: [...modelSel.options].map(o => o.value),
          statut: statusEl.textContent, prof, input: document.querySelector('#input').value,
          textes: [...document.querySelectorAll('#messages .msg')].map(m => m.className + ' :: ' + m.textContent.slice(0, 80)),
          erreurs: window.__erreurs })`);
        etat.diagnostics = 'état au moment de l’échec';
        console.log(JSON.stringify({ sonde: etat }, null, 2));
      } catch {}
      finir(1, err);
    }
  });
});
