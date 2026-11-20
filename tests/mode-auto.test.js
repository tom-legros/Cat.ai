// Mode Auto du chat : branchement dans main.js (contexte des outils, envoi du chat) et dans l'interface
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const main = lire('main.js');
const entre = (source, debut, fin) => source.slice(source.indexOf(debut), source.indexOf(fin, source.indexOf(debut)));
const BASE = 'a'.repeat(40);

function cadre(surcharges = {}) {
  const evenements = []; const handlers = {}; const departs = [];
  const c = vm.createContext({
    AbortController, DOMException, projectDir: 'projet-A',
    infosFournisseur: () => ({ type: 'ollama' }), HOTES_LOCAUX: [], hote: () => '',
    readJson: () => ({}), DOSSIER_DOCUMENTS: () => 'documents-test',
    uiFenetres: { demander: async () => true, choisirExecutable: async () => 'test.exe' },
    setProject: (dir) => { c.projectDir = dir; return dir; },
    win: { webContents: { send: (canal, donnees) => evenements.push({ canal, ...donnees }) } },
    controllers: new Map(), ipcMain: { on: (canal, fn) => { handlers[canal] = fn; } },
    fileOllama: require('../principal/file-ollama').creerFileOllama(), prechauffage: null, LEGERE: false,
    idValide: () => true, urlsDans: () => [], verifierGratuit() {}, envoyeurPour: async () => () => {},
    limitesTaille: () => null, LIMITES_OLLAMA: { resultatOutil: 8000 }, MAX_STEPS: 10,
    copiesOccupees: new Set(),
    copiePourDiscussion: (projet, demande) => ({ nom: demande?.nom || 'nouvelle', base: BASE, copie: 'copie', dossier: path.join('copie', 'src'), nouvelle: !demande }),
    changementsCopie: () => ({ fichiers: [{ chemin: 'a.js', ajouts: 2, retraits: 0 }], ajouts: 2, retraits: 0 }),
    discuter: async ({ ctx }) => {
      // Hors Auto, la fenêtre avant / après attendrait une réponse : on ne demande l'écriture que dans une copie
      const dansCopie = String(ctx.projet()).startsWith('copie');
      departs.push({ projet: ctx.projet(), ecriture: dansCopie ? await ctx.ui.confirmerEcriture({ chemin: 'a.js' }) : null, occupees: [...c.copiesOccupees] });
      return { fini: true };
    },
    ...surcharges,
  });
  vm.runInContext(entre(main, 'function contexteAgent(', '// Toute écriture') +
    entre(main, 'const confirmations =', 'async function writeWithConfirm(') +
    entre(main, "ipcMain.on('chat',", "ipcMain.on('chat-stop'"), c);
  const event = { sender: { send: (canal, data) => evenements.push({ canal, ...data }) } };
  const lancer = (payload) => handlers.chat(event, { id: 'R', model: 'qwen3.5:9b', fournisseurId: 'ollama', messages: [], ...payload });
  return { c, evenements, departs, lancer };
}

test('contexte des outils en Auto : écriture sans fenêtre, pas de changement de dossier', async () => {
  const { c, evenements } = cadre();
  const ctx = c.contexteAgent({ fournisseurId: 'ollama', projetInitial: 'copie', auto: true });
  assert.equal(await ctx.ui.confirmerEcriture({ chemin: 'a.js' }), true);
  assert.equal(evenements.filter((e) => e.canal === 'confirm-write').length, 0, 'aucune fenêtre avant / après');
  assert.throws(() => ctx.ouvrirProjet('ailleurs'), /reste dans la copie/);
  assert.equal(ctx.projet(), 'copie');
  // Sans Auto, l'écriture passe toujours par la fenêtre
  const demander = c.contexteAgent({ fournisseurId: 'ollama' });
  void demander.ui.confirmerEcriture({ chemin: 'b.js' });
  assert.equal(evenements.filter((e) => e.canal === 'confirm-write').length, 1);
});

test('chat en Auto : l agent travaille dans la copie, l interface reçoit la copie puis ses changements avant la fin', async () => {
  const { c, evenements, departs, lancer } = cadre();
  await lancer({ agent: { auto: true, copie: null } });
  assert.equal(departs[0].projet, path.join('copie', 'src'));
  assert.equal(departs[0].ecriture, true);
  assert.deepEqual(departs[0].occupees, ['nouvelle'], 'la copie est marquée occupée pendant la réponse');
  assert.equal(c.copiesOccupees.size, 0, 'libérée à la fin');
  const canaux = evenements.map((e) => e.canal);
  assert.ok(canaux.lastIndexOf('chat-agent') < canaux.indexOf('chat-done'), canaux.join(', '));
  const fin = evenements.filter((e) => e.canal === 'chat-agent').at(-1);
  assert.equal(fin.nom, 'nouvelle'); assert.equal(fin.base, BASE); assert.equal(fin.ajouts, 2);
});

test('chat en Auto : copie reprise par son nom ; mode prof, sans dossier ou dépôt pas prêt → mode Demander', async () => {
  let r = cadre(); await r.lancer({ agent: { auto: true, copie: { nom: 'deja', base: BASE } } });
  assert.equal(r.evenements.find((e) => e.canal === 'chat-agent').nom, 'deja');

  r = cadre(); await r.lancer({ prof: true, agent: { auto: true } });
  assert.equal(r.departs[0].projet, 'projet-A'); assert.ok(!r.evenements.some((e) => e.canal === 'chat-agent'));

  r = cadre({ projectDir: null }); await r.lancer({ agent: { auto: true } });
  assert.equal(r.departs[0].projet, null); assert.ok(!r.evenements.some((e) => e.canal === 'chat-agent'));

  r = cadre({ copiePourDiscussion: () => ({ erreur: "Ce dossier n'est pas suivi par git" }) });
  await r.lancer({ agent: { auto: true } });
  assert.equal(r.departs[0].projet, 'projet-A');
  assert.match(r.evenements.find((e) => e.canal === 'chat-agent').erreur, /pas suivi par git/);
  assert.ok(r.evenements.some((e) => e.canal === 'chat-done'));
});

test('main : Voir / Garder / Jeter ne reçoivent qu un nom et une base, Jeter demande confirmation, rien pendant une réponse', () => {
  assert.match(main, /function copieParNom\(\{ nom, base \} = \{\}\) \{\s*if \(!NOM_COPIE\.test\(String\(nom\)\) \|\| !\/\^\[0-9a-f\]\{40\}\$\/\.test\(String\(base\)\)\) return null;\s*const copie = copieDe\(dossierCopiesAgent\(\), nom\);/);
  const jeter = entre(main, "ipcMain.handle('agent-jeter'", '// Une seule app ouverte');
  assert.match(jeter, /await demanderAccord\(/);
  assert.match(jeter, /copiesOccupees\.has\(c\.nom\)/);
  assert.match(entre(main, "ipcMain.handle('agent-garder'", "ipcMain.handle('agent-jeter'"), /copiesOccupees\.has\(c\.nom\)/);
  const preload = lire('preload.js');
  for (const canal of ['agent-changements', 'agent-garder', 'agent-jeter']) assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\('${canal}'`));
  assert.match(preload, /onAgent: \(cb\) => ipcRenderer\.on\('chat-agent'/);
});

test('interface : pastille Demander / Auto seulement avec un dossier et hors mode prof, barre Voir / Garder / Jeter', () => {
  const renderer = lire('renderer.js');
  const html = lire('index.html');
  assert.match(renderer, /flux\.auto = !!\(modeAuto && project && !choix\.prof\);\s*window\.api\.chat\(\{/);
  assert.match(renderer, /agent: flux\.auto \? \{ auto: true, copie: conv\.agentCopie \|\| null \} : null,/);
  assert.match(renderer, /\(\(flux\.auto && ACTIONS_AUTO\[name\]\) \|\| ACTIONS\[name\]/);
  assert.match(renderer, /bouton\.hidden = !project \|\| prof;/);
  assert.match(renderer, /localStorage\.setItem\("modeAgent", auto \? "auto" : "demander"\)/);
  for (const id of ['mode-agent', 'menu-agent', 'agent-barre', 'agent-voir', 'agent-garder', 'agent-jeter', 'agent-diff-modal']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.ok(html.indexOf('id="agent-barre"') < html.indexOf('class="saisie__boite"'), 'la barre est au-dessus de la saisie');
  // Le patch s'affiche avec les couleurs de la fenêtre avant / après
  const c = vm.createContext({ document: { createElement: () => { const el = { className: '', textContent: '', enfants: [], append: (...e) => el.enfants.push(...e) }; return el; } } });
  vm.runInContext(entre(renderer, 'function lignesPatch(', '\nasync function voirChangementsCopie') + '\nthis.lignesPatch = lignesPatch;', c);
  const lignes = c.lignesPatch('diff --git a/a.js b/a.js\nindex 1..2 100644\n--- a/a.js\n+++ b/a.js\n@@ -1,2 +1,3 @@\n un\n-deux\n+DEUX\n+trois\n');
  assert.deepEqual(JSON.parse(JSON.stringify(lignes.map((l) => l.className))), ['diff__saut diff__fichier', 'diff__saut', 'diff__ligne', 'diff__ligne is-retrait', 'diff__ligne is-ajout', 'diff__ligne is-ajout']);
  assert.equal(lignes[0].textContent, 'a.js');
});
