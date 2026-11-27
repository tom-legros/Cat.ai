// File des tâches de fond : une à la fois, enregistrée, reprise après un redémarrage
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerFileTaches } = require('../principal/taches');

function cadre({ executer, depart = [] } = {}) {
  const ecrits = [];
  const vues = [];
  let n = 0;
  const file = creerFileTaches({
    lire: () => depart, ecrire: (t) => ecrits.push(JSON.parse(JSON.stringify(t))), prevenir: (l) => vues.push(l),
    executer: executer || (async (t) => ({ statut: 'réussie', rapport: `fait : ${t.demande}`, bilan: 'ok', copie: { nom: `n${t.id}`, base: 'b' }, fichiers: 1, ajouts: 2, retraits: 1, tests: 'réussis' })),
    idSuivant: () => `t${++n}`, maintenant: () => 1000,
  });
  return { file, ecrits, vues };
}

test('les tâches passent une par une, dans l ordre, et le résultat est enregistré', async () => {
  const ordre = [];
  let enMemeTemps = 0;
  let maxEnMemeTemps = 0;
  const { file, ecrits } = cadre({ executer: async (t, { activite }) => {
    enMemeTemps++; maxEnMemeTemps = Math.max(maxEnMemeTemps, enMemeTemps);
    activite('lit src/a.js');
    await new Promise((r) => setTimeout(r, 5));
    ordre.push(t.demande); enMemeTemps--;
    return { statut: 'réussie', rapport: 'r', copie: { nom: 'x', base: 'b' } };
  } });
  file.ajouter({ demande: 'A', projet: '/p', modele: 'm' });
  file.ajouter({ demande: 'B', projet: '/p', modele: 'm' });
  await file.attendre();
  assert.deepEqual(ordre, ['A', 'B']);
  assert.equal(maxEnMemeTemps, 1);
  assert.deepEqual(file.lister().map((t) => t.statut), ['réussie', 'réussie']);
  assert.ok(ecrits.some((l) => l.some((t) => t.activite === 'lit src/a.js')), 'l activité en direct est enregistrée');
  assert.equal(ecrits.at(-1)[0].copie.nom, 'x');
});

test('une tâche qui plante devient « ratée » avec la raison, et la suivante part quand même', async () => {
  const { file } = cadre({ executer: async (t) => { if (t.demande === 'A') throw new Error('Ollama ne répond pas'); return { statut: 'réussie' }; } });
  file.ajouter({ demande: 'A', projet: '/p', modele: 'm' });
  file.ajouter({ demande: 'B', projet: '/p', modele: 'm' });
  await file.attendre();
  const [a, b] = file.lister();
  assert.equal(a.statut, 'ratée');
  assert.equal(a.erreur, 'Ollama ne répond pas');
  assert.equal(b.statut, 'réussie');
});

test('arrêter : une tâche en attente ne part pas, celle en cours reçoit le signal d arrêt', async () => {
  const { file } = cadre({ executer: (t, { signal }) => new Promise((resoudre, rejeter) => {
    signal.addEventListener('abort', () => rejeter(new Error('arrêt')));
  }) });
  const a = file.ajouter({ demande: 'A', projet: '/p', modele: 'm' });
  const b = file.ajouter({ demande: 'B', projet: '/p', modele: 'm' });
  assert.equal(file.arreter(b.id), true);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(file.arreter(a.id), true);
  await file.attendre();
  assert.deepEqual(file.lister().map((t) => t.statut), ['arrêtée', 'arrêtée']);
});

test('au redémarrage, une tâche « en cours » devient « interrompue » ; on peut la relancer ; en attente repart', async () => {
  const depart = [
    { id: 'x', demande: 'X', projet: '/p', modele: 'm', statut: 'en cours', activite: 'lit a.js' },
    { id: 'y', demande: 'Y', projet: '/p', modele: 'm', statut: 'en attente' },
  ];
  const { file } = cadre({ depart });
  assert.equal(file.lister()[0].statut, 'interrompue');
  file.reprendre();
  await file.attendre();
  assert.equal(file.lister()[1].statut, 'réussie');
  assert.equal(file.relancer('x'), true);
  await file.attendre();
  assert.equal(file.lister()[0].statut, 'réussie');
  assert.equal(file.relancer('y'), false, 'une tâche réussie ne se relance pas');
});

test('garder, jeter, retirer ; une demande vide, sans dossier ou sans modèle est refusée', async () => {
  const { file } = cadre();
  const t = file.ajouter({ demande: 'A', projet: '/p', modele: 'm' });
  await file.attendre();
  assert.equal(file.marquer(t.id, 'gardée'), true);
  assert.equal(file.lister()[0].statut, 'gardée');
  assert.equal(file.marquer(t.id, 'n importe quoi'), false);
  assert.equal(file.retirer(t.id), true);
  assert.equal(file.lister().length, 0);
  assert.throws(() => file.ajouter({ demande: '  ', projet: '/p', modele: 'm' }), /Écris ce que la tâche doit faire/);
  assert.throws(() => file.ajouter({ demande: 'A', projet: '', modele: 'm' }), /dossier/);
  assert.throws(() => file.ajouter({ demande: 'A', projet: '/p', modele: '' }), /modèle/);
});

test('app : la page Tâches remplace l entrée Agents, /agent ajoute une tâche, le programme principal fait le reste', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const html = lire('index.html');
  assert.match(html, /data-page="taches"[^>]*>.*Tâches/);
  assert.match(html, /id="page-taches"/);
  assert.ok(html.indexOf('interface/taches.js') > html.indexOf('interface/pages.js'));
  assert.match(lire('interface/pages.js'), /const PAGE_AGENTS = false;/);
  assert.match(lire('interface/pages.js'), /taches: \$\("#page-taches"\)/);
  const preload = lire('preload.js');
  for (const nom of ['tachesLister', 'tacheAjouter', 'tacheArreter', 'tacheRelancer', 'tacheRetirer', 'tacheGarder', 'tacheJeter', 'onTaches']) assert.match(preload, new RegExp(`${nom}:`), nom);
  const main = lire('main.js');
  for (const canal of ['taches-lister', 'tache-ajouter', 'tache-arreter', 'tache-relancer', 'tache-retirer', 'tache-garder', 'tache-jeter']) assert.ok(main.includes("ipcMain.handle('" + canal + "'"), canal);
  assert.ok(main.includes("if (!etat.pret) return { ok: false, erreur: MESSAGES_DEPOT[etat.raison], aPreparer: etat.raison !== 'git-absent' };"), 'tache-ajouter propose de préparer le dossier');
  assert.match(main, /fileTaches\(\)\.reprendre\(\);/);
  const { trouverCommande } = require('../interface/commandes');
  const r = trouverCommande('/agent corrige le bug du menu');
  assert.equal(r.commande.nom, 'agent');
  assert.equal(r.argument, 'corrige le bug du menu');
  assert.match(lire('renderer.js'), /case "agent": \{[\s\S]*ajouterTache\(argument\)/);
});

test('proposer_tache : seulement avec un dossier ouvert et hors mode prof ; il montre une proposition, ne lance rien', async () => {
  const { outilsPour } = require('../principal/outils');
  const { executerOutil } = require('../principal/agent');
  const noms = (mode) => outilsPour(mode).map((o) => o.function.name);
  assert.ok(noms({ projet: true }).includes('proposer_tache'));
  assert.ok(!noms({ projet: false }).includes('proposer_tache'));
  assert.ok(!noms({ projet: true, prof: true }).includes('proposer_tache'));
  // L'agent seul et le chantier ne l'ont pas : leurs outils sont une liste fermée
  assert.ok(!noms({ projet: true, seulement: require('../principal/mission').OUTILS_MISSION }).includes('proposer_tache'));
  const propositions = [];
  const ctx = { ui: { proposerTache: (t) => propositions.push(t) }, projet: () => '/p' };
  const r = await executerOutil('proposer_tache', { tache: 'Corrige le menu' }, ctx);
  assert.deepEqual(propositions, ['Corrige le menu']);
  assert.match(r, /Ne fais PAS les changements toi-même/);
  assert.match(await executerOutil('proposer_tache', { tache: 'x' }, { ui: {}, projet: () => '/p' }), /pas disponibles ici/);
  assert.match(await executerOutil('proposer_tache', { tache: '  ' }, ctx), /Décris la tâche/);
  const fs = require('node:fs');
  const path = require('node:path');
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'interface/personnalite.js'), 'utf8'), /appelle proposer_tache/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'interface/taches.js'), 'utf8'), /window\.api\.onPropositionTache/);
});

test('fautProposerTache : une demande de changement de code avec un dossier ouvert, pas une question ni sans dossier', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const c = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'interface/personnalite.js'), 'utf8') + '\nthis.f = fautProposerTache; this.r = RAPPEL_TACHE;', c);
  assert.equal(c.f('Corrige la fonction somme et ajoute moyenne', '/p'), true);
  assert.equal(c.f('Renomme nomComplet en nomAffiche partout', '/p'), true);
  assert.equal(c.f('Corrige la fonction somme', null), false, 'sans dossier');
  assert.equal(c.f('Comment je corrige ce bug ?', '/p'), false, 'une question');
  assert.equal(c.f('Explique-moi ce que fait calcul.js', '/p'), false);
  assert.match(c.r, /appelle proposer_tache/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8'), /if \(tachesActives && !modeProf && !modeAuto && fautProposerTache\(derniere, project\)\) liste\.push\(\{ role: "system", content: RAPPEL_TACHE \}\);/);
});

test('mode Équipe : la tâche garde son mode (seul par défaut), /chantier l ajoute pour l équipe, Voir/Garder/Jeter suivent sa copie', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vus = [];
  const { file } = cadre({ executer: async (t) => { vus.push(t.mode); return { statut: 'réussie', copie: { type: 'chantier', nom: 'x', base: 'b' } }; } });
  file.ajouter({ demande: 'gros travail', projet: '/p', modele: 'm', mode: 'equipe' });
  file.ajouter({ demande: 'petit travail', projet: '/p', modele: 'm' });
  file.ajouter({ demande: 'autre', projet: '/p', modele: 'm', mode: 'nimporte' });
  await file.attendre();
  assert.deepEqual(vus, ['equipe', 'seul', 'seul']);
  assert.equal(file.lister()[0].copie.type, 'chantier');
  const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const { trouverCommande } = require('../interface/commandes');
  assert.equal(trouverCommande('/chantier refais la page').commande.nom, 'chantier');
  assert.match(lire('renderer.js'), /case "chantier": \{[\s\S]*ajouterTache\(argument, "equipe"\)/);
  const main = lire('main.js');
  assert.match(main, /if \(tache\.mode === 'equipe'\) return executerEquipe\(tache, \{ signal, activite, etapes \}\);/);
  assert.ok(main.includes("ipcMain.handle('tache-changements'"));
  assert.match(main, /if \(c\.chantier\) jeterChantier\(c\.projet, c\.nom\); else jeterCopie/);
  assert.match(lire('preload.js'), /tacheChangements:/);
  assert.match(lire('index.html'), /id="tache-mode"/);
});

test('une tâche trop longue est arrêtée au bout de sa durée maximale, la suivante part ; son travail reste à voir', async () => {
  const { creerFileTaches, DUREE_MAX } = require('../principal/taches');
  assert.ok(DUREE_MAX.equipe > DUREE_MAX.seul);
  let n = 0;
  const file = creerFileTaches({
    idSuivant: () => `t${++n}`,
    dureeMax: (t) => (t.demande === 'longue' ? 30 : 5000),
    executer: (t, { signal }) => new Promise((resoudre, rejeter) => {
      if (t.demande === 'longue') signal.addEventListener('abort', () => rejeter(new Error('Arrêté.')));
      else if (t.demande === 'partielle') signal.addEventListener('abort', () => resoudre({ statut: 'réussie', copie: { nom: 'c', base: 'b' }, fichiers: 2 }));
      else resoudre({ statut: 'réussie' });
    }),
  });
  file.ajouter({ demande: 'longue', projet: '/p', modele: 'm' });
  file.ajouter({ demande: 'courte', projet: '/p', modele: 'm' });
  await file.attendre();
  const [longue, courte] = file.lister();
  assert.equal(longue.statut, 'arrêtée');
  assert.match(longue.erreur, /^Arrêtée au bout de \d+ min : la tâche était trop longue/);
  assert.equal(courte.statut, 'réussie');
  // Arrêtée à la main avec du travail dans sa copie : « en partie »
  const t = file.ajouter({ demande: 'partielle', projet: '/p', modele: 'm' });
  await new Promise((r) => setTimeout(r, 20));
  file.arreter(t.id);
  await file.attendre();
  assert.equal(file.lister().at(-1).statut, 'en partie');
});

test('les étapes du plan sont enregistrées au fil de la tâche, et le journal garde les dernières actions dans l ordre', async () => {
  const { file, ecrits } = cadre({ executer: async (t, { activite, etapes }) => {
    etapes([{ titre: 'Un', etat: 'en cours' }, { titre: 'Deux', etat: 'à faire' }]);
    activite('lit a.py'); activite('lit a.py'); activite('écrit a.py');
    etapes([{ titre: 'Un', etat: 'faite' }, { titre: 'Deux', etat: 'en cours' }]);
    for (let i = 0; i < 12; i++) activite(`action ${i}`);
    return { statut: 'réussie', etapes: [{ titre: 'Un', etat: 'faite' }, { titre: 'Deux', etat: 'faite' }] };
  } });
  file.ajouter({ demande: 'A', projet: '/p', modele: 'm' });
  await file.attendre();
  assert.ok(ecrits.some((l) => l[0].etapes?.[0]?.etat === 'faite' && l[0].etapes?.[1]?.etat === 'en cours'), 'les étapes cochées en direct');
  const t = file.lister()[0];
  assert.deepEqual(t.etapes.map((e) => e.etat), ['faite', 'faite'], 'le résultat final garde ses étapes');
  assert.equal(t.journal.length, 8);
  assert.equal(t.journal.at(-1), 'action 11');
  assert.ok(ecrits.some((l) => JSON.stringify(l[0].journal) === JSON.stringify(['lit a.py', 'écrit a.py'])), 'pas de doublon d affilée');
  // Relancer repart d'une liste vide
  assert.equal(file.relancer('t1'), false, 'une tâche réussie ne se relance pas');
});

test('fautProposerTache : les façons de demander un développement (retour de Tom), et les questions qui n en sont pas', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const c = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'interface/personnalite.js'), 'utf8') + '\nthis.f = fautProposerTache; this.d = demandeDeDev; this.r = RAPPEL_TACHE_SANS_DOSSIER;', c);
  const oui = [
    "J'ai un linux debian 13 sur mon serveur , j'aimerai un gestionnaire defichier que je pourrais executer avec une cmd sur mon serveur tu peux me dev ça",
    'tu peux me dev ça',
    'Développe-moi un petit jeu de morpion',
    'fais-moi un script qui renomme mes photos',
    'Écris-moi un programme qui trie mes fichiers',
    'crée une application de notes en Python',
    'Tu peux ajouter un bouton Exporter ?',
    'Pourrais-tu corriger le bug de la fonction somme ?',
    'code-moi une API pour mes contacts',
    'Phase 1 : Conception & Spécifications\nLivrable : Document de spécifications. Phase 3 : Développement du noyau',
  ];
  for (const q of oui) assert.equal(c.f(q, '/p'), true, q);
  const non = [
    'Comment je corrige ce bug ?',
    'Explique-moi ce que fait calcul.js',
    'Fais-moi un résumé de la Révolution française',
    'écris-moi un poème sur la mer',
    'Tu peux m expliquer les closures ?',
    "C'est quoi un développeur ?",
  ];
  for (const q of non) assert.equal(c.f(q, '/p'), false, q);
  // Sans dossier ouvert : pas de tâche possible, mais une demande de développement est repérée (le chat dit d'ouvrir un dossier)
  assert.equal(c.f('tu peux me dev ça', null), false);
  assert.equal(c.d('tu peux me dev ça'), true);
  assert.equal(c.d('Explique-moi ce que fait calcul.js'), false);
  assert.match(c.r, /Dossier/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8'), /else if \(tachesActives && !modeProf && !modeAuto && !project && demandeDeDev\(derniere\)\) liste\.push\(\{ role: "system", content: RAPPEL_TACHE_SANS_DOSSIER \}\);/);
});

test('main.js : les étapes du plan passent jusqu au mode Équipe (sinon elles n apparaissent qu à la fin)', () => {
  const main = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(main.includes('async function executerTache(tache, { signal, activite, etapes })'));
  assert.ok(main.includes("if (tache.mode === 'equipe') return executerEquipe(tache, { signal, activite, etapes });"));
  assert.ok(main.includes('async function executerEquipe(tache, { signal, activite, etapes: montrerEtapes = () => {} })'));
});

test('main.js : Relancer retire l ancienne copie et sa branche (après accord s il y avait du travail)', () => {
  const main = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'main.js'), 'utf8');
  const bloc = main.slice(main.indexOf("ipcMain.handle('tache-relancer'"), main.indexOf("ipcMain.handle('tache-retirer'"));
  assert.match(bloc, /demanderAccord/);
  assert.match(bloc, /jeterChantier\(c\.projet, c\.nom\)/);
  assert.match(bloc, /fileTaches\(\)\.relancer/);
});

test('rappelRecherche : une demande de développement qui parle de commande ou de serveur ne part pas en recherche web', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const c = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'interface/personnalite.js'), 'utf8') + '\nthis.r = rappelRecherche; this.f = fautProposerTache;', c);
  const q = "J'aimerais une commande pour mon serveur qui met en minuscules les noms des fichiers d'un dossier, tu peux me dev ça";
  assert.equal(c.r(q), null);
  assert.equal(c.f(q, '/p'), true);
  assert.notEqual(c.r('comment installer docker sur debian ?'), null, 'une vraie question de doc cherche toujours');
});

test('la carte de tâche de fond est montrée par l app à la fin d une demande de développement, une seule fois par réponse', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const r = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  const t = fs.readFileSync(path.join(__dirname, '..', 'interface/taches.js'), 'utf8');
  assert.match(r, /flux\.demandeTache = fonctionsExperimentales\(\) && !choix\.prof && !modeAuto && fautProposerTache\(text, project\) \? text : "";/);
  assert.match(r, /if \(!interrompu && flux\.demandeTache && flux\.conv === current\) afficherPropositionTache\(id, flux\.demandeTache\);/);
  assert.match(t, /if \(!fonctionsExperimentales\(\) \|\| propositionsMontrees\.has\(id\)\) return;/);
  assert.match(t, /window\.api\.onPropositionTache\(\(\{ id, tache \}\) => afficherPropositionTache\(id, tache\)\);/);
});

test('fonctions expérimentales : les tâches de fond sont cachées tant que le réglage n est pas activé', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.match(lire('index.html'), /<input id="reglages-experimental" type="checkbox" role="switch">/);
  const barre = lire('interface/barre-laterale.js');
  assert.match(barre, /function fonctionsExperimentales\(\) \{ return lireRetenu\("fonctionsExperimentales"\) === "1"; \}/, 'désactivées par défaut');
  assert.match(barre, /if \(lien\) lien\.hidden = !actif;/, 'l onglet Tâches est caché');
  // Les commandes /agent, /chantier et /taches disparaissent sans le réglage
  const c = { fonctionsExperimentales: () => false };
  vm.runInNewContext(lire('interface/commandes.js') + '\nthis.trouver = trouverCommande; this.filtrer = filtrerCommandes;', c);
  for (const t of ['/agent fais x', '/chantier plan', '/taches']) assert.equal(c.trouver(t), null, t);
  assert.ok(c.trouver('/nouveau'));
  c.fonctionsExperimentales = () => true;
  assert.ok(c.trouver('/taches'));
  // L'outil proposer_tache dit qu'il n'est pas disponible quand l'interface le demande
  const main = lire('main.js');
  assert.match(main, /proposerTache: taches \? \(tache\) =>/);
  assert.match(main, /taches: taches !== false \}\);/);
  assert.match(lire('renderer.js'), /taches: fonctionsExperimentales\(\),/);
});
