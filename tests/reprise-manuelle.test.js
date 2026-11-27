// Gestionnaire IPC réel ; Electron et modèles simulés, Git et worktrees réels.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { lancerChantier } = require('../principal/chantier');
const { etatDepot, resumeChantier } = require('../principal/lancement');
const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const debut = source.indexOf("ipcMain.handle('chantier-lancer'");
const handler = source.slice(debut, source.indexOf('\n});', debut) + 4);
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function ipc(codeurs, reprise, options = {}) {
  let lancer;
  const appels = [];
  const contexte = {
    ipcMain: { handle: (_, fn) => { lancer = fn; } },
    projectDir: reprise.projet, chantierReprenable: reprise, chantierPrepare: null, chantierEnCours: null,
    etatDepot: () => ({ pret: true }), AbortController, prechauffage: null,
    powerSaveBlocker: { start: () => 1, stop: () => {} },
    app: { getPath: () => options.racine || os.tmpdir() }, path, fs: { writeFileSync: () => {} },
    ollamaRepond: async () => true, lireReglagesFournisseurs: () => ({}),
    infosFournisseur: () => null, envoyerOllama: () => {}, LIMITES_OLLAMA: {},
    agentsDuChantier: () => ({ codeurs, chef: {}, resume: 'test' }), direChantier: () => {},
    resumeChantier: () => '',
    lancerChantier: async (o) => { appels.push(o); return { branche: 'catai/chantier-test', plan: o.etapes, etapes: o.etapes.map(() => ({ ok: true })), rapport: '' }; },
    ...options.contexte,
  };
  vm.runInNewContext(handler, contexte);
  return { lancer: (agent) => lancer(null, { action: 'reprendre', agent }), appels, contexte };
}
const equipe = () => [{ id: 'a', nom: 'Dev' }, { id: 'b', nom: 'Dev' }];
const reprise = () => ({ projet: 'fixture', nom: 'test', plan: [{ titre: 'Un', agent: 'a' }, { titre: 'Deux', agent: 'a' }], etapes: [{ ok: true }] });

test('reprise IPC : le second homonyme est affecté par id, seule l’étape interrompue change', async () => {
  const r = reprise(); const h = ipc(equipe(), r);
  assert.equal((await h.lancer('b')).ok, true);
  assert.equal(h.appels[0].etapes[1].agent, 'b');
  assert.equal(h.appels[0].etapes[0].agent, 'a');
  assert.equal(r.plan[1].agent, 'a');
});
for (const agent of [undefined, null, '']) test('reprise IPC : Même dev conserve le plan, choix = ' + String(agent), async () => {
  const r = reprise(); r.plan[1].agent = 'Dev historique';
  const h = ipc(equipe(), r);
  assert.equal((await h.lancer(agent)).ok, true);
  assert.equal(h.appels[0].etapes[1].agent, 'Dev historique');
});
for (const agent of ['absent', 'Dev', 0, false, {}, ['b']]) test('reprise IPC : choix invalide refusé sans lancer, ' + JSON.stringify(agent), async () => {
  const r = reprise(); const h = ipc(equipe(), r);
  assert.equal((await h.lancer(agent)).ok, false);
  assert.equal(h.appels.length, 0);
  assert.equal(h.contexte.chantierReprenable, r);
  assert.equal(h.contexte.chantierEnCours, null);
});
test('reprise IPC : identifiant dupliqué refusé', async () => {
  const h = ipc([{ id: 'b', nom: 'Un' }, { id: 'b', nom: 'Deux' }], reprise());
  assert.equal((await h.lancer('b')).ok, false);
  assert.equal(h.appels.length, 0);
});
test('menu de reprise : les homonymes ont des valeurs et libellés distincts', () => {
  const pages = fs.readFileSync(path.join(__dirname, '../interface/pages.js'), 'utf8');
  const instruction = pages.match(/choix\.replaceChildren\(new Option\("Même dev"[\s\S]*?;/)[0];
  let valeurs;
  vm.runInNewContext(instruction, {
    choix: { replaceChildren: (...v) => { valeurs = v; } },
    Option: function (label, value) { this.label = label; this.value = value; },
    equipe: { agents: equipe().map(a => ({ ...a, type: 'codeur' })) },
  });
  assert.deepEqual(valeurs.map(v => v.value), ['', 'a', 'b']);
  assert.notEqual(valeurs[1].label, valeurs[2].label);
});

test('reprise IPC isolée : après interruption, le bon homonyme code et le commit précédent reste intact', async () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-reprise-manuelle-'));
  const projet = path.join(racine, 'projet'); fs.mkdirSync(projet);
  fs.writeFileSync(path.join(projet, 'base.js'), '// base\n');
  git(projet, 'init', '-q'); git(projet, 'add', '.');
  git(projet, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'base');
  const base = git(projet, 'rev-parse', 'HEAD');
  const appels = []; const controles = [];
  const codeurs = equipe().map(a => ({ ...a, modele: 'simule', controles: [{ type: 'relecture', envoyer: async () => { controles.push(a.id); return { content: '{"ok":true}' }; } }],
    envoyer: async (messages) => {
      if (messages.at(-1).role === 'tool') return { content: 'Fini', toolCalls: [] };
      appels.push(a.id);
      return { content: '', toolCalls: [{ function: { name: 'ecrire_fichier', arguments: { chemin: a.id + '.js', contenu: '// fait\n' } } }] };
    },
  }));
  const arret = new AbortController();
  const r = await lancerChantier({ projet, dossierCopies: path.join(racine, 'chantiers'), nom: 'test', plan: 'Deux étapes',
    etapes: [{ titre: 'Un', consigne: 'Créer a.js', agent: 'a' }, { titre: 'Deux', consigne: 'Créer b.js', agent: 'a' }], codeurs,
    signal: arret.signal, ev: { resultat: () => arret.abort() },
  });
  assert.equal(r.etapes.length, 1); assert.equal(r.etapes[0].ok, true);
  const h = ipc(codeurs, { ...r, projet, nom: 'test', texte: 'Deux étapes' }, { racine, contexte: { lancerChantier, etatDepot, resumeChantier } });
  const suite = await h.lancer('b');
  assert.equal(suite.ok, true, suite.erreur);
  assert.equal(suite.incomplet, false);
  assert.deepEqual(appels, ['a', 'b']); assert.deepEqual(controles, ['a', 'b']);
  assert.equal(git(r.copie, 'rev-parse', 'HEAD^'), r.commit);
  assert.equal(git(projet, 'rev-parse', 'HEAD'), base);
  assert.equal(git(projet, 'status', '--porcelain'), '');
  assert.equal(fs.readFileSync(path.join(r.copie, 'b.js'), 'utf8').trim(), '// fait');
});
