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
const { lireReglagesFournisseurs, infosFournisseur, listerModeles, FOURNISSEURS_DE_BASE } = require(path.join(racine, 'principal/fournisseurs'));
const { equipeDepuis } = require(path.join(racine, 'principal/equipe'));
const { agentsDuChantier, etatDepot, MESSAGES_DEPOT } = require(path.join(racine, 'principal/lancement'));
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

  catai                      discuter : le chat reste ouvert dans le terminal (/aide pour ses commandes)
  catai "ta question"        une seule question, puis on rend la main
  catai --prof               mode prof : explications sans code, rien d'écrit ni de lancé
  catai -m qwen3:8b          choisir le modèle
  catai -f gemini            choisir le fournisseur (ollama, gemini, groq, openrouter…)
  catai -d chemin/du/projet  travailler dans un autre dossier

Chaque modification de fichier est montrée avant d'être écrite, et attend ton accord.

Mode chantier (dans un projet git) : Cat Ai code seule, étape par étape, à partir d'un plan.
  catai chantier plan.md             l'équipe de la page Agents : le chef découpe, les codeurs codent, les contrôles vérifient
  catai chantier plan.md --chef gemini   le chef (sinon celui de la page Agents de l'app)
  catai chantier plan.md -m qwen3:8b     le modèle du codeur sur ce PC (Ollama)
  catai chantier plan.md --codeur gemini le codeur en ligne : plus fort, mais il prend sur le quota gratuit
  catai chantier --jeter <nom>       supprime la copie et la branche d'un chantier
Tout se passe dans une copie (une branche à part) : tes fichiers ne bougent pas. À la fin, un rapport
dit ce qui a été fait, et tu gardes ce que tu veux (git merge).`;

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
// Dans l'app installée, catai tourne avec le moteur d'Electron, un programme « fenêtré » sous Windows : son entrée
// standard n'est pas reliée au clavier (la discussion se fermait aussitôt, et les o/n ne passaient pas). On lit
// alors directement la console (CONIN$). Une entrée redirigée (echo o | catai, un fichier) reste lue telle quelle.
function entreeClavier() {
  if (!process.versions.electron || process.platform !== 'win32') return process.stdin;
  try {
    const s = fs.fstatSync(0);
    if (s.isFIFO() || s.isFile()) return process.stdin;
  } catch { /* pas d'entrée standard du tout : la console */ }
  // Le nom complet du périphérique est obligatoire (« CONIN$ » seul n'est pas trouvé), et il faut un vrai flux de
  // terminal : l'entrée standard de ce moteur se ferme au bout d'une milliseconde. Vérifié avec l'app installée.
  try { return new (require('tty').ReadStream)(fs.openSync('\\\\.\\CONIN$', 'r+')); } catch { return process.stdin; }
}

// Lit une ligne après avoir écrit l'invite. Les lignes arrivées avant d'être demandées attendent leur tour :
// avec des réponses envoyées d'un coup (echo o | catai …), readline les lisait avant la question et elles étaient
// perdues. null quand l'entrée est fermée.
function creerLecteur(rl, afficherReponses) {
  const enAvance = [];
  const enAttente = [];
  let fermee = false;
  // Sans vrai terminal, la réponse n'est pas affichée en la tapant : on l'écrit après l'invite, pour que ça se lise
  const montrer = (l) => { if (afficherReponses) process.stdout.write(`${l}\n`); return l; };
  rl.on('line', (l) => (enAttente.length ? enAttente.shift()(montrer(l)) : enAvance.push(l)));
  rl.on('close', () => { fermee = true; while (enAttente.length) enAttente.shift()(null); });
  return (invite) => {
    attenteActive?.();
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

// « Miaou réfléchit » tant que le modèle n'a rien écrit, seulement dans un vrai terminal. La ligne est effacée dès
// que quelque chose arrive.
let attenteActive = null;
function creerAttente() {
  const IMAGES = ['·  ', '·· ', '···', ' ··', '  ·', '   '];
  let minuterie = null;
  const arreter = () => {
    if (!minuterie) return;
    clearInterval(minuterie);
    minuterie = null;
    attenteActive = null;
    process.stdout.write('\r\x1b[K');
  };
  return {
    arreter,
    lancer() {
      if (minuterie || !process.stdout.isTTY) return;
      let n = 0;
      const dessiner = () => process.stdout.write(`\r${gris(`  Miaou réfléchit ${IMAGES[n++ % IMAGES.length]}`)}`);
      dessiner();
      minuterie = setInterval(dessiner, 160);
      attenteActive = arreter;
    },
  };
}

// ---------- Une réponse ----------
async function repondre({ conversation, question, o, lire, signal }) {
  conversation.push({ role: 'user', content: question });
  const messages = [{ role: 'system', content: consignes(o) + infosProjet(o.dossier, question) }, ...conversation];
  let debutLigne = true;
  const attente = creerAttente();
  const ecrire = (t) => { attente.arreter(); process.stdout.write(t); if (t) debutLigne = t.endsWith('\n'); };
  const etiquette = (t) => { ecrire(`${debutLigne ? '' : '\n'}${gris(`  › ${t}`)}\n`); };
  const config = infosFournisseur(o.fournisseur);
  const ollama = config.type === 'ollama';
  const limites = ollama ? LIMITES_OLLAMA : limitesTaille(config);
  // Après chaque outil, le modèle réfléchit de nouveau : l'attente reprend
  const envoyerVu = (envoyer) => (...args) => { attente.lancer(); return envoyer(...args); };
  const { fini, historique } = await discuter({
    messages, modele: o.modele, envoyer: envoyerVu(ollama ? envoyerOllama : envoyeurParApp(o.fournisseur)), limites,
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
  }).finally(() => attente.arreter());
  if (!debutLigne) process.stdout.write('\n');
  if (!fini) process.stdout.write(jaune('(trop d\'étapes : demande-lui de continuer)\n'));
  // On garde la réponse finale pour la suite de la discussion, sans les résultats d'outils (trop lourds)
  conversation.push({ role: 'assistant', content: historique.at(-1)?.content || '' });
}

// ---------- Le programme ----------
// ---------- Mode chantier ----------
async function chantier(argv) {
  const { jeterChantier } = require(path.join(racine, 'principal/chantier'));
  const o = { chef: null, modele: null, dossier: process.cwd(), plan: null, jeter: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--chef') o.chef = argv[++i];
    else if (argv[i] === '--codeur') o.codeur = argv[++i];
    else if (argv[i] === '-m' || argv[i] === '--modele') o.modele = argv[++i];
    else if (argv[i] === '-d' || argv[i] === '--dossier') o.dossier = path.resolve(argv[++i] || '.');
    else if (argv[i] === '--jeter') o.jeter = argv[++i];
    else o.plan = argv[i];
  }
  if (o.jeter) {
    const { branche, copie } = jeterChantier(o.dossier, o.jeter);
    process.stdout.write(`Jeté : branche ${branche}${copie ? ` et copie ${copie}` : ''}.\n`);
    return 0;
  }
  if (!o.plan || !fs.existsSync(o.plan)) { process.stderr.write(rouge('Donne le fichier du plan : catai chantier plan.md\n')); return 1; }
  const arret = new AbortController();
  process.on('SIGINT', () => { process.stdout.write(jaune('\nArrêt du chantier demandé…\n')); arret.abort(); });
  return faireChantier({ dossier: o.dossier, plan: fs.readFileSync(o.plan, 'utf8'), chefForce: o.chef, modeleForce: o.modele, codeurForce: o.codeur, signal: arret.signal });
}

// Lance l'équipe de la page Agents sur un plan, dans une copie du dossier. Renvoie 0 si le chantier a tourné.
async function faireChantier({ dossier, plan, chefForce, modeleForce, codeurForce, signal }) {
  const { lancerChantier } = require(path.join(racine, 'principal/chantier'));
  const depot = etatDepot(dossier);
  if (!depot.pret) { process.stderr.write(rouge(`${MESSAGES_DEPOT[depot.raison]}\n`) + gris('Dans ce dossier : git init, puis git add -A, puis git commit -m "départ".\n')); return 1; }
  if (!(await ollamaRepond())) { process.stderr.write(rouge("Ollama ne répond pas : les codeurs du chantier en ont besoin.\n")); return 1; }
  // L'équipe composée dans l'app (page Agents) ; --chef et -m passent devant
  const { chef, codeurs, resume } = agentsDuChantier({
    reglages: lireReglagesFournisseurs(), infos: infosFournisseur, envoyerLocal: envoyerOllama, envoyerEnLigne: envoyeurParApp,
    limitesLocales: LIMITES_OLLAMA, limitesEnLigne: (id) => limitesTaille(infosFournisseur(id)), chefForce, modeleForce, codeurForce,
    dire: (texte) => process.stdout.write(jaune(`${texte}\n`)),
  });
  if (depot.modifs) process.stdout.write(jaune(`Attention : ${depot.modifs} fichier(s) modifié(s) mais pas enregistré(s) dans git ne seront pas dans la copie.\n`));
  process.stdout.write(`${gras('Chantier')} ${gris(`· ${resume}`)}\n`);
  const debut = Date.now();
  const r = await lancerChantier({
    projet: dossier, plan, chef, codeurs,
    dossierCopies: path.join(dossierDonnees(), 'chantiers'), signal,
    ev: {
      etape: (i, n, titre) => process.stdout.write(`\n${gras(`Étape ${i}/${n}`)} ${titre}\n`),
      info: (t) => process.stdout.write(gris(`${t}\n`)),
    },
  });
  const fichier = path.join(dossierDonnees(), 'chantiers', `${r.branche.replace('catai/', '')}.md`);
  fs.writeFileSync(fichier, `${r.rapport}\n\nDurée : ${Math.round((Date.now() - debut) / 60000)} min.\n`);
  process.stdout.write(`\n${r.rapport}\n\n${gris(`Rapport enregistré : ${fichier}`)}\n`);
  return 0;
}

// ---------- Les commandes de la discussion ----------
const AIDE_DISCUSSION = `  /chantier plan.md   lance l'équipe sur un plan (un fichier, ou le plan écrit à la suite)
  /equipe             qui fait quoi pendant un chantier
  /modeles            les modèles installés sur ce PC
  /modele <nom>       changer de modèle        /fournisseur <nom>   changer de fournisseur
  /dossier <chemin>   changer de dossier       /prof                mode prof oui / non
  /oublier            nouvelle discussion      /quitter             sortir
  Ctrl+C arrête la réponse en cours ; une seconde fois, on quitte.`;

// Le chat, en pixels, pour l'accueil
const CHAT = ['  /\\_/\\ ', ' ( o.o )', '  > ^ < '];

function accueil(o) {
  const infos = [gras('Cat Ai'), gris(`${o.fournisseur} · ${o.modele}${o.prof ? ' · mode prof' : ''}`), gris(o.dossier)];
  process.stdout.write(`\n${CHAT.map((l, i) => `${jaune(l)}  ${infos[i]}`).join('\n')}\n\n${gris('Écris ta demande. /aide pour les commandes.')}\n`);
}

// Une commande « /… » de la discussion. Renvoie 'quitter', ou true si la ligne était une commande.
async function commande(ligne, { o, conversation, lancer }) {
  const [nom, ...reste] = ligne.split(/\s+/);
  const suite = ligne.slice(nom.length).trim();
  const dire = (texte) => process.stdout.write(`${gris(texte)}\n`);
  switch (nom) {
    case '/quitter': case '/q': case '/exit': return 'quitter';
    case '/aide': case '/help': dire(AIDE_DISCUSSION); return true;
    case '/prof': o.prof = !o.prof; dire(`mode prof ${o.prof ? 'activé' : 'désactivé'}`); return true;
    case '/oublier': conversation.length = 0; dire('nouvelle discussion'); return true;
    case '/modele': o.modele = reste[0] || o.modele; dire(`modèle : ${o.modele}`); return true;
    case '/fournisseur': {
      if (!reste[0] || !infosFournisseur(reste[0])) { dire(`fournisseurs : ${FOURNISSEURS_DE_BASE.map((f) => f.id).join(', ')}`); return true; }
      o.fournisseur = reste[0];
      o.modele = lireReglagesFournisseurs().modeles[o.fournisseur] || (o.fournisseur === 'ollama' ? 'qwen3:8b' : o.modele);
      dire(`${o.fournisseur} · ${o.modele}`);
      return true;
    }
    case '/dossier': {
      const d = suite ? path.resolve(o.dossier, suite.replace(/^"|"$/g, '')) : '';
      if (d && fs.existsSync(d) && fs.statSync(d).isDirectory()) o.dossier = d; else if (suite) dire(`dossier introuvable : ${d}`);
      dire(`dossier : ${o.dossier}`);
      return true;
    }
    case '/modeles': {
      const r = await listerModeles(infosFournisseur('ollama'));
      dire(r.ok ? (r.models.length ? r.models.map((m) => `  ${m === o.modele ? '›' : ' '} ${m}`).join('\n') : 'aucun modèle installé') : 'Ollama ne répond pas.');
      return true;
    }
    case '/equipe': {
      const equipe = equipeDepuis(lireReglagesFournisseurs(), infosFournisseur).agents;
      const ligneDe = (a, niveau) => `${'  '.repeat(niveau + 1)}${a.nom}${a.modele ? gris(` · ${a.fournisseur === 'ollama' ? '' : `${a.fournisseur} `}${a.modele}`) : ''}`;
      const dessiner = (parent, niveau) => equipe.filter((a) => a.parent === parent).flatMap((a) => [ligneDe(a, niveau), ...dessiner(a.id, niveau + 1)]);
      process.stdout.write(`${dessiner(null, 0).join('\n')}\n${gris("  (l'équipe se compose dans la page Agents de l'app)")}\n`);
      return true;
    }
    case '/chantier': {
      if (!suite) { dire('Donne un plan : /chantier plan.md, ou /chantier suivi de ce qu\'il faut faire.'); return true; }
      const chemin = path.resolve(o.dossier, suite.replace(/^"|"$/g, ''));
      const plan = fs.existsSync(chemin) && fs.statSync(chemin).isFile() ? fs.readFileSync(chemin, 'utf8') : suite;
      await lancer((signal) => faireChantier({ dossier: o.dossier, plan, signal }));
      return true;
    }
    default:
      if (nom.startsWith('/')) { dire(`commande inconnue : ${nom} (/aide pour la liste)`); return true; }
      return false;
  }
}

async function principal() {
  configurerStockage({ dossier: dossierDonnees() });
  if (process.argv[2] === 'chantier') return chantier(process.argv.slice(3));
  const o = lireOptions(process.argv.slice(2));
  if (o.aide) { process.stdout.write(`${AIDE}\n`); return 0; }
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
  const entree = entreeClavier();
  const rl = readline.createInterface({ input: entree, output: process.stdout, terminal: entree === process.stdin ? undefined : !!entree.isTTY });
  // Une entrée redirigée ne s'affiche pas : on écrit la réponse après la question (la console, elle, l'affiche déjà)
  const lire = creerLecteur(rl, entree === process.stdin && !process.stdin.isTTY);
  const conversation = [];
  // Ctrl+C pendant une réponse l'arrête ; deux fois de suite, ou à l'invite, on quitte. Avec la console lue
  // directement, Ctrl+C arrive comme un signal du processus, pas par readline : on écoute les deux.
  let enCours = null;
  const surCtrlC = () => {
    if (enCours && !enCours.signal.aborted) { enCours.abort(); process.stdout.write(gris('\n(arrêté)\n')); } else { rl.close(); process.exit(0); }
  };
  rl.on('SIGINT', surCtrlC);
  process.on('SIGINT', surCtrlC);
  // Tout ce qui dure (une réponse, un chantier) peut être arrêté par Ctrl+C
  const lancer = async (travail, siErreur = () => {}) => {
    enCours = new AbortController();
    try {
      await travail(enCours.signal);
    } catch (err) {
      if (err.name !== 'AbortError') process.stdout.write(rouge(`\nErreur : ${err.message}\n`));
      siErreur();
    } finally { enCours = null; }
  };
  const unTour = (question) => lancer((signal) => repondre({ conversation, question, o, lire, signal }), () => conversation.pop());
  try {
    if (o.question) { await unTour(o.question); return 0; }
    accueil(o);
    for (;;) {
      let ligne = await lire(`\n${vert('toi ›')} `);
      if (ligne === null) return 0; // entrée fermée
      ligne = ligne.trim();
      if (!ligne) continue;
      const fait = await commande(ligne, { o, conversation, lancer });
      if (fait === 'quitter') return 0;
      if (fait) continue;
      process.stdout.write('\n');
      await unTour(ligne);
    }
  } finally {
    rl.close();
  }
}

if (require.main === module) principal().then((code) => process.exit(code), (err) => { process.stderr.write(`${err.stack || err}\n`); process.exit(1); });

module.exports = { lireOptions, dossierDonnees, consignes, infosProjet, commande };
