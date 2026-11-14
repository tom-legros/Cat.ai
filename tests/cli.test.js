// catai dans le terminal : options, consignes et infos du projet, sans modèle
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { configurerStockage } = require('../principal/stockage');
const { lireOptions, consignes, infosProjet } = require('../cli/catai');

test('lireOptions : question, mode prof, modèle et dossier', () => {
  const o = lireOptions(['--prof', '-m', 'qwen3:4b', 'explique', 'main.js']);
  assert.equal(o.prof, true);
  assert.equal(o.modele, 'qwen3:4b');
  assert.equal(o.question, 'explique main.js');
  assert.equal(o.dossier, process.cwd());
  assert.equal(lireOptions(['-d', '..']).dossier, path.resolve('..'));
  assert.equal(lireOptions(['--aide']).aide, true);
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

test('fautChercher : une vraie question de doc fait chercher, une demande d écriture ou « ne lis pas de page » non', () => {
  const vm = require('node:vm');
  const contexte = {};
  vm.createContext(contexte);
  vm.runInContext(require('fs').readFileSync(require('path').join(__dirname, '../interface/personnalite.js'), 'utf8') + '\nthis.fautChercher = fautChercher;', contexte);
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
