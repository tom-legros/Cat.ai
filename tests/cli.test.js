// catai dans le terminal : options, consignes et infos du projet, sans modèle
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { configurerStockage } = require('../principal/stockage');
const { lireOptions, consignes, infosProjet } = require('../cli/catai');

test('lireOptions : plus d options à retenir, seulement la question (et --aide)', () => {
  const o = lireOptions(['explique', 'main.js']);
  assert.equal(o.question, 'explique main.js');
  assert.equal(o.dossier, process.cwd());
  assert.equal(lireOptions(['--aide']).aide, true);
});

test('affichage : « ● » au début, lignes suivantes décalées, actions sous « ⎿ », Tab complète les commandes', () => {
  const { creerSortie, completer } = require('../cli/catai');
  let texte = '';
  const sortie = creerSortie((t) => { texte += t; });
  sortie.action('lit main.js');
  sortie.texte('\nBonjour');
  sortie.texte(' toi.\nDeuxième ligne');
  sortie.fin();
  assert.equal(texte.replace(/\x1b\[[0-9;]*m/g, ''), '  ⎿  lit main.js\n● Bonjour toi.\n  Deuxième ligne\n');
  assert.deepEqual(completer('/mo')[0], ['/modele', '/modeles']);
  assert.ok(completer('/')[0].includes('/chantier'));
  assert.deepEqual(completer('bonjour')[0], []);
});

test('consignes : les mêmes que dans l app, avec le prénom, le dossier et le mode prof', () => {
  const donnees = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-cli-'));
  fs.writeFileSync(path.join(donnees, 'settings.json'), JSON.stringify({ prenom: 'Alex' }));
  configurerStockage({ dossier: donnees });
  const c = consignes({ prof: true, dossier: 'C:/Projets/demo', modele: 'qwen3:8b' });
  assert.match(c, /Alex/);
  assert.match(c, /C:\/Projets\/demo/);
  assert.match(c, /MODE PROF/);
  assert.doesNotMatch(consignes({ prof: false, dossier: 'C:/Projets/demo', modele: 'qwen3:8b' }), /MODE PROF/);
});

test('infosProjet : la liste des fichiers et le contenu de ceux que la question cite', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-cli-projet-'));
  fs.writeFileSync(path.join(d, 'calcul.js'), 'function somme(a, b) { return a - b; }\n');
  fs.writeFileSync(path.join(d, 'autre.js'), 'x\n');
  const infos = infosProjet(d, 'corrige calcul.js');
  assert.match(infos, /Fichiers du dossier ouvert :\n(.*\n)*.*calcul\.js/);
  assert.match(infos, /Contenu de calcul\.js :\n```\nfunction somme/);
  assert.doesNotMatch(infos, /Contenu de autre\.js/);
});

test('rappelRecherche : une vraie question de doc fait chercher, une demande d écriture ou « ne lis pas de page » non', () => {
  const vm = require('node:vm');
  const contexte = {};
  vm.createContext(contexte);
  vm.runInContext(require('fs').readFileSync(require('path').join(__dirname, '../interface/personnalite.js'), 'utf8') + '\nthis.fautChercher = (q) => rappelRecherche(q) !== null;', contexte);
  assert.equal(contexte.fautChercher('comment installer docker sur debian ?'), true);
  assert.equal(contexte.fautChercher('redige et genere le plan plan.md et donne la commande que je dois executer'), false);
  assert.equal(contexte.fautChercher('propose moi un plan ne lis pas de page, juste la commande'), false);
  assert.equal(contexte.fautChercher('salut ça va ?'), false);
});

test('commande : les commandes de la discussion changent les réglages, une inconnue ne part pas au modèle', async (t) => {
  const { commande } = require('../cli/catai');
  t.mock.method(process.stdout, 'write', () => true);
  const o = { modele: 'qwen3:8b', fournisseur: 'ollama', prof: false, dossier: __dirname };
  const conversation = [{ role: 'user', content: 'x' }];
  assert.equal(await commande('/modele qwen3.5:4b', { o, conversation }), true);
  assert.equal(o.modele, 'qwen3.5:4b');
  assert.equal(await commande('/prof', { o, conversation }), true);
  assert.equal(o.prof, true);
  assert.equal(await commande('/dossier ..', { o, conversation }), true);
  assert.equal(o.dossier, require('path').resolve(__dirname, '..'));
  assert.equal(await commande('/oublier', { o, conversation }), true);
  assert.equal(conversation.length, 0);
  assert.equal(await commande('/nimporte', { o, conversation }), true);
  assert.equal(await commande('/q', { o, conversation }), 'quitter');
  assert.equal(await commande('une vraie question', { o, conversation }), false);
});

test('filtre de réflexion : la réflexion en anglais avant « </think> » n est jamais écrite ; une vraie réponse passe', () => {
  const { creerFiltrePensee } = require('../cli/catai');
  const { langueProbable } = require('../principal/envoi');
  let ecrit = '';
  let f = creerFiltrePensee((t) => { ecrit += t; }, { langue: langueProbable });
  for (const m of ["Okay, let's see. The user wants the capital of Australia. ", 'I know it is Canberra, but people often think of Sydney, so I should be careful here.', '</think>\n\nCanberra']) f.texte(m);
  f.fin();
  assert.equal(ecrit, 'Canberra');
  // Une réponse en français passe telle quelle, dès que le début est vu
  ecrit = '';
  f = creerFiltrePensee((t) => { ecrit += t; }, { langue: langueProbable });
  f.texte('La photosynthèse est le processus par lequel les plantes utilisent la lumière du soleil pour fabriquer leur nourriture. ');
  f.texte('Suite.');
  f.fin();
  assert.equal(ecrit, 'La photosynthèse est le processus par lequel les plantes utilisent la lumière du soleil pour fabriquer leur nourriture. Suite.');
  // Une réponse courte, finie avant la vérification, est écrite à la fin
  ecrit = '';
  f = creerFiltrePensee((t) => { ecrit += t; }, { langue: langueProbable });
  f.texte('391');
  f.fin();
  assert.equal(ecrit, '391');
});

test('affichage : une ligne trop longue passe à la suivante entre deux mots, avec le décalage', () => {
  const { creerSortie } = require('../cli/catai');
  let texte = '';
  const sortie = creerSortie((t) => { texte += t; }, () => 30);
  const phrase = 'Je vois que le fichier est très long et je vais le lire en plusieurs passes.';
  for (let i = 0; i < phrase.length; i += 3) sortie.texte(phrase.slice(i, i + 3));
  sortie.fin();
  const lignes = texte.replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter(Boolean);
  assert.ok(lignes.length > 2);
  for (const l of lignes) assert.ok([...l].length <= 29, JSON.stringify(l));
  for (const l of lignes.slice(1)) assert.match(l, /^ {2}\S/);
  assert.equal(lignes.map((l) => l.replace(/^[● ] ?\s*/, '').trimEnd()).join(' '), phrase);
});

test('saisie : une ligne tapée pendant la réponse ne répond pas à la question qui suit', async () => {
  const { EventEmitter } = require('node:events');
  const { creerLecteur } = require('../cli/catai');
  const rl = Object.assign(new EventEmitter(), { terminal: true, setPrompt() {}, prompt() {} });
  const lire = creerLecteur(rl, false);
  rl.emit('line', 'continue, ne t arrête pas'); // tapé pendant que le modèle travaille
  const reponse = lire('Créer ce fichier ? (o/N) ', { question: true });
  rl.emit('line', 'o');
  assert.equal(await reponse, 'o');
  // La ligne tapée en avance devient le message suivant
  assert.equal(await lire('❯ '), 'continue, ne t arrête pas');
});

// Vu par Tom (2026-11-27) : « explique moi le métier de pentester, les écoles et la stack » : réponse de mémoire, avec
// des erreurs (SANS et Offensive Security présentés comme des écoles françaises). Les faits précis se cherchent d'abord.
test('rappelRecherche : les faits précis (écoles, formations, salaires, prix, dates, versions) font chercher d abord', () => {
  const vm = require('node:vm');
  const contexte = {};
  vm.createContext(contexte);
  vm.runInContext(require('fs').readFileSync(require('path').join(__dirname, '../interface/personnalite.js'), 'utf8') + '\nthis.rappelRecherche = rappelRecherche; this.RAPPEL_RECHERCHE = RAPPEL_RECHERCHE; this.RAPPEL_FAITS = RAPPEL_FAITS;', contexte);
  const { rappelRecherche, RAPPEL_RECHERCHE, RAPPEL_FAITS } = contexte;
  assert.equal(rappelRecherche("explique moi le metier de penttester les ecoles et la stack qu'il faut faire"), RAPPEL_FAITS);
  for (const q of ['quelles formations pour devenir infirmier ?', 'combien coûte une RTX 5070 ?', 'quel est le salaire d un développeur junior', 'quelle est la dernière version de Godot ?', 'quand sort le bac 2027 ?']) assert.equal(rappelRecherche(q), RAPPEL_FAITS, q);
  // Les questions de doc gardent leur rappel ; le reste, rien
  assert.equal(rappelRecherche('comment installer docker sur debian ?'), RAPPEL_RECHERCHE);
  for (const q of ['salut ça va ?', 'explique moi la photosynthèse', 'écris une fiche sur les écoles du XIXe siècle', 'fais moi un QCM sur les formations végétales', 'quel est le salaire, sans chercher sur internet']) assert.equal(rappelRecherche(q), null, q);
  assert.match(RAPPEL_FAITS, /chercher_web/);
  assert.match(lireRenderer(), /const rappel = rappelRecherche\(derniere\);\s*if \(rappel\) liste\.push\(\{ role: "system", content: rappel \}\);/);
});
function lireRenderer() { return require('fs').readFileSync(require('path').join(__dirname, '../renderer.js'), 'utf8'); }
