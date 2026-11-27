const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const entre = (debut, fin) => source.slice(source.indexOf(debut), source.indexOf(fin, source.indexOf(debut)));
function cadre() {
  const evenements = []; const handlers = {};
  const c = vm.createContext({ AbortController, DOMException, projectDir: 'projet-A',
    infosFournisseur: () => ({ type: 'ollama' }), HOTES_LOCAUX: [], hote: () => '',
    readJson: () => ({}), DOSSIER_DOCUMENTS: () => 'documents-test',
    uiFenetres: { demander: async () => true, choisirExecutable: async () => 'test.exe' },
    setProject: dir => { c.projectDir = dir; return dir; },
    win: { webContents: { send: (canal, donnees) => evenements.push({ canal, ...donnees }) } },
    controllers: new Map(), ipcMain: { on: (canal, fn) => { handlers[canal] = fn; } },
  });
  vm.runInContext(entre('function contexteAgent(', '// Toute écriture') +
    entre('const confirmations =', 'async function writeWithConfirm(') +
    entre("ipcMain.on('chat-stop'", '// Mesures natives du résumé'), c);
  return { c, evenements, handlers };
}
test('le contexte des outils garde son dossier malgré un changement global', () => {
  const { c } = cadre(); const ctx = c.contexteAgent({ fournisseurId: 'ollama' });
  c.projectDir = 'projet-B';
  assert.equal(ctx.projet(), 'projet-A');
  ctx.ouvrirProjet('projet-C');
  assert.equal(ctx.projet(), 'projet-C');
  assert.equal(c.projectDir, 'projet-B', 'ne détourne pas le projet sélectionné depuis le départ');
});
test('une ouverture par outil conserve le comportement habituel sans changement concurrent', () => {
  const { c } = cadre(); const ctx = c.contexteAgent({ fournisseurId: 'ollama' });
  ctx.ouvrirProjet('projet-C');
  assert.equal(ctx.projet(), 'projet-C'); assert.equal(c.projectDir, 'projet-C');
});
test('annuler A refuse seulement sa confirmation et laisse B et Enregistrer disponibles', async () => {
  const { c, handlers, evenements } = cadre();
  const a = new AbortController(); const b = new AbortController();
  c.controllers.set('A', a); c.controllers.set('B', b);
  const pa = c.demanderConfirmation({ chemin: 'a' }, { requeteId: 'A', signal: a.signal });
  const pb = c.demanderConfirmation({ chemin: 'b' }, { requeteId: 'B', signal: b.signal });
  const libre = c.demanderConfirmation({ chemin: 'manuel' });
  handlers['chat-stop']({}, 'A');
  assert.equal(await pa, false);
  assert.equal(b.signal.aborted, false);
  const ids = evenements.filter(e => e.canal === 'confirm-write');
  assert.equal(ids.at(-1).chemin, 'b');
  handlers['confirm-write-reply']({}, { id: ids.at(-1).id, ok: true });
  assert.equal(await pb, true);
  handlers['confirm-write-reply']({}, { id: evenements.filter(e => e.canal === 'confirm-write').at(-1).id, ok: true });
  assert.equal(await libre, true);
});
test('une seule confirmation affichée et une réponse anticipée ne peut pas valider la suivante', async () => {
  const { c, handlers, evenements } = cadre();
  const a = c.demanderConfirmation({ chemin: 'a' }); const b = c.demanderConfirmation({ chemin: 'b' });
  assert.equal(evenements.length, 1);
  handlers['confirm-write-reply']({}, { id: 2, ok: true });
  handlers['confirm-write-reply']({}, { id: 1, ok: false });
  assert.equal(await a, false);
  assert.equal(evenements.at(-1).chemin, 'b');
  handlers['confirm-write-reply']({}, { id: 2, ok: false });
  assert.equal(await b, false);
});
test('annulation pendant une fenêtre native : son accord tardif est refusé', async () => {
  const { c } = cadre(); let repondre;
  c.uiFenetres.demander = () => new Promise(resolve => { repondre = resolve; });
  const arret = new AbortController();
  const ctx = c.contexteAgent({ fournisseurId: 'ollama', signal: arret.signal });
  const accord = ctx.ui.demander({}); arret.abort(); repondre(true);
  assert.equal(await accord, false);
  assert.throws(() => ctx.ouvrirProjet('interdit'), { name: 'AbortError' });
});

test('gestionnaire chat (IPC simulé) : Gemini démarre pendant Ollama, second Ollama attend et annulation ciblée libère la place', async () => {
  const { c, handlers } = cadre(); const evenements = []; const departs = []; const fins = new Map();
  Object.assign(c, {
    fileOllama: require('../principal/file-ollama').creerFileOllama(), prechauffage: null, LEGERE: false,
    idValide: () => true, urlsDans: () => [], verifierGratuit() {}, envoyeurPour: async () => () => {},
    infosFournisseur: id => ({ type: id }), limitesTaille: () => null, LIMITES_OLLAMA: { resultatOutil: 8000 }, MAX_STEPS: 10,
    discuter: ({ modele, ctx }) => new Promise((resolve, reject) => {
      departs.push({ modele, projet: ctx.projet() });
      fins.set(modele, () => resolve({ fini: true }));
      ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true });
    }),
  });
  vm.runInContext(entre("ipcMain.on('chat',", "ipcMain.on('chat-stop'"), c);
  const event = { sender: { send: (canal, data) => evenements.push({ canal, ...data }) } };
  const lancer = (id, fournisseurId = 'ollama') => handlers.chat(event, { id, model: id, fournisseurId, messages: [] });
  const tour = () => new Promise(resolve => setImmediate(resolve));
  const a = lancer('A'); c.projectDir = 'projet-B'; await tour();
  const b = lancer('B'); const g = lancer('G', 'gemini'); await tour();
  assert.deepEqual(departs.map(d => d.modele), ['A', 'G']);
  assert.equal(departs[0].projet, 'projet-A', 'dossier capturé avant la préparation asynchrone du fournisseur');
  assert.ok(evenements.some(e => e.id === 'B' && e.etat === 'attente-ollama'));
  handlers['chat-stop']({}, 'A'); await a; await tour();
  assert.deepEqual(departs.map(d => d.modele), ['A', 'G', 'B']);
  assert.ok(evenements.some(e => e.id === 'A' && e.interrompu));
  assert.equal(c.controllers.get('G').signal.aborted, false);
  fins.get('G')(); fins.get('B')(); await Promise.all([b, g]);
  assert.equal(c.fileOllama.occupee, false); assert.equal(c.controllers.size, 0);
});

test('une confirmation annulée dans la file n’interrompt pas celle déjà affichée', async () => {
  const { c, handlers, evenements } = cadre(); const arret = new AbortController();
  const a = c.demanderConfirmation({ chemin: 'a' });
  const b = c.demanderConfirmation({ chemin: 'b' }, { signal: arret.signal });
  arret.abort(); assert.equal(await b, false);
  assert.equal(evenements.length, 1);
  handlers['confirm-write-reply']({}, { id: 1, ok: true });
  assert.equal(await a, true); assert.equal(evenements.length, 1);
});
