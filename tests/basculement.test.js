const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { lancerChantier } = require('../principal/chantier');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
function cadre(t) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-bascule-'));
  t.after(() => fs.rmSync(racine, { recursive: true, force: true }));
  const projet = path.join(racine, 'projet'); fs.mkdirSync(projet);
  fs.writeFileSync(path.join(projet, 'base.js'), '// base\n');
  git(projet, 'init', '-q'); git(projet, 'add', '.');
  git(projet, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'base');
  return { projet, dossierCopies: path.join(racine, 'copies'), nom: 'test', plan: 'plan', etapes: [{ titre: 'Une', consigne: 'Créer un fichier', agent: 'a' }] };
}
function codeur(id, reussit, controles = []) {
  const c = { id, nom: id, modele: 'faux', controles, appels: 0 };
  c.envoyer = async (messages) => {
    if (messages.at(-1).role === 'tool') return { content: 'Fini', toolCalls: [] };
    c.appels++;
    return { content: '', toolCalls: reussit ? [{ function: { name: 'ecrire_fichier', arguments: { chemin: id + '.js', contenu: '// fait\n' } } }] : [] };
  };
  return c;
}
for (const memeNom of [false, true]) test('bascule : trois échecs puis réussite, noms identiques = ' + memeNom, async (t) => {
  const options = cadre(t); const a = codeur('a', false); const b = codeur('b', true);
  if (memeNom) a.nom = b.nom = 'Dev';
  const evenements = [];
  const r = await lancerChantier({ ...options, codeurs: [b, a], ev: { resultat: (e) => evenements.push(e) } });
  assert.equal(a.appels, 3); assert.equal(b.appels, 1);
  assert.equal(r.etapes[0].essais, 4); assert.equal(r.etapes[0].ok, true); assert.equal(evenements.length, 1);
  assert.equal(git(r.copie, 'rev-list', '--count', 'HEAD'), '2');
  assert.equal(git(options.projet, 'status', '--porcelain'), '');
});
test('bascule : tous échouent, un résultat et six essais', async (t) => {
  const r = await lancerChantier({ ...cadre(t), codeurs: [codeur('a', false), codeur('b', false)] });
  assert.equal(r.etapes.length, 1); assert.equal(r.etapes[0].essais, 6); assert.equal(r.etapes[0].ok, false);
  assert.equal(git(r.copie, 'rev-list', '--count', 'HEAD'), '1');
});
test('bascule : le contrôle initial reste obligatoire', async (t) => {
  const refus = { id: 'controle', type: 'relecture', nom: 'Obligatoire', envoyer: async () => ({ content: '{"ok":false,"remarque":"refus"}' }) };
  const b = codeur('b', true);
  const r = await lancerChantier({ ...cadre(t), codeurs: [codeur('a', false, [refus]), b] });
  assert.equal(b.appels, 3); assert.equal(r.etapes[0].ok, false); assert.equal(r.etapes[0].essais, 6);
});
test('bascule : annulation sans remplaçant', async (t) => {
  const arret = new AbortController(); const a = codeur('a', false); const b = codeur('b', true);
  a.envoyer = async () => { arret.abort(); return { content: '', toolCalls: [] }; };
  const r = await lancerChantier({ ...cadre(t), codeurs: [a, b], signal: arret.signal });
  assert.equal(b.appels, 0); assert.deepEqual(r.etapes, []);
});
test('bascule : un seul codeur garde trois essais', async (t) => {
  const r = await lancerChantier({ ...cadre(t), codeurs: [codeur('a', false)] });
  assert.equal(r.etapes[0].essais, 3);
});
for (const erreur of [new Error('erreur interne'), Object.assign(new Error('accès interdit'), { code: 'EACCES' })]) test('bascule : pas de relais sur ' + erreur.message, async (t) => {
  const a = codeur('a', false); const b = codeur('b', true);
  a.envoyer = async () => { throw erreur; };
  const r = await lancerChantier({ ...cadre(t), codeurs: [a, b] });
  assert.equal(b.appels, 0); assert.equal(r.etapes[0].essais, 1); assert.equal(r.etapes[0].ok, false);
});
test('bascule : lecture hors projet interdit le relais', async (t) => {
  const a = codeur('a', false); const b = codeur('b', true);
  a.envoyer = async () => ({ content: '', toolCalls: [{ function: { name: 'lire_fichier', arguments: { chemin: '../ailleurs' } } }] });
  const r = await lancerChantier({ ...cadre(t), codeurs: [a, b] });
  assert.equal(b.appels, 0); assert.match(r.etapes[0].raison, /en dehors/);
});
test('bascule : panne récupérable, puis reprise sans perdre le commit validé', async (t) => {
  const options = cadre(t); options.etapes.push({ titre: 'Deux', consigne: 'suite', agent: 'a' });
  const a = codeur('a', false); const b = codeur('b', true); const envoyer = b.envoyer;
  a.envoyer = async () => { a.appels++; throw new Error('fetch failed'); };
  b.envoyer = async (messages) => {
    if (messages[0].content.includes('TON ÉTAPE, et rien d\'autre : Deux')) throw new Error('fetch failed');
    return envoyer(messages);
  };
  const r = await lancerChantier({ ...options, codeurs: [a, b] });
  assert.deepEqual(r.etapes.map(e => [e.ok, e.essais]), [[true, 4], [false, 6]]);
  const commit = r.commit;
  const c = codeur('c', true);
  const suite = await lancerChantier({ ...options, codeurs: [c], reprise: r });
  assert.deepEqual(suite.etapes.map(e => e.ok), [true, true]);
  assert.equal(git(suite.copie, 'rev-parse', 'HEAD^'), commit);
});
test('bascule : contrôles communs dédupliqués et contrôles propres au remplaçant', async (t) => {
  const appels = [];
  const controle = (id, ok = true) => ({ id, type: 'relecture', envoyer: async () => { appels.push(id); return { content: JSON.stringify({ ok, remarque: 'refus' }) }; } });
  const commun = controle('commun');
  const a = codeur('a', false, [commun, controle('initial')]);
  const b = codeur('b', true, [commun, controle('remplacant', false)]);
  const r = await lancerChantier({ ...cadre(t), codeurs: [a, b] });
  assert.equal(r.etapes[0].ok, false);
  assert.deepEqual(appels, Array(3).fill(['commun', 'initial', 'remplacant']).flat());
});
test('bascule : erreur Git sans relais ni commit', async (t) => {
  const options = cadre(t); const a = codeur('a', true); const b = codeur('b', true);
  const copie = path.join(options.dossierCopies, 'chantier-test');
  const envoyer = a.envoyer;
  a.envoyer = async (messages) => {
    if (messages.at(-1).role === 'tool') {
      const verrou = git(copie, 'rev-parse', '--git-path', 'index.lock');
      fs.writeFileSync(path.resolve(copie, verrou), 'verrou de test');
    }
    return envoyer(messages);
  };
  await assert.rejects(lancerChantier({ ...options, codeurs: [a, b] }), /index.lock/);
  assert.equal(b.appels, 0);
  assert.equal(git(copie, 'rev-list', '--count', 'HEAD'), '1');
  assert.equal(git(options.projet, 'status', '--porcelain'), '');
});
test('bascule : les identités et contrôles traversent la préparation', () => {
  const { agentsDuChantier } = require('../principal/lancement');
  const { equipeParDefaut, ajouterAgent } = require('../principal/equipe');
  const equipe = ajouterAgent(equipeParDefaut({ modeles: { ollama: 'local' } }), 'chef', 'codeur').equipe;
  equipe.agents.filter(a => a.type === 'codeur').forEach(a => { a.nom = 'Dev'; });
  const { codeurs } = agentsDuChantier({ reglages: { equipe }, infos: () => ({ type: 'ollama' }), envoyerLocal: async () => {}, envoyerEnLigne: () => {} });
  assert.deepEqual(codeurs.map(c => c.id), ['codeur-1', 'codeur-2']);
  assert.equal(codeurs[0].controles[0].id, codeurs[1].controles[0].id);
});
test('chantier : une erreur d outil ordinaire (fichier absent) ne fait pas planter l étape, le modèle se corrige', async (t) => {
  const a = { id: 'a', nom: 'a', modele: 'faux', controles: [], appels: 0 };
  a.envoyer = async (messages) => {
    a.appels++;
    const outils = messages.filter((m) => m.role === 'tool').length;
    if (outils === 0) return { content: '', toolCalls: [{ function: { name: 'lire_fichier', arguments: { chemin: 'absent.js' } } }] };
    if (outils === 1) return { content: '', toolCalls: [{ function: { name: 'ecrire_fichier', arguments: { chemin: 'a.js', contenu: '// fait\n' } } }] };
    return { content: 'Fini', toolCalls: [] };
  };
  const r = await lancerChantier({ ...cadre(t), codeurs: [a] });
  assert.equal(r.etapes[0].ok, true); assert.equal(r.etapes[0].essais, 1);
});
test('chantier : limite de tours atteinte avec un diff, le travail est vérifié au lieu d être jeté', async (t) => {
  const a = { id: 'a', nom: 'a', modele: 'faux', controles: [], appels: 0 };
  // Il écrit le même fichier sans jamais dire qu'il a fini : la boucle s'arrête d'elle-même
  a.envoyer = async () => { a.appels++; return { content: '', toolCalls: [{ function: { name: 'ecrire_fichier', arguments: { chemin: 'a.js', contenu: '// fait\n' } } }] }; };
  const infos = [];
  const r = await lancerChantier({ ...cadre(t), codeurs: [a], ev: { info: (x) => infos.push(x) } });
  assert.equal(r.etapes[0].ok, true); assert.equal(r.etapes[0].essais, 1);
  assert.ok(infos.some((x) => /Limite de tours atteinte/.test(x)), infos.join('\n'));
});
test('chantier : tests réussis mais relecteur qui refuse jusqu au bout → étape gardée, marquée à vérifier ; sans test, abandonnée', async (t) => {
  const refus = { id: 'relecteur', type: 'relecture', nom: 'Relecteur', envoyer: async () => ({ content: '{"ok":false,"remarque":"export mal nommé"}' }) };
  // Avec un test du projet qui passe
  const options = cadre(t);
  fs.mkdirSync(path.join(options.projet, 'tests'));
  fs.writeFileSync(path.join(options.projet, 'tests', 'ok.test.js'), "require('node:test')('ok', () => {});\n");
  git(options.projet, 'add', '.');
  git(options.projet, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'tests');
  const avec = await lancerChantier({ ...options, codeurs: [codeur('a', true, [{ id: 'tests', type: 'tests' }, refus])] });
  assert.equal(avec.etapes[0].ok, true);
  assert.equal(avec.etapes[0].aVerifier, 'export mal nommé');
  assert.equal(avec.etapes[0].essais, 3);
  assert.match(avec.rapport, /\[fait, à vérifier\][\s\S]*Le relecteur doutait : export mal nommé/);
  // Sans aucun test : le relecteur reste seul juge
  const sans = await lancerChantier({ ...cadre(t), codeurs: [codeur('a', true, [{ id: 'tests', type: 'tests' }, refus])] });
  assert.equal(sans.etapes[0].ok, false);
});
