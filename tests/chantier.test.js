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

test('jeterChantier : un nom préfixe ne supprime jamais le chantier voisin', () => {
  const projet = depot();
  const copies = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-prefixe-'));
  const voisin = path.join(copies, 'a-voisin');
  const cible = path.join(copies, 'z-cible');
  git(projet, 'worktree', 'add', '-b', 'catai/chantier-essai-long', voisin);
  git(projet, 'worktree', 'add', '-b', 'catai/chantier-essai', cible);
  fs.writeFileSync(path.join(voisin, 'travail.txt'), 'à préserver');
  jeterChantier(projet, 'essai');
  assert.equal(fs.existsSync(cible), false);
  assert.equal(fs.readFileSync(path.join(voisin, 'travail.txt'), 'utf8'), 'à préserver');
  assert.equal(git(voisin, 'branch', '--show-current'), 'catai/chantier-essai-long');
});

for (const conforme of [true, false]) test('sans diff : vérifie le résultat existant, conforme = ' + conforme, async () => {
  const projet = depot();
  const copies = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-conforme-'));
  let lectures = 0;
  const controle = { type: 'relecture', modele: 'test', envoyer: async (messages) => {
    const texte = messages.at(-1).content;
    if (texte.includes('État existant')) {
      lectures++;
      assert.match(texte, /const a = 2/);
      return { content: JSON.stringify({ ok: conforme, remarque: 'résultat incomplet' }) };
    }
    return { content: '{"ok":true}' };
  } };
  const r = await lancerChantier({
    projet, dossierCopies: copies, plan: 'deux étapes', nom: 'conforme',
    etapes: [{ titre: 'Préparer', consigne: 'écrire a.js et préparer la suite' }, { titre: 'Vérifier a', consigne: 'a.js doit contenir const a = 2' }],
    codeurs: [{ nom: 'Dev', ...fauxOuvrier(), controles: [controle] ,
      envoyer: async (messages) => messages[0].content.includes('Vérifier a') || messages.at(-1).role === 'tool'
          ? { content: 'Déjà fait.', toolCalls: [] }
          : { content: '', toolCalls: [{ function: { name: 'ecrire_fichier', arguments: { chemin: 'a.js', contenu: 'const a = 2;\n' } } }] }
    }]
  });
  assert.deepEqual(r.etapes.map(e=>e.ok), [true, conforme]);
  assert.ok(lectures > 0);
  assert.equal(git(r.copie, 'rev-list', '--count', 'HEAD'), '2');
  if(conforme) assert.equal(r.etapes[1].sansChangement, true);
  assert.equal(git(projet, 'status', '--porcelain'), '');
});

test('sans diff : des tests échoués empêchent la validation et la relecture', async () => {
  const projet = depot();
  fs.writeFileSync(path.join(projet, 'a.test.js'), "require('node:test')('échec',()=>{throw Error('échec voulu')});");
  git(projet,'add','.');
  git(projet,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','test');
  let relu = false;
  const r = await lancerChantier({projet, dossierCopies:fs.mkdtempSync(path.join(os.tmpdir(),'catai-sans-diff-')),nom:'tests',
    plan:'Vérifier a.js',etapes:[{titre:'Vérifier',consigne:'a.js doit contenir const a = 1'}],
    codeurs:[{nom:'Dev',...fauxOuvrier(false),controles:[{type:'tests'},{type:'relecture',envoyer:async()=>{relu=true;return {content:'{"ok":true}'};}}]}]});
  assert.equal(r.etapes[0].ok,false);
  assert.match(r.etapes[0].raison,/tests échouent/);
  assert.equal(relu,false);
});

test('chef : un JSON abîmé (guillemet fermé trop tôt, réponse coupée) garde ses étapes bien formées', () => {
  const { etapesDepuis } = require('../principal/chantier');
  const abime = '[{"titre": "Renommer", "consigne": "retourne \'a\' + nom.toUpperCase()".}, {"titre": "Import", "consigne": "Dans accueil.js, remplace l\'import."}, {"titre": "Coupé", "consig';
  assert.deepEqual(etapesDepuis(abime).map((e) => e.titre), ['Renommer', 'Import']);
});

test('chef : les étapes qui ne changent pas le code sont retirées, les tests seulement si le plan n en parle pas', () => {
  const { etapesUtiles } = require('../principal/chantier');
  const etapes = ['Ajouter la fonction somme', 'Vérifier la syntaxe', 'Ajouter un test pour somme', 'Finaliser la structure', 'Lancer les tests'].map((titre) => ({ titre, consigne: 'x' }));
  assert.deepEqual(etapesUtiles(etapes, 'Ajoute somme').map((e) => e.titre), ['Ajouter la fonction somme']);
  assert.deepEqual(etapesUtiles(etapes, 'Ajoute somme et son test').map((e) => e.titre), ['Ajouter la fonction somme', 'Ajouter un test pour somme']);
  // Si tout serait retiré, on garde tout plutôt que rien
  assert.equal(etapesUtiles([{ titre: 'Vérifier', consigne: 'x' }], 'p').length, 1);
});

test('chef : sans aucune étape lisible, le plan entier devient une seule étape au lieu d arrêter le chantier', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { execFileSync } = require('node:child_process');
  const { preparerPlan } = require('../principal/chantier');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-chef-'));
  try {
    fs.writeFileSync(path.join(d, 'a.js'), 'x\n');
    for (const args of [['init', '-q'], ['add', '-A'], ['-c', 'user.name=T', '-c', 'user.email=t@e.invalid', 'commit', '-qm', 'depart']]) execFileSync('git', args, { cwd: d });
    const chef = { modele: 'm', envoyer: async () => ({ content: 'Je ne sais pas.' }) };
    const etapes = await preparerPlan({ projet: d, plan: 'Renomme nomComplet en nomAffiche.\nPartout.', chef, codeurs: [{ nom: 'Codeur' }] });
    assert.equal(etapes.length, 1);
    assert.equal(etapes[0].titre, 'Renomme nomComplet en nomAffiche.');
    assert.match(etapes[0].consigne, /Partout\./);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

// ---------- Le livrable demandé, et une vraie vérification même sans tests (retour de l'onglet Tâches) ----------
const { etapeEstDocument, remarqueLivrable } = require('../principal/chantier');

test('etapeEstDocument et remarqueLivrable : un document demandé ne devient pas du code', () => {
  const spec = { titre: 'Phase 1 : Conception & Spécifications', consigne: 'Livrable : Document de spécifications fonctionnelles + maquettes simples.' };
  assert.equal(etapeEstDocument(spec), true);
  assert.equal(etapeEstDocument({ titre: 'Phase 3 : noyau', consigne: 'Implémenter la navigation, tests unitaires sur chaque fonction.' }), false);
  assert.match(remarqueLivrable(spec, ['backend.py', 'gui.py']), /DOCUMENT, pas du code.*backend\.py, gui\.py/);
  assert.match(remarqueLivrable(spec, ['docs/specifications.md', 'gui.py']), /n'écris pas de code \(gui\.py\)/);
  assert.equal(remarqueLivrable(spec, ['docs/specifications.md']), '');
  assert.equal(remarqueLivrable({ titre: 'Ajoute somme', consigne: 'dans calcul.py' }, ['calcul.py']), '');
});

test('lancerChantier : une étape « document » rendue en code est refaite en Markdown', async () => {
  const d = depot();
  const copies = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-copies-'));
  let essai = 0;
  const ouvrier = { modele: 'ouvrier', envoyer: async (messages) => {
    if (messages.at(-1).role === 'tool') return { content: 'Fait.', toolCalls: [] };
    essai++;
    const consigne = messages[0].content;
    assert.match(consigne, /Le livrable est un DOCUMENT/);
    // Premier essai : du code (le défaut vu chez Tom) ; ensuite, la remarque demande un document
    return { content: '', toolCalls: [{ function: { name: 'ecrire_fichier', arguments: essai === 1 ? { chemin: 'gui.py', contenu: 'print(1)\n' } : { chemin: 'docs/specifications.md', contenu: '# Spécifications\n' } } }] };
  } };
  const r = await lancerChantier({ projet: d, plan: 'Phase 1 : Conception. Livrable : document de spécifications.', chef: fauxChef([{ titre: 'Spécifications', consigne: 'Écrire le document de spécifications fonctionnelles.' }]), ouvrier, dossierCopies: copies, nom: 'doc' });
  assert.deepEqual(r.etapes.map((e) => e.ok), [true]);
  assert.equal(essai, 2);
  const fichiers = git(d, 'diff', '--name-only', 'HEAD', r.branche).split('\n');
  assert.deepEqual(fichiers, ['docs/specifications.md']);
  jeterChantier(d, 'doc');
});

test('lancerChantier : sans tests, un fichier JavaScript cassé est renvoyé au codeur (syntaxe vérifiée)', async () => {
  const d = depot();
  const copies = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-copies-'));
  let essai = 0;
  const vus = [];
  const ouvrier = { modele: 'ouvrier', envoyer: async (messages) => {
    if (messages.at(-1).role === 'tool') return { content: 'Fait.', toolCalls: [] };
    essai++;
    vus.push(messages[0].content);
    return { content: '', toolCalls: [{ function: { name: 'ecrire_fichier', arguments: { chemin: 'b.js', contenu: essai === 1 ? 'const = ;\n' : 'const b = 2;\n' } } }] };
  } };
  const r = await lancerChantier({ projet: d, plan: 'ajoute b', chef: fauxChef([{ titre: 'Ajoute b', consigne: 'crée b.js' }]), ouvrier, dossierCopies: copies, nom: 'syntaxe' });
  assert.deepEqual(r.etapes.map((e) => e.ok), [true]);
  assert.equal(essai, 2);
  assert.match(vus[1], /erreur de syntaxe/);
  jeterChantier(d, 'syntaxe');
});

test('lancerChantier : un test qui échouait déjà avant le chantier : le codeur est prévenu, et au dernier essai l étape est gardée à vérifier ; un nouvel échec bloque', async () => {
  const d = depot();
  fs.mkdirSync(path.join(d, 'tests'));
  fs.writeFileSync(path.join(d, 'tests', 'vieux.test.js'), "require('node:test')('vieux test cassé', () => { throw new Error('déjà cassé'); });\n");
  git(d, 'add', '-A');
  git(d, '-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-qm', 'vieux test');
  const copies = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-copies-'));
  const journal = [];
  const r = await lancerChantier({ projet: d, plan: 'ajoute f1', chef: fauxChef([{ titre: 'Un', consigne: 'crée f1' }]), ouvrier: fauxOuvrier(), dossierCopies: copies, nom: 'depart', ev: { info: (t) => journal.push(t) } });
  assert.deepEqual(r.etapes.map((e) => e.ok), [true]);
  assert.match(r.etapes[0].aVerifier, /échouaient déjà avant le chantier/);
  assert.ok(journal.some((l) => /déjà en échec avant/.test(l)), journal.join('\n'));
  jeterChantier(d, 'depart');
  // Un codeur qui casse un autre test : refusé
  const casse = { modele: 'ouvrier', envoyer: async (messages) => (messages.at(-1).role === 'tool' ? { content: 'Fait.', toolCalls: [] }
    : { content: '', toolCalls: [{ function: { name: 'ecrire_fichier', arguments: { chemin: 'tests/nouveau.test.js', contenu: "require('node:test')('nouveau', () => { throw new Error('cassé'); });\n" } } }] }) };
  const r2 = await lancerChantier({ projet: d, plan: 'x', chef: fauxChef([{ titre: 'Deux', consigne: 'c' }]), ouvrier: casse, dossierCopies: copies, nom: 'nouveau' });
  assert.deepEqual(r2.etapes.map((e) => e.ok), [false]);
  jeterChantier(d, 'nouveau');
});
