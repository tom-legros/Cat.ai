// Mode chantier avec de faux modèles : copie à part, commit par étape, arrêt après les essais ratés
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { lancerChantier, jeterChantier, etapesDepuis, avisDepuis, ESSAIS_PAR_ETAPE } = require('../principal/chantier');

const git = (d, ...a) => execFileSync('git', a, { cwd: d, encoding: 'utf8' }).trim();
function depot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-chantier-'));
  fs.writeFileSync(path.join(d, 'a.js'), 'const a = 1;\n');
  git(d, 'init', '-q');
  git(d, 'add', '-A');
  git(d, '-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-qm', 'depart');
  return d;
}
// Faux chef : la première demande découpe, les suivantes relisent
const fauxChef = (etapes, avis = '{"ok": true}') => ({
  modele: 'chef',
  envoyer: async (messages) => ({ content: /découpe/i.test(messages[0].content) ? JSON.stringify(etapes) : avis, toolCalls: [] }),
});
// Faux ouvrier : à chaque étape, demande d'écrire un fichier, puis dit qu'il a fini
function fauxOuvrier(ecrire = true) {
  let n = 0;
  return {
    modele: 'ouvrier',
    envoyer: async (messages) => {
      if (messages.at(-1).role === 'tool' || !ecrire) return { content: 'Fait.', toolCalls: [] };
      n++;
      return { content: '', toolCalls: [{ function: { name: 'ecrire_fichier', arguments: { chemin: `f${n}.js`, contenu: `// ${n}\n` } } }] };
    },
  };
}

test('lancerChantier : chaque étape est committée sur une branche à part, le projet ne bouge pas', async () => {
  const d = depot();
  const copies = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-copies-'));
  const r = await lancerChantier({ projet: d, plan: 'deux fichiers', chef: fauxChef([{ titre: 'Un', consigne: 'crée f1' }, { titre: 'Deux', consigne: 'crée f2' }]), ouvrier: fauxOuvrier(), dossierCopies: copies, nom: 'essai' });
  assert.deepEqual(r.etapes.map((e) => e.ok), [true, true]);
  assert.equal(r.branche, 'catai/chantier-essai');
  assert.match(git(d, 'log', '--format=%s', r.branche), /étape 2 : Deux\n.*étape 1 : Un\ndepart/);
  assert.deepEqual(fs.readdirSync(d).filter((f) => f !== '.git'), ['a.js']);
  assert.match(r.rapport, /2 étapes sur 2 faites/);
  jeterChantier(d, 'essai');
  assert.doesNotMatch(git(d, 'branch'), /chantier/);
  assert.equal(fs.existsSync(r.copie), false);
});

test('lancerChantier : une étape refusée trois fois arrête le chantier, avec la raison dans le rapport', async () => {
  const d = depot();
  const copies = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-copies-'));
  const r = await lancerChantier({ projet: d, plan: 'x', chef: fauxChef([{ titre: 'Un', consigne: 'c' }, { titre: 'Deux', consigne: 'c' }], '{"ok": false, "remarque": "il manque le test"}'), ouvrier: fauxOuvrier(), dossierCopies: copies, nom: 'rate' });
  assert.equal(r.etapes.length, 1);
  assert.equal(r.etapes[0].ok, false);
  assert.equal(r.etapes[0].essais, ESSAIS_PAR_ETAPE);
  assert.match(r.rapport, /\[bloqué\] Un\n {3}Raison : il manque le test/);
  assert.match(r.rapport, /\[pas commencé\] Deux/);
  assert.equal(git(d, 'log', '--format=%s', r.branche), 'depart');
  jeterChantier(d, 'rate');
});

test('etapesDepuis et avisDepuis : JSON entouré de texte, et pas de validation sur un malentendu', () => {
  assert.deepEqual(etapesDepuis('Voici :\n```json\n[{"titre": "A", "consigne": "faire a"}]\n```'), [{ titre: 'A', consigne: 'faire a' }]);
  assert.deepEqual(etapesDepuis('rien'), []);
  assert.equal(avisDepuis('{"ok": true}').ok, true);
  assert.equal(avisDepuis("c'est bon je pense").ok, false);
});

test('chantier : une ancre introuvable est signalée dans le journal et le rapport', async () => {
  const projet = depot();
  const dossierCopies = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-ancre-'));
  const journal = [];
  const ouvrier = { modele: 'ouvrier', envoyer: async (messages) => ({
    content: '',
    toolCalls: messages.at(-1).role === 'tool' ? [] : [{
      function: { name: 'remplacer_texte', arguments: { chemin: 'a.js', ancien_texte: 'ancre absente', nouveau_texte: 'nouveau' } },
    }],
  }) };
  const r = await lancerChantier({
    projet, dossierCopies, nom: 'ancre', plan: 'modifier a.js', ouvrier,
    chef: fauxChef([{ titre: 'Un', consigne: 'Remplacer une ligne' }]),
    ev: { info: (ligne) => journal.push(ligne) },
  });
  assert.match(r.etapes[0].raison, /ancien_texte est introuvable/);
  assert.match(journal.join('\n'), /Écriture sans changement : ancien_texte est introuvable/);
  assert.doesNotMatch(journal.join('\n'), /modifie a\.js|Fichier modifié/);
  jeterChantier(projet, 'ancre');
});

test('lignesEchec : le test raté et son erreur, sans le bilan', () => {
  const { lignesEchec } = require('../principal/chantier');
  const sortie = "✔ somme (0.4ms)\n✖ produit (1.2ms)\n  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n  12 !== 7\nℹ tests 2\nℹ fail 1";
  assert.equal(lignesEchec(sortie), '✖ produit (1.2ms)\nAssertionError [ERR_ASSERTION]: Expected values to be strictly equal:');
});

test('etapesDepuis : élimine les répétitions sans perdre deux tâches distinctes de même titre', () => {
  const a = { titre: 'Tests', consigne: 'Créer le test du thème' };
  const b = { titre: 'Tests', consigne: 'Créer le test de sauvegarde' };
  assert.deepEqual(etapesDepuis(JSON.stringify([a, { titre: 'TESTS', consigne: 'Créer  le test du thème' }, b])), [a, b]);
});

test('chantier : une panne laisse les commits validés et la reprise ne recode que le reste', async () => {
  const projet = depot();
  const dossierCopies = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-reprise-'));
  const plan = [{ titre: 'Un', consigne: 'crée f1' }, { titre: 'Deux', consigne: 'crée f2' }];
  const chef = fauxChef(plan);
  const dev = fauxOuvrier();
  const envoyer = dev.envoyer;
  dev.envoyer = async (messages) => {
    if (messages.some((m) => typeof m.content === 'string' && m.content.includes('TON ÉTAPE, et rien d\'autre : Deux'))) throw new Error('fetch failed');
    return envoyer(messages);
  };
  const options = { projet, plan: 'deux fichiers', dossierCopies, chef, ouvrier: dev, nom: 'reprise' };
  const r = await lancerChantier(options);
  assert.deepEqual(r.etapes.map((e) => e.ok), [true, false], r.rapport);
  assert.match(r.etapes[1].raison, /Codeur · étape 2 : Connexion/);
  const dejaFait = git(r.copie, 'rev-parse', 'HEAD');
  dev.envoyer = envoyer;
  const suite = await lancerChantier({ ...options, etapes: r.plan, reprise: r });
  assert.deepEqual(suite.etapes.map((e) => e.ok), [true, true]);
  assert.equal(git(suite.copie, 'rev-parse', 'HEAD^'), dejaFait);
  jeterChantier(projet, 'reprise');
});

test('chantier : un arrêt pendant la relecture empêche le commit de l’étape', async () => {
  const projet = depot();
  const dossierCopies = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-arret-'));
  const arret = new AbortController();
  const chef = fauxChef([{ titre: 'Un', consigne: 'crée f1' }]);
  const verificateur = { modele: 'relecteur', envoyer: async () => {
    arret.abort();
    return { content: '{"ok":true}' };
  } };
  const r = await lancerChantier({ projet, plan: 'un fichier', dossierCopies, chef, ouvrier: fauxOuvrier(), verificateur, signal: arret.signal, nom: 'arret' });
  assert.deepEqual(r.etapes, []);
  assert.equal(git(r.copie, 'log', '-1', '--format=%s'), 'depart');
  assert.equal(git(r.copie, 'status', '--porcelain'), '');
  jeterChantier(projet, 'arret');
});

test('detailEchec : ce qui suit « failing tests: », avec la différence attendu / obtenu, sans la pile d appels', () => {
  const { detailEchec } = require('../principal/chantier');
  const sortie = "✖ produit (1ms)\nℹ tests 2\nℹ fail 1\n\n✖ failing tests:\n\ntest at a.test.js:5:1\n✖ produit (1ms)\n  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n\n  7 !== 12\n\n      at TestContext.<anonymous> (a.test.js:6:10)\n      at node:internal/test_runner/test:1\n";
  const detail = detailEchec(sortie);
  assert.match(detail, /✖ produit/);
  assert.match(detail, /7 !== 12/);
  assert.doesNotMatch(detail, /node:internal|TestContext/);
  assert.equal(detailEchec('tout va bien'), '');
});
