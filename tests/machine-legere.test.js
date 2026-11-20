// Petite machine (peu de RAM, modèle sur le processeur) : consignes courtes, outils du dossier seulement, un seul modèle chargé
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { machineLegere, allegerConsignes, allegerMessages, dechargerAutres } = require('../principal/machine-legere');
const { outilsPour } = require('../principal/outils');
const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function vraiesConsignes({ project = '' } = {}) {
  const contexte = vm.createContext({
    prenom: 'Alex', perso: {}, project, knownProjects: [], memory: ['aime le vélo'], prof: false,
    modelSel: { value: 'qwen3:0.6b' }, fournisseurActif: () => ({ nom: 'Ollama' }), fournisseurLocal: () => true,
  });
  vm.runInContext(lire('interface/personnalite.js'), contexte);
  return vm.runInContext('systemPrompt()', contexte);
}

test('machineLegere : un portable de 5,7 Go oui, une machine de 8 ou 16 Go non', () => {
  const gio = 1024 ** 3;
  assert.equal(machineLegere(5.7 * gio), true);
  assert.equal(machineLegere(7.7 * gio), false);
  assert.equal(machineLegere(16 * gio), false);
});

test('allegerConsignes : les vraies consignes perdent les paragraphes du web et des images, gardent le reste', () => {
  const complet = vraiesConsignes();
  const leger = allegerConsignes(complet);
  assert.ok(leger.length < complet.length * 0.7, `${leger.length} / ${complet.length}`);
  assert.doesNotMatch(leger, /chercher_web|lire_page_web|lire_document|Wikimedia/);
  assert.match(leger, /Nous sommes en \d{4}\./);
  assert.match(leger, /tu ne peux ni créer ni modifier d'image/);
  for (const garde of ["Tu es Cat Ai", "Tu tutoies Alex", "blocs ```", "Tu tournes avec le modèle qwen3:0.6b", "aime le vélo", "Ne prétends pas enregistrer"]) {
    assert.ok(leger.includes(garde), garde);
  }
  // Un document joint : sa consigne reste
  assert.match(allegerConsignes(complet, { documents: true }), /lire_document/);
  // Avec un dossier ouvert, les consignes du dossier restent entières
  const projet = allegerConsignes(vraiesConsignes({ project: '/home/alex/site' }));
  assert.match(projet, /Dossier ouvert : \/home\/alex\/site/);
  assert.match(projet, /remplacer_texte/);
});

test('allegerMessages : seules les consignes système principales changent', () => {
  const messages = [
    { role: 'system', content: vraiesConsignes() },
    { role: 'system', name: 'contexte_projet', content: 'Pour une doc (Linux, une commande… garder tel quel' },
    { role: 'user', content: 'Pour une doc (Linux, une commande, un langage) : question' },
  ];
  const r = allegerMessages(messages);
  assert.notEqual(r[0].content, messages[0].content);
  assert.equal(r[1], messages[1]);
  assert.equal(r[2], messages[2]);
});

test('outilsPour legere : ni web ni ouvrir_dossier ; le dossier et les documents restent', () => {
  const noms = (mode) => outilsPour(mode).map((o) => o.function.name);
  assert.deepEqual(noms({ projet: false, documents: false, legere: true }), []);
  const dossier = noms({ projet: true, documents: true, legere: true });
  assert.ok(dossier.includes('lire_fichier') && dossier.includes('remplacer_texte') && dossier.includes('lire_document'));
  assert.ok(!dossier.includes('chercher_web') && !dossier.includes('ouvrir_dossier'));
  assert.ok(noms({ projet: false, documents: false }).includes('chercher_web'), 'machine normale inchangée');
});

test('dechargerAutres : décharge les autres modèles, jamais celui qu on va utiliser', async () => {
  const appels = [];
  const requete = async (url, init = {}) => {
    appels.push([url, init.body]);
    if (url.endsWith('/api/ps')) return { ok: true, json: async () => ({ models: [{ name: 'qwen3.5:9b' }, { name: 'qwen3:0.6b' }] }) };
    return { ok: true };
  };
  assert.deepEqual(await dechargerAutres('http://x', 'qwen3:0.6b', { requete }), ['qwen3.5:9b']);
  assert.deepEqual(appels[1], ['http://x/api/generate', JSON.stringify({ model: 'qwen3.5:9b', keep_alive: 0 })]);
  assert.deepEqual(await dechargerAutres('http://x', 'm', { requete: async () => { throw new Error('éteint'); } }), []);
});

test('envoi et préchauffage appliquent les mêmes allègements', () => {
  const envoi = lire('principal/envoi.js');
  assert.match(envoi, /const GARDER_CHARGE = LEGERE \? '5m' : '30m';/);
  assert.match(envoi, /if \(legere\) await dechargerAutres\(OLLAMA, modele, \{ signal \}\);/);
  assert.match(envoi, /messages: rappelsPourOllama\(legere \? allegerMessages\(messages, options\) : messages\), tools: outilsPour\(legere \? \{ \.\.\.options, legere \} : options\)/);
  const main = lire('main.js');
  assert.match(main, /outilsPour\(\{ prof, projet: !!projectDir, documents: false, connecteur: .*?, legere: LEGERE \}\)/);
  assert.match(main, /if \(LEGERE\) messages = allegerMessages\(messages\);/);
  assert.match(main, /if \(LEGERE\) await dechargerAutres\(OLLAMA, modele, \{ signal \}\);/);
});

test('petite machine : l envoi attend le préchauffage au lieu de l arrêter, un préchauffage n en remplace pas un autre', () => {
  const main = lire('main.js');
  assert.match(main, /if \(!LEGERE\) prechauffage\?\.arret\.abort\(\);\s*libererOllama = await fileOllama\.prendre\(\{ signal: controller\.signal,/);
  assert.match(main, /if \(LEGERE && prechauffage\) return false;\s*prechauffage\?\.arret\.abort\(\);/);
});

test('petite machine : réponses courtes demandées, l interface laisse le processeur au modèle', () => {
  const { BREF } = require('../principal/machine-legere');
  const leger = allegerConsignes(vraiesConsignes());
  assert.ok(leger.includes(BREF));
  assert.ok(leger.indexOf(BREF) > leger.indexOf('Tu adaptes ta réponse'));
  assert.match(lire('main.js'), /ipcMain\.handle\('machine-legere', \(\) => LEGERE\);/);
  assert.match(lire('preload.js'), /machineLegere: \(\) => ipcRenderer\.invoke\('machine-legere'\)/);
  const r = lire('renderer.js');
  assert.match(r, /flux\.idRendu = setTimeout\(rendre, machineLegere \? RENDU_LEGER : 16\);/);
  assert.match(r, /ChatNoir\.intervalle = 100;\s*ChatNoir\.enPause = fluxLocalEnCours;/);
  assert.match(lire('interface/barre-laterale.js'), /if \(legere !== true \|\| lireRetenu\("sansAnimations"\) !== null\) return;/);
});

test('chat.js : la boucle saute les images selon la cadence et s arrête pendant la pause', () => {
  const source = lire('chat.js');
  const debut = source.indexOf('ChatNoir.intervalle = 0;');
  const boucle = source.slice(debut, source.indexOf('})(performance.now());', debut) + 22);
  const images = [];
  let suivante;
  const ChatNoir = { tous: new Set([{ animer: (t) => images.push(t) }]) };
  vm.runInNewContext(boucle.replace('})(performance.now());', '})(0);'), { ChatNoir, performance: { now: () => 0 }, requestAnimationFrame: (f) => (suivante = f) });
  ChatNoir.intervalle = 100;
  for (const t of [16, 50, 101, 150, 202]) suivante(t);
  assert.deepEqual(images, [0, 101, 202]);
  ChatNoir.enPause = () => true;
  suivante(400);
  assert.deepEqual(images, [0, 101, 202]);
});
