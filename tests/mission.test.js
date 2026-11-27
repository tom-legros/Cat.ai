// Agent seul : une mission de A à Z dans une copie git, vérifiée par programme après chaque essai
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { lancerMission } = require('../principal/mission');
const { jeterCopie } = require('../principal/copie-agent');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function cadre(t, { avecTests = true } = {}) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-mission-'));
  t.after(() => fs.rmSync(racine, { recursive: true, force: true }));
  const projet = path.join(racine, 'projet');
  fs.mkdirSync(path.join(projet, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(projet, 'calcul.js'), 'module.exports = { somme: (a, b) => a - b };\n');
  if (avecTests) fs.writeFileSync(path.join(projet, 'tests', 'calcul.test.js'), "const test = require('node:test');\nconst assert = require('node:assert');\ntest('somme', () => assert.equal(require('../calcul').somme(2, 3), 5));\n");
  git(projet, 'init', '-q'); git(projet, 'add', '.');
  git(projet, '-c', 'user.name=T', '-c', 'user.email=t@e.invalid', 'commit', '-qm', 'depart');
  return { projet, dossierCopies: path.join(racine, 'copies') };
}

// Un faux modèle : à chaque essai (premier message, ou après une remarque), il joue le contenu suivant du scénario
function modele(scenario, avis = ['{"ok":true}']) {
  let tour = 0;
  let relu = 0;
  return async (messages) => {
    if (/^Tu relis le travail/.test(messages[0].content)) return { content: avis[Math.min(relu++, avis.length - 1)], toolCalls: [] };
    const dernier = messages.at(-1);
    if (dernier.role === 'tool') return { content: 'Bilan : fait.', toolCalls: [] };
    const contenu = scenario[Math.min(tour++, scenario.length - 1)];
    return contenu === null ? { content: 'Je réfléchis.', toolCalls: [] } : { content: '', toolCalls: [{ function: { name: 'ecrire_fichier', arguments: { chemin: 'calcul.js', contenu } } }] };
  };
}
const JUSTE = 'module.exports = { somme: (a, b) => a + b };\n';
const FAUX = 'module.exports = { somme: (a, b) => a * b };\n';

test('mission réussie : le changement est fait, les tests passent, un commit et un rapport', async (t) => {
  const c = cadre(t);
  const r = await lancerMission({ ...c, demande: 'Corrige somme', modele: 'faux', envoyer: modele([JUSTE]) });
  assert.equal(r.ok, true);
  assert.equal(r.statut, 'réussie');
  assert.equal(r.essais, 1);
  assert.equal(r.tests, 'réussis');
  assert.equal(fs.readFileSync(path.join(r.copie, 'calcul.js'), 'utf8'), JUSTE);
  assert.match(git(r.copie, 'log', '-1', '--format=%s'), /^Mission : Corrige somme/);
  assert.match(r.rapport, /# Mission réussie[\s\S]*calcul\.js \(\+1 −1\)/);
  // Le projet lui-même n'a pas changé
  assert.match(fs.readFileSync(path.join(c.projet, 'calcul.js'), 'utf8'), /a - b/);
  jeterCopie(c.projet, r.nom);
});

test('mission : rien d écrit → il est renvoyé au travail ; tests en échec → il reçoit leur sortie et corrige', async (t) => {
  const c = cadre(t);
  const vus = [];
  const envoyer = modele([null, FAUX, JUSTE]);
  const r = await lancerMission({ ...c, demande: 'Corrige somme', modele: 'faux', envoyer: async (m, ...reste) => { vus.push(m.at(-1).content); return envoyer(m, ...reste); } });
  assert.equal(r.ok, true);
  assert.equal(r.essais, 3);
  assert.ok(vus.some((x) => /Tu n'as modifié aucun fichier/.test(x)));
  assert.ok(vus.some((x) => /Les tests du projet échouent/.test(x)));
});

test('mission : plus d essais → « en partie » si quelque chose a changé, « ratée » sinon', async (t) => {
  const enPartie = await lancerMission({ ...cadre(t), demande: 'Corrige somme', modele: 'faux', envoyer: modele([FAUX]) });
  assert.equal(enPartie.ok, false);
  assert.equal(enPartie.statut, 'en partie');
  assert.equal(enPartie.tests, 'échec');
  const ratee = await lancerMission({ ...cadre(t), demande: 'Corrige somme', modele: 'faux', envoyer: modele([null]) });
  assert.equal(ratee.statut, 'ratée');
});

test('mission sans tests dans le projet : le changement suffit si la syntaxe est bonne, et le rapport le dit', async (t) => {
  const r = await lancerMission({ ...cadre(t, { avecTests: false }), demande: 'Corrige somme', modele: 'faux', envoyer: modele([JUSTE]) });
  assert.equal(r.ok, true);
  assert.equal(r.tests, 'syntaxe ok');
  assert.match(r.rapport, /tests : syntaxe ok/);
});

test('mission : la relecture finale renvoie corriger un oubli ; au dernier essai, le travail est gardé « à vérifier »', async (t) => {
  const refus = '{"ok":false,"remarque":"moyenne n est pas exportée"}';
  const corrige = await lancerMission({ ...cadre(t), demande: 'Corrige somme', modele: 'faux', envoyer: modele([JUSTE], [refus, '{"ok":true}']) });
  assert.equal(corrige.ok, true);
  assert.equal(corrige.essais, 2);
  assert.equal(corrige.aVerifier, undefined);
  const doute = await lancerMission({ ...cadre(t), demande: 'Corrige somme', modele: 'faux', envoyer: modele([JUSTE], [refus]) });
  assert.equal(doute.ok, true);
  assert.equal(doute.statut, 'réussie, à vérifier');
  assert.equal(doute.aVerifier, 'moyenne n est pas exportée');
  assert.match(doute.rapport, /La relecture doutait : moyenne n est pas exportée/);
});
