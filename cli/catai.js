#!/usr/bin/env node
// catai : Cat Ai dans le terminal, sur le dossier d'où on la lance.
//
//   catai                      discussion dans le terminal (/aide pour les commandes)
//   catai "explique main.js"   une seule question, puis on rend la main
//   catai --prof               mode prof : pas de code donné, rien d'écrit ni de lancé
//   catai -m qwen3:8b          un autre modèle
//   catai -f gemini            un autre fournisseur (celui choisi dans l'app par défaut)
//
// Même cerveau que l'app : les consignes (interface/personnalite.js), les outils et leurs garde-fous
// (principal/agent.js). Seule l'interface change : les fenêtres de confirmation deviennent des questions o/n,
// et la fenêtre avant / après devient un diff en couleurs. Les données (prénom, mémoire, réglages) sont celles de
// l'app. Ollama est appelé directement. Les clés des fournisseurs en ligne sont chiffrées par l'app et ne se
// lisent que depuis elle : pour eux, catai relance l'app en mode « appel » (main.js, --catai-appel), qui fait la
// demande et renvoie la réponse. La clé ne quitte jamais l'app.
//
// Lancé par catai.cmd / catai (dossier bin/ de l'app) avec ELECTRON_RUN_AS_NODE, ou par node en développement.
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const readline = require('readline');
const { spawn } = require('child_process');
const { structuredPatch } = require('diff');
const racine = path.join(__dirname, '..');
const { configurerStockage, readJson } = require(path.join(racine, 'principal/stockage'));
const { listFiles, fichiersCites, contenuJoint } = require(path.join(racine, 'principal/fichiers'));
const { LIMITES_OLLAMA, MAX_JOINT, raccourcir, listeCourte, limitesTaille } = require(path.join(racine, 'principal/taille'));
const { OLLAMA, envoyerOllama } = require(path.join(racine, 'principal/envoi'));
const { discuter } = require(path.join(racine, 'principal/agent'));
const { lireReglagesFournisseurs, infosFournisseur } = require(path.join(racine, 'principal/fournisseurs'));
const { hote, HOTES_LOCAUX } = require(path.join(racine, 'principal/gratuit'));

// ---------- Couleurs (seulement dans un vrai terminal, et jamais avec NO_COLOR) ----------
const couleurs = process.stdout.isTTY && !process.env.NO_COLOR;
const teinte = (code) => (t) => (couleurs ? `\x1b[${code}m${t}\x1b[0m` : t);
const gris = teinte('2');
const vert = teinte('32');
const rouge = teinte('31');
const jaune = teinte('33');
const gras = teinte('1');

// ---------- Les données de l'app ----------
function dossierDonnees() {
  if (process.env.CATAI_DONNEES) return process.env.CATAI_DONNEES;
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'assistant-ia');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'assistant-ia');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'assistant-ia');
}

// ---------- Les options ----------
const AIDE = `catai : Cat Ai dans le terminal, sur le dossier courant.

  catai                      discuter (tape /aide pendant la discussion)
  catai "ta question"        une seule question, puis on rend la main
  catai --prof               mode prof : explications sans code, rien d'écrit ni de lancé
  catai -m qwen3:8b          choisir le modèle
  catai -f gemini            choisir le fournisseur (ollama, gemini, groq, openrouter…)
  catai -d chemin/du/projet  travailler dans un autre dossier

Chaque modification de fichier est montrée avant d'être écrite, et attend ton accord.`;

function lireOptions(argv) {
  const o = { prof: false, modele: null, fournisseur: null, dossier: process.cwd(), question: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--aide' || a === '--help') o.aide = true;
    else if (a === '--prof') o.prof = true;
    else if (a === '-m' || a === '--modele') o.modele = argv[++i];
    else if (a === '-f' || a === '--fournisseur') o.fournisseur = argv[++i];
    else if (a === '-d' || a === '--dossier') o.dossier = path.resolve(argv[++i] || '.');
    else o.question.push(a);
  }
  o.question = o.question.join(' ').trim();
  return o;
}

// ---------- Les consignes, les mêmes que dans l'app ----------
// interface/personnalite.js est écrit pour la page de l'app : on l'exécute à part, avec ce qu'il attend d'elle
function consignes({ prof, dossier, modele, fournisseur = 'ollama' }) {
  const settings = readJson('settings.json', {});
  const config = infosFournisseur(fournisseur) || { nom: 'Ollama', type: 'ollama' };
  const ctx = {
    prenom: settings.prenom || '', perso: {}, project: dossier, prof, memory: readJson('memory.json', []), knownProjects: [],
    modelSel: { value: modele }, fournisseurActif: () => config, fournisseurLocal: () => estLocal(config),
    messagesEnvoyes: 1, auHasard: (l) => l[0],
  };
  vm.createContext(ctx);
  vm.runInContext(`${fs.readFileSync(path.join(racine, 'interface/personnalite.js'), 'utf8')}\n;globalThis.__consignes = systemPrompt();`, ctx);
  return ctx.__consignes;
}

const estLocal = (config) => !config || config.type === 'ollama' || HOTES_LOCAUX.includes(hote(config.baseUrl));

// ---------- Fournisseur en ligne : l'app fait la demande ----------
// Même forme qu'envoyerOllama. La demande passe par un fichier temporaire lisible par l'utilisateur seul.
function envoyeurParApp(fournisseurId) {
  return (messages, modele, onMorceau, signal, options = {}) => new Promise((resoudre, rejeter) => {
    const fichier = path.join(os.tmpdir(), `catai-appel-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(fichier, JSON.stringify({ fournisseurId, modele, messages, options }), { mode: 0o600 });
    // Dans l'app installée, le code est dans app.asar et l'exécutable le trouve seul ; en développement,
    // on lance l'Electron du projet sur le dossier du projet
    const installee = /app\.asar$/.test(racine);
    const executable = process.versions.electron ? process.execPath : require('electron');
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const enfant = spawn(executable, [...(installee ? [] : [racine]), '--catai-appel', fichier], { env, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let reste = '';
    let fini = false;
    const finir = (f) => { if (!fini) { fini = true; signal?.removeEventListener('abort', annuler); fs.rmSync(fichier, { force: true }); f(); } };
    const annuler = () => { enfant.kill(); finir(() => rejeter(Object.assign(new Error('Arrêté.'), { name: 'AbortError' }))); };
    signal?.addEventListener('abort', annuler, { once: true });
    enfant.stdout.setEncoding('utf8').on('data', (d) => {
      const lignes = (reste + d).split('\n');
      reste = lignes.pop();
      for (const l of lignes) {
        let m;
        try { m = JSON.parse(l); } catch { continue; } // Electron écrit parfois ses propres messages
        if (m.morceau) onMorceau(m.morceau);
        else if (m.pause) options.onPause?.(m.pause);
        else if (m.fin) finir(() => resoudre(m.fin));
        else if (m.erreur) finir(() => rejeter(new Error(m.erreur)));
      }
    });
    enfant.on('error', (err) => finir(() => rejeter(new Error(`Impossible de lancer l'app : ${err.message}`))));
    enfant.on('close', () => finir(() => rejeter(new Error("L'app n'a pas répondu."))));
  });
}

// Comme l'app : la liste des fichiers du dossier, et le contenu de ceux que la question cite
function infosProjet(dossier, question) {
  const fichiers = listFiles(dossier);
  let place = MAX_JOINT;
  const cites = fichiersCites(question, fichiers).slice(0, 3).map((f) => {
    const contenu = raccourcir(contenuJoint(dossier, f), Math.max(place, 500));
    place -= contenu.length;
    return { f, contenu };
  });
  const { fichiers: liste, coupee } = listeCourte(fichiers);
  let texte = `\n\nFichiers du dossier ouvert :\n${liste.join('\n') || '(vide)'}`;
  if (coupee) texte += "\n(liste coupée : il y a d'autres fichiers, vois-les avec lister_fichiers)";
  for (const { f, contenu } of cites) texte += `\n\nContenu de ${f} :\n\`\`\`\n${contenu}\n\`\`\``;
  return `${texte}\n\nBase-toi UNIQUEMENT sur ces fichiers réels. Pour voir un autre fichier, utilise lire_fichier. N'invente jamais le contenu d'un fichier.`;
}

// ---------- Les questions dans le terminal ----------
// Lit une ligne après avoir écrit l'invite. Les lignes arrivées avant d'être demandées attendent leur tour :
// avec des réponses envoyées d'un coup (echo o | catai …), readline les lisait avant la question et elles étaient
// perdues. null quand l'entrée est fermée.
function creerLecteur(rl) {
  const enAvance = [];
  const enAttente = [];
  let fermee = false;
  // Sans vrai terminal, la réponse n'est pas affichée en la tapant : on l'écrit après l'invite, pour que ça se lise
  const montrer = (l) => { if (!process.stdin.isTTY) process.stdout.write(`${l}\n`); return l; };
  rl.on('line', (l) => (enAttente.length ? enAttente.shift()(montrer(l)) : enAvance.push(l)));
  rl.on('close', () => { fermee = true; while (enAttente.length) enAttente.shift()(null); });
  return (invite) => {
    process.stdout.write(invite);
    if (enAvance.length) return Promise.resolve(montrer(enAvance.shift()));
    if (fermee) return Promise.resolve(null);
    return new Promise((resoudre) => enAttente.push(resoudre));
  };
}

function creerUi(lire) {
  const oui = async (question) => /^(o|oui|y|yes)$/i.test(((await lire(`${question} ${gras('(o/N)')} `)) || '').trim());
  return {
    demander: async ({ titre, message, detail, accepter = 'Autoriser', attention }) => {
      process.stdout.write(`\n${(attention ? jaune : gras)(`■ ${titre}`)}\n${message}\n${detail ? gris(detail) + '\n' : ''}`);
      return oui(`${accepter} ?`);
    },
    // La fenêtre avant / après de l'app, en diff : - en rouge, + en vert, avec trois lignes autour de chaque changement
    confirmerEcriture: async ({ chemin, ancien, nouveau, existe }) => {
      const { hunks } = structuredPatch(chemin, chemin, ancien, nouveau, '', '', { context: 3 });
      const lignes = hunks.flatMap((h) => [gris(`@@ ligne ${h.newStart} @@`), ...h.lines.map((l) => (l[0] === '+' ? vert(l) : l[0] === '-' ? rouge(l) : gris(l)))]);
      const MAX = 200;
      process.stdout.write(`\n${gras(`■ ${existe ? 'Modifier' : 'Créer'} ${chemin}`)}\n${lignes.slice(0, MAX).join('\n')}\n`);
      if (lignes.length > MAX) process.stdout.write(gris(`… et ${lignes.length - MAX} lignes de plus\n`));
      return oui(existe ? 'Appliquer cette modification ?' : 'Créer ce fichier ?');
    },
    choisirExecutable: async ({ titre }) => ((await lire(`${titre} (chemin complet, vide pour annuler) : `)) || '').trim().replace(/^"|"$/g, '') || null,
  };
}

// Ce que l'app affiche en étiquettes pendant une réponse, en une ligne grise
const ETIQUETTES = {
  lister_fichiers: (a) => `liste ${a.dossier || 'les fichiers'}`,
  lire_fichier: (a) => `lit ${a.chemin}`,
  chercher: (a) => `cherche « ${a.texte} »`,
  ecrire_fichier: (a) => `écrit ${a.chemin}`,
  remplacer_texte: (a) => `modifie ${a.chemin}`,
  chercher_web: (a) => `cherche sur internet « ${a.requete} »`,
  lire_page_web: (a) => `lit ${a.url}`,
  lancer_tests: () => 'demande à lancer les tests',
  bilan_tests: (a) => a.bilan,
  refus: (a) => `écriture refusée : ${a.chemin}`,
  'refus-lecture': (a) => `lecture refusée : ${a.chemin}`,
  'refus-page': (a) => `page non lue : ${a.url}`,
};

async function ollamaRepond() {
  try { return (await fetch(`${OLLAMA}/api/version`, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; }
}

// ---------- Une réponse ----------
async function repondre({ conversation, question, o, lire, signal }) {
  conversation.push({ role: 'user', content: question });
  const messages = [{ role: 'system', content: consignes(o) + infosProjet(o.dossier, question) }, ...conversation];
  let debutLigne = true;
  const ecrire = (t) => { process.stdout.write(t); if (t) debutLigne = t.endsWith('\n'); };
  const etiquette = (t) => { ecrire(`${debutLigne ? '' : '\n'}${gris(`  › ${t}`)}\n`); };
  const config = infosFournisseur(o.fournisseur);
  const ollama = config.type === 'ollama';
  const limites = ollama ? LIMITES_OLLAMA : limitesTaille(config);
  const { fini, historique } = await discuter({
    messages, modele: o.modele, envoyer: ollama ? envoyerOllama : envoyeurParApp(o.fournisseur), limites,
    options: { projet: true, documents: false, connecteur: !!readJson('settings.json', {}).adresseMcp },
    ctx: {
      projet: () => o.dossier, ouvrirProjet: (d) => { o.dossier = d; }, reglages: () => readJson('settings.json', {}),
      dossierDocuments: path.join(dossierDonnees(), 'documents'), ui: creerUi(lire), prof: o.prof, liensDonnes: [], documentsJoints: new Set(),
      signal, maxExtrait: limites ? limites.resultatOutil - 500 : 20000, fournisseurLocal: estLocal(config), nomFournisseur: config.nom,
    },
    ev: {
      morceau: ecrire,
      // Un appel d'outil écrit en texte a été affiché : dans un terminal on ne peut pas l'effacer, on le dit
      annuler: () => etiquette("(c'était un appel d'outil)"),
      outil: (nom, args) => { const f = ETIQUETTES[nom]; if (f) etiquette(f(args || {})); },
      pause: (s) => etiquette(`pause de ${s} s demandée par le fournisseur`),
    },
  });
  if (!debutLigne) process.stdout.write('\n');
  if (!fini) process.stdout.write(jaune('(trop d\'étapes : demande-lui de continuer)\n'));
  // On garde la réponse finale pour la suite de la discussion, sans les résultats d'outils (trop lourds)
  conversation.push({ role: 'assistant', content: historique.at(-1)?.content || '' });
}

// ---------- Le programme ----------
async function principal() {
  const o = lireOptions(process.argv.slice(2));
  if (o.aide) { process.stdout.write(`${AIDE}\n`); return 0; }
  configurerStockage({ dossier: dossierDonnees() });
  // Par défaut, le fournisseur et le modèle choisis dans l'app
  const reglages = lireReglagesFournisseurs();
  o.fournisseur ||= reglages.actif;
  if (!infosFournisseur(o.fournisseur)) { process.stderr.write(rouge(`Fournisseur inconnu : ${o.fournisseur}\n`)); return 1; }
  o.modele ||= reglages.modeles[o.fournisseur] || (o.fournisseur === 'ollama' ? 'qwen3:8b' : '');
  if (!o.modele) { process.stderr.write(rouge(`Aucun modèle choisi pour ${o.fournisseur} : choisis-en un dans l'app, ou passe -m.\n`)); return 1; }
  if (!fs.existsSync(o.dossier) || !fs.statSync(o.dossier).isDirectory()) { process.stderr.write(rouge(`Dossier introuvable : ${o.dossier}\n`)); return 1; }
  if (o.fournisseur === 'ollama' && !(await ollamaRepond())) {
    process.stderr.write(rouge('Ollama ne répond pas.') + ' Ouvre Cat Ai (elle le démarre), ou lance « ollama serve ».\n');
    return 1;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lire = creerLecteur(rl);
  const conversation = [];
  // Ctrl+C pendant une réponse l'arrête ; deux fois de suite, ou à l'invite, on quitte
  let enCours = null;
  rl.on('SIGINT', () => {
    if (enCours && !enCours.signal.aborted) { enCours.abort(); process.stdout.write(gris('\n(arrêté)\n')); } else { rl.close(); process.exit(0); }
  });
  const unTour = async (question) => {
    enCours = new AbortController();
    try {
      await repondre({ conversation, question, o, lire, signal: enCours.signal });
    } catch (err) {
      if (err.name !== 'AbortError') process.stdout.write(rouge(`\nErreur : ${err.message}\n`));
      conversation.pop();
    } finally { enCours = null; }
  };
  try {
    if (o.question) { await unTour(o.question); return 0; }
    process.stdout.write(`${gras('Cat Ai')} ${gris(`· ${o.fournisseur} · ${o.modele} · ${o.dossier}${o.prof ? ' · mode prof' : ''}`)}\n${gris('/aide pour les commandes, /quitter pour sortir')}\n`);
    for (;;) {
      let ligne;
      ligne = await lire(`\n${vert('toi ›')} `);
      if (ligne === null) return 0; // entrée fermée
      ligne = ligne.trim();
      if (!ligne) continue;
      if (ligne === '/quitter' || ligne === '/q') return 0;
      if (ligne === '/aide') { process.stdout.write(gris('/prof : mode prof oui / non   /modele <nom> : changer de modèle   /oublier : nouvelle discussion   /quitter\n')); continue; }
      if (ligne === '/prof') { o.prof = !o.prof; process.stdout.write(gris(`mode prof ${o.prof ? 'activé' : 'désactivé'}\n`)); continue; }
      if (ligne === '/oublier') { conversation.length = 0; process.stdout.write(gris('nouvelle discussion\n')); continue; }
      if (ligne.startsWith('/modele')) { o.modele = ligne.split(/\s+/)[1] || o.modele; process.stdout.write(gris(`modèle : ${o.modele}\n`)); continue; }
      process.stdout.write('\n');
      await unTour(ligne);
    }
  } finally {
    rl.close();
  }
}

if (require.main === module) principal().then((code) => process.exit(code), (err) => { process.stderr.write(`${err.stack || err}\n`); process.exit(1); });

module.exports = { lireOptions, dossierDonnees, consignes, infosProjet };
