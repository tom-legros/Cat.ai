// L'arbre d'agents du mode chantier : règles de l'arbre, garde-fous, et ce que le chantier en fait
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { equipeParDefaut, equipeDepuis, equipeValide, ajoutsPossibles, ajouterAgent, retirerAgent, modifierAgent, planDeTravail, MAX_AGENTS } = require('../principal/equipe');
const { lancerChantier, jeterChantier } = require('../principal/chantier');

const infos = (id) => ({
  ollama: { type: 'ollama' },
  gemini: { type: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
})[id] || null;
const types = (equipe) => equipe.agents.map((a) => a.type);

test('equipeParDefaut : sans clé tout tourne sur le PC ; avec une clé Gemini, le chef et le relecteur sont en ligne', () => {
  const local = equipeParDefaut({ modeles: { ollama: 'qwen3:8b' }, fournisseurs: {} });
  assert.deepEqual(types(local), ['chef', 'codeur', 'testeur', 'relecteur']);
  assert.ok(local.agents.filter((a) => a.fournisseur).every((a) => a.fournisseur === 'ollama'));
  const enLigne = equipeParDefaut({ modeles: { ollama: 'qwen3:8b', gemini: 'gemini-flash-lite' }, fournisseurs: { gemini: { cleChiffree: 'x' } } });
  assert.equal(enLigne.agents[0].fournisseur, 'gemini');
  assert.equal(enLigne.agents[1].fournisseur, 'ollama');
  assert.ok(equipeValide(enLigne));
});

test('equipeDepuis : une équipe enregistrée abîmée est remplacée par celle de départ', () => {
  assert.deepEqual(types(equipeDepuis({ equipe: { agents: [{ id: 'x', type: 'codeur', parent: null }] } })), ['chef', 'codeur', 'testeur', 'relecteur']);
  assert.deepEqual(types(equipeDepuis({ equipe: { agents: 'pas une liste' } })), ['chef', 'codeur', 'testeur', 'relecteur']);
  const bonne = ajouterAgent(equipeParDefaut(), 'chef', 'codeur').equipe;
  assert.equal(equipeDepuis({ equipe: bonne }), bonne);
});

test('equipeDepuis : un fichier modifié à la main ne fait ni planter, ni garder un modèle payant', () => {
  const depart = ['chef', 'codeur', 'testeur', 'relecteur'];
  const base = equipeParDefaut({ modeles: { ollama: 'qwen3:8b' } });
  const avec = (changer) => ({ equipe: { agents: base.agents.map((a) => ({ ...a, ...changer(a) })) } });
  assert.deepEqual(types(equipeDepuis({ equipe: { agents: [null] } }, infos)), depart);
  const sansNom = avec((a) => (a.id === 'codeur-1' ? { nom: undefined } : {}));
  assert.equal(equipeValide(sansNom.equipe, infos), false);
  const payant = avec((a) => (a.id === 'chef' ? { fournisseur: 'gemini', modele: 'gemini-pro' } : {}));
  assert.equal(equipeValide(payant.equipe, infos), false);
  assert.equal(equipeDepuis(payant, infos).agents[0].fournisseur, 'ollama');
  const codeurEnLigne = avec((a) => (a.id === 'codeur-1' ? { fournisseur: 'gemini', modele: 'gemini-flash' } : {}));
  assert.equal(equipeValide(codeurEnLigne.equipe, infos), true);
  const codeurPayant = avec((a) => (a.id === 'codeur-1' ? { fournisseur: 'gemini', modele: 'gemini-pro' } : {}));
  assert.equal(equipeValide(codeurPayant.equipe, infos), false);
  const deuxTesteurs = { agents: [...base.agents, { id: 'testeur-2', type: 'testeur', nom: 'Testeur 2', parent: 'chef' }] };
  assert.equal(equipeValide(deuxTesteurs, infos), false);
  assert.equal(equipeValide(avec((a) => (a.id === 'chef' ? { fournisseur: 'gemini', modele: 'gemini-flash' } : {})).equipe, infos), true);
});

test('ajouterAgent : chaque agent a sa place, un seul testeur par parent, et un nombre limité', () => {
  let e = equipeParDefaut();
  assert.deepEqual(ajoutsPossibles(e, 'chef'), ['codeur', 'relecteur']); // le testeur est déjà là
  assert.deepEqual(ajoutsPossibles(e, 'testeur-1'), ['logs']);
  assert.deepEqual(ajoutsPossibles(e, 'relecteur-1'), []);
  assert.match(ajouterAgent(e, 'chef', 'logs').erreur, /ne peut pas aller ici/);
  assert.match(ajouterAgent(e, 'chef', 'testeur').erreur, /ne peut pas aller ici/);
  const r = ajouterAgent(e, 'testeur-1', 'logs');
  assert.equal(r.id, 'logs-1');
  e = r.equipe;
  assert.deepEqual(ajoutsPossibles(e, 'testeur-1'), []);
  e = ajouterAgent(e, 'chef', 'codeur').equipe;
  assert.equal(e.agents.at(-1).nom, 'Codeur 2');
  assert.equal(e.agents.at(-1).fournisseur, 'ollama');
  while (e.agents.length < MAX_AGENTS) e = ajouterAgent(e, 'chef', 'relecteur').equipe;
  assert.match(ajouterAgent(e, 'chef', 'relecteur').erreur, /Pas plus de/);
  assert.ok(equipeValide(e));
});

test('retirerAgent : tout ce qui est dessous part avec, mais il reste un chef et un codeur', () => {
  let e = ajouterAgent(equipeParDefaut(), 'testeur-1', 'logs').equipe;
  assert.match(retirerAgent(e, 'chef').erreur, /chef/);
  assert.match(retirerAgent(e, 'codeur-1').erreur, /au moins un codeur/);
  e = retirerAgent(e, 'testeur-1').equipe;
  assert.deepEqual(types(e), ['chef', 'codeur', 'relecteur']); // le lecteur de logs est parti avec son testeur
  e = ajouterAgent(e, 'chef', 'codeur').equipe;
  assert.deepEqual(types(retirerAgent(e, 'codeur-1').equipe), ['chef', 'relecteur', 'codeur']);
});

test("modifierAgent : aucun modèle payant n'est retenu, et un codeur peut être en ligne s'il est gratuit", () => {
  const e = equipeParDefaut();
  assert.equal(modifierAgent(e, 'codeur-1', { fournisseur: 'gemini', modele: 'gemini-flash' }, infos).equipe.agents[1].fournisseur, 'gemini');
  assert.match(modifierAgent(e, 'codeur-1', { fournisseur: 'gemini', modele: 'gemini-pro' }, infos).erreur, /pas gratuit/);
  assert.match(modifierAgent(e, 'chef', { fournisseur: 'gemini', modele: 'gemini-pro' }, infos).erreur, /pas gratuit/);
  assert.match(modifierAgent(e, 'testeur-1', { fournisseur: 'ollama', modele: 'x' }, infos).erreur, /pas de modèle/);
  assert.match(modifierAgent(e, 'chef', { fournisseur: 'inconnu', modele: 'x' }, infos).erreur, /inconnu/);
  const r = modifierAgent(e, 'codeur-1', { nom: '  Front   end ', specialite: 'HTML et CSS', modele: 'qwen3:8b' }, infos).equipe.agents[1];
  assert.deepEqual([r.nom, r.specialite, r.fournisseur, r.modele], ['Front end', 'HTML et CSS', 'ollama', 'qwen3:8b']);
});

test('planDeTravail : les contrôles sous le chef valent pour tous, ceux sous un codeur pour lui seul, les tests en premier', () => {
  let e = ajouterAgent(equipeParDefaut(), 'chef', 'codeur').equipe;
  e = ajouterAgent(e, 'codeur-2', 'relecteur').equipe;
  e = ajouterAgent(e, 'testeur-1', 'logs').equipe;
  const { chef, codeurs } = planDeTravail(e);
  assert.equal(chef.id, 'chef');
  assert.deepEqual(codeurs[0].controles.map((c) => c.type), ['tests', 'relecture']);
  assert.deepEqual(codeurs[1].controles.map((c) => c.nom), ['Testeur', 'Relecteur', 'Relecteur 2']);
  assert.equal(codeurs[0].controles[0].logs.id, 'logs-1');
});

// ---------- Le chantier avec une équipe, sur un vrai dépôt et de faux modèles ----------
const git = (d, ...a) => execFileSync('git', a, { cwd: d, encoding: 'utf8' }).trim();
function depot(fichiers = { 'a.js': 'const a = 1;\n' }) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-equipe-'));
  for (const [nom, contenu] of Object.entries(fichiers)) fs.writeFileSync(path.join(d, nom), contenu);
  git(d, 'init', '-q');
  git(d, 'add', '-A');
  git(d, '-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-qm', 'depart');
  return d;
}
// Un faux codeur : il écrit un fichier à son nom à chaque essai, et retient ce qu'on lui a demandé
function fauxCodeur(nom, controles) {
  const recus = [];
  let n = 0;
  return {
    nom, controles, modele: nom, recus,
    envoyer: async (messages) => {
      if (messages.at(-1).role === 'tool') return { content: 'Fait.', toolCalls: [] };
      recus.push(messages[0].content);
      n++;
      return { content: '', toolCalls: [{ function: { name: 'ecrire_fichier', arguments: { chemin: `${nom}${n}.js`, contenu: `// ${nom} ${n}\n` } } }] };
    },
  };
}
const repond = (texte) => ({ modele: 'faux', appels: 0, async envoyer() { this.appels++; return { content: texte, toolCalls: [] }; } });

test('chantier : le chef donne chaque étape à un codeur, et un relecteur ne contrôle que le sien', async () => {
  const d = depot();
  const relecteurDeB = repond('{"ok": true}');
  const a = fauxCodeur('alpha', []);
  const b = fauxCodeur('beta', [{ type: 'relecture', nom: 'Relecteur', envoyer: (...x) => relecteurDeB.envoyer(...x), modele: 'faux' }]);
  const chef = repond(JSON.stringify([{ titre: 'Un', consigne: 'c', agent: 'Beta' }, { titre: 'Deux', consigne: 'c', agent: 'alpha' }, { titre: 'Trois', consigne: 'c', agent: 'inconnu' }]));
  const r = await lancerChantier({ projet: d, plan: 'p', chef: { modele: 'chef', envoyer: (...x) => chef.envoyer(...x) }, codeurs: [a, b], dossierCopies: fs.mkdtempSync(path.join(os.tmpdir(), 'catai-copies-')), nom: 'equipe' });
  assert.deepEqual(r.etapes.map((e) => e.ok), [true, true, true]);
  assert.deepEqual(git(d, 'ls-tree', '--name-only', r.branche).split('\n').sort(), ['a.js', 'alpha1.js', 'alpha2.js', 'beta1.js']);
  assert.equal(relecteurDeB.appels, 1); // seulement l'étape de beta
  jeterChantier(d, 'equipe');
});

test('chantier : quand les tests cassent, le lecteur de logs explique au codeur quoi corriger', async () => {
  // Le test du projet ne passe que si alpha2.js existe : le premier essai casse, le second réussit
  const d = depot({ 'a.test.js': "const test = require('node:test');\nconst assert = require('node:assert');\ntest('alpha2 existe', () => assert.ok(require('fs').existsSync(__dirname + '/alpha2.js')));\n" });
  const logs = repond('Le fichier alpha2.js manque : crée-le.');
  const a = fauxCodeur('alpha', [{ type: 'tests', logs: { envoyer: (...x) => logs.envoyer(...x), modele: 'faux' } }]);
  const chef = repond('[{"titre": "Un", "consigne": "c"}]');
  const r = await lancerChantier({ projet: d, plan: 'p', chef: { modele: 'chef', envoyer: (...x) => chef.envoyer(...x) }, codeurs: [a], dossierCopies: fs.mkdtempSync(path.join(os.tmpdir(), 'catai-copies-')), nom: 'logs' });
  assert.equal(r.etapes[0].ok, true);
  assert.equal(r.etapes[0].essais, 2);
  assert.equal(logs.appels, 1);
  assert.match(a.recus[1], /Diagnostic :\nLe fichier alpha2\.js manque/);
  jeterChantier(d, 'logs');
});

test('chantier : il dit qui travaille, dans l ordre (chef, codeur, testeur, relecteur), et le résultat de chaque étape', async () => {
  const d = depot({ 'a.test.js': "const test = require('node:test');\ntest('ok', () => {});\n" });
  const relecteur = repond('{"ok": true}');
  const a = fauxCodeur('alpha', [{ type: 'tests', nom: 'Testeur' }, { type: 'relecture', nom: 'Relecteur', envoyer: (...x) => relecteur.envoyer(...x), modele: 'faux' }]);
  const chef = repond('[{"titre": "Un", "consigne": "c"}]');
  const vus = [];
  const r = await lancerChantier({
    projet: d, plan: 'p', chef: { modele: 'chef', envoyer: (...x) => chef.envoyer(...x) }, codeurs: [a], dossierCopies: fs.mkdtempSync(path.join(os.tmpdir(), 'catai-copies-')), nom: 'suivi',
    ev: { plan: (e) => vus.push(`plan ${e.length} ${e[0].codeur}`), activite: (x) => vus.push(x ? `${x.role} ${x.action}` : 'fin'), resultat: (x) => vus.push(`étape ${x.etape} ${x.ok}`) },
  });
  assert.equal(r.etapes[0].ok, true);
  assert.deepEqual(vus, ['chef découpe le plan', 'plan 1 alpha', 'testeur lance les tests du projet avant de commencer', 'codeur écrit le code', 'testeur lance les tests', 'relecteur relit le changement', 'étape 1 true', 'fin']);
  jeterChantier(d, 'suivi');
});
