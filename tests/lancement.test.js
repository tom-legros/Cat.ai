// Préparer un chantier : l'équipe devient des agents, le dossier doit être sous git, garder fusionne sans rien casser
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { agentsDuChantier, etatDepot, preparerDepot, garderChantier, resumeChantier } = require('../principal/lancement');
const { equipeParDefaut, ajouterAgent } = require('../principal/equipe');

const git = (d, ...a) => execFileSync('git', a, { cwd: d, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const identite = ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid'];
const dossier = () => fs.mkdtempSync(path.join(os.tmpdir(), 'catai-lancement-'));
const infos = (id) => ({ ollama: { type: 'ollama' }, gemini: { type: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' } })[id] || null;

test('etatDepot et preparerDepot : un dossier simple devient un dépôt avec un point de départ, sans toucher aux fichiers', () => {
  const d = dossier();
  fs.writeFileSync(path.join(d, 'a.txt'), 'bonjour\n');
  assert.deepEqual(etatDepot(d), { pret: false, raison: 'pas-de-depot' });
  assert.deepEqual(preparerDepot(d), { pret: true, modifs: 0 });
  assert.equal(fs.readFileSync(path.join(d, 'a.txt'), 'utf8'), 'bonjour\n');
  assert.equal(git(d, 'log', '--format=%s'), 'Point de départ avant le premier chantier');
  fs.writeFileSync(path.join(d, 'b.txt'), 'x\n');
  assert.equal(etatDepot(d).modifs, 1);
});

test('etatDepot : un dépôt sans aucun commit n est pas prêt', () => {
  const d = dossier();
  git(d, 'init', '-q');
  assert.deepEqual(etatDepot(d), { pret: false, raison: 'pas-de-commit' });
});

// Un dépôt avec une branche de chantier qui ajoute un fichier
function depotAvecChantier() {
  const d = dossier();
  fs.writeFileSync(path.join(d, 'a.txt'), 'un\n');
  git(d, 'init', '-q');
  git(d, 'add', '-A');
  git(d, ...identite, 'commit', '-qm', 'depart');
  const principale = git(d, 'rev-parse', '--abbrev-ref', 'HEAD');
  git(d, 'checkout', '-q', '-b', 'catai/chantier-essai');
  fs.writeFileSync(path.join(d, 'neuf.txt'), 'du chantier\n');
  fs.writeFileSync(path.join(d, 'a.txt'), 'un\nchantier\n');
  git(d, 'add', '-A');
  git(d, ...identite, 'commit', '-qm', 'etape 1');
  git(d, 'checkout', '-q', principale);
  return d;
}

test('garderChantier : le travail arrive dans le projet', () => {
  const d = depotAvecChantier();
  assert.match(resumeChantier(d, 'essai'), /neuf\.txt/);
  assert.deepEqual(garderChantier(d, 'essai'), { ok: true });
  assert.equal(fs.readFileSync(path.join(d, 'neuf.txt'), 'utf8').trim(), 'du chantier');
});

test('garderChantier : refusé si le projet a des changements en cours, et un conflit ne laisse rien à moitié', () => {
  const d = depotAvecChantier();
  fs.writeFileSync(path.join(d, 'a.txt'), 'un\nmoi\n');
  const refus = garderChantier(d, 'essai');
  assert.equal(refus.ok, false);
  assert.match(refus.erreur, /changements en cours/);
  assert.equal(fs.existsSync(path.join(d, 'neuf.txt')), false);
  // Le même changement, enregistré : la fusion entre en conflit, elle est annulée
  git(d, 'add', '-A');
  git(d, ...identite, 'commit', '-qm', 'moi');
  const conflit = garderChantier(d, 'essai');
  assert.equal(conflit.ok, false);
  assert.match(conflit.erreur, /rien n'a été changé/);
  assert.equal(git(d, 'status', '--porcelain'), '');
  assert.equal(fs.readFileSync(path.join(d, 'a.txt'), 'utf8').replace(/\r/g, ''), 'un\nmoi\n');
});

test('agentsDuChantier : les codeurs sur le PC, les autres en ligne, et le modèle du PC en secours si le quota saute', async () => {
  let equipe = equipeParDefaut({ modeles: { ollama: 'qwen3:8b', gemini: 'gemini-flash-lite' }, fournisseurs: { gemini: { cleChiffree: 'x' } } });
  equipe = ajouterAgent(equipe, 'testeur-1', 'logs').equipe;
  const appels = [];
  const dits = [];
  let horloge = 0;
  const envoyerLocal = async (_m, modele) => { appels.push(`local ${modele}`); return { content: 'ok', toolCalls: [] }; };
  const envoyerEnLigne = (id) => async (_m, modele) => { appels.push(`${id} ${modele}`); throw new Error('Limite atteinte (429)'); };
  const { chef, codeurs, resume } = agentsDuChantier({ reglages: { equipe, modeles: { ollama: 'qwen3:8b' } }, infos, envoyerLocal, envoyerEnLigne, limitesLocales: { total: 1 }, dire: (t) => dits.push(t), pause: async () => {}, maintenant: () => horloge });
  assert.match(resume, /^chef gemini gemini-flash-lite · codeur qwen3:8b · contrôles : gemini gemini-flash-lite$/);
  assert.equal(codeurs[0].envoyer, envoyerLocal);
  assert.deepEqual(codeurs[0].controles.map((c) => c.type), ['tests', 'relecture']);
  assert.ok(codeurs[0].controles[0].logs);
  // Le chef en ligne tombe : le modèle du PC répond à sa place, et les fois suivantes directement
  assert.equal((await chef.envoyer([], 'ignoré')).content, 'ok');
  await chef.envoyer([], 'ignoré');
  // Trois essais en ligne (deux pauses), puis le PC ; l'appel suivant va droit au PC
  assert.deepEqual(appels, ['gemini gemini-flash-lite', 'gemini gemini-flash-lite', 'gemini gemini-flash-lite', 'local qwen3:8b', 'local qwen3:8b']);
  assert.match(dits[0], /Chef : limite du fournisseur, pause de 70 s/);
  assert.match(dits[2], /Chef indisponible \(Limite atteinte \(429\)\) : qwen3:8b le remplace pendant un quart d'heure/);
  // Un quart d'heure plus tard, on retente en ligne
  horloge = 16 * 60 * 1000;
  await chef.envoyer([], 'ignoré');
  assert.equal(appels[5], 'gemini gemini-flash-lite');
});

test('agentsDuChantier : un codeur en ligne garde ses limites, puis prend celles du PC quand le quota saute', async () => {
  const equipe = equipeParDefaut({ modeles: { ollama: 'qwen3:8b' } });
  const local = { total: 16000 };
  const envoyerLocal = async () => ({ content: 'local', toolCalls: [] });
  let enPanne = false;
  const envoyerEnLigne = () => async () => { if (enPanne) throw new Error('quota'); return { content: 'en ligne', toolCalls: [] }; };
  const { codeurs, resume } = agentsDuChantier({ reglages: { equipe, modeles: { ollama: 'qwen3:8b', gemini: 'gemini-flash-lite' } }, infos, envoyerLocal, envoyerEnLigne, limitesLocales: local, limitesEnLigne: () => null, codeurForce: 'gemini', pause: async () => {} });
  assert.match(resume, /codeur gemini gemini-flash-lite/);
  assert.equal(codeurs[0].local, false);
  assert.equal(codeurs[0].limites, null);
  assert.equal((await codeurs[0].envoyer([], 'x')).content, 'en ligne');
  enPanne = true;
  assert.equal((await codeurs[0].envoyer([], 'x')).content, 'local');
  assert.equal(codeurs[0].local, true);
  assert.equal(codeurs[0].limites, local);
  assert.equal(codeurs[0].modele, 'qwen3:8b');
});

test('garderChantier : un fichier local ignoré par git n est jamais écrasé par la fusion', () => {
  const d = dossier();
  fs.writeFileSync(path.join(d, '.gitignore'), 'secret.json\n');
  fs.writeFileSync(path.join(d, 'a.txt'), 'un\n');
  git(d, 'init', '-q');
  git(d, 'add', '-A');
  git(d, ...identite, 'commit', '-qm', 'depart');
  const principale = git(d, 'rev-parse', '--abbrev-ref', 'HEAD');
  // Le chantier retire la règle et ajoute lui-même un secret.json
  git(d, 'checkout', '-q', '-b', 'catai/chantier-ignore');
  fs.writeFileSync(path.join(d, '.gitignore'), '');
  fs.writeFileSync(path.join(d, 'secret.json'), 'du chantier\n');
  git(d, 'add', '-A');
  git(d, ...identite, 'commit', '-qm', 'etape');
  git(d, 'checkout', '-q', principale);
  // Dans le projet, l'utilisateur a son propre secret.json, ignoré
  fs.writeFileSync(path.join(d, 'secret.json'), 'le mien\n');
  const r = garderChantier(d, 'ignore');
  assert.equal(r.ok, false);
  assert.equal(fs.readFileSync(path.join(d, 'secret.json'), 'utf8'), 'le mien\n');
});
