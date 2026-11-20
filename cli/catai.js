#!/usr/bin/env node
// catai : Cat Ai dans le terminal, sur le dossier d'où on la lance.
//
//   catai                      discussion dans le terminal (/ pour les commandes : modèle, dossier, prof…)
//   catai "explique main.js"   une seule question, puis on rend la main
//
// Aucune option à retenir : tout se règle dans la discussion avec les commandes « / ». Sans fenêtre ni Chromium,
// catai prend quelques dizaines de Mo de RAM : sur un petit PC, il laisse la place à un modèle plus gros.
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
const { OLLAMA, envoyerOllama, langueProbable } = require(path.join(racine, 'principal/envoi'));
const { discuter } = require(path.join(racine, 'principal/agent'));
const { lireReglagesFournisseurs, infosFournisseur, listerModeles, FOURNISSEURS_DE_BASE } = require(path.join(racine, 'principal/fournisseurs'));
const { equipeDepuis } = require(path.join(racine, 'principal/equipe'));
const { agentsDuChantier, etatDepot, MESSAGES_DEPOT } = require(path.join(racine, 'principal/lancement'));
const { hote, HOTES_LOCAUX } = require(path.join(racine, 'principal/gratuit'));
const { creerEcran } = require('./ecran');

// Plein écran (cli/ecran.js) : ouvert seulement pour une discussion dans un vrai terminal. Tout ce que catai écrit
// passe par lui ; readline, lui, écrit directement la ligne de saisie.
const ecran = creerEcran();
const sortieEcran = (t) => ecran.ecrire(t);

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

  catai                  discuter (tape / pour voir les commandes)
  catai "ta question"    une seule question, puis on rend la main

Le modèle, le fournisseur, le dossier et le mode prof se changent dans la discussion (/modele, /fournisseur,
/dossier, /prof). Chaque modification de fichier est montrée avant d'être écrite, et attend ton accord.`;

// Seulement la question : tout le reste se règle dans la discussion (commandes « / »)
function lireOptions(argv) {
  const o = { prof: false, modele: null, fournisseur: null, dossier: process.cwd(), question: [] };
  for (const a of argv) {
    if (a === '-h' || a === '--aide' || a === '--help') o.aide = true;
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
  const montrer = (l) => { if (afficherReponses) sortieEcran(`${l}\n`); return l; };
  rl.on('line', (l) => (enAttente.length ? enAttente.shift()(montrer(l)) : enAvance.push(l)));
  rl.on('close', () => { fermee = true; while (enAttente.length) enAttente.shift()(null); });
  return (invite) => {
    attenteActive?.();
    const lignes = String(invite).split('\n');
    const derniere = lignes.pop();
    if (lignes.length) sortieEcran(`${lignes.join('\n')}\n`);
    rl.setPrompt(derniere);
    ecran.invite(derniere);
    if (enAvance.length || fermee) {
      sortieEcran(derniere);
      return Promise.resolve(enAvance.length ? montrer(enAvance.shift()) : null);
    }
    rl.prompt(true);
    // readline vient d'effacer le bas de l'écran (bas du cadre, aide) : on le remet
    ecran.pied();
    return new Promise((resoudre) => enAttente.push(resoudre));
  };
}

function creerUi(lire) {
  const oui = async (question) => /^(o|oui|y|yes)$/i.test(((await lire(`${question} ${gras('(o/N)')} `)) || '').trim());
  return {
    demander: async ({ titre, message, detail, accepter = 'Autoriser', attention }) => {
      sortieEcran(`\n${(attention ? jaune : gras)(`■ ${titre}`)}\n${message}\n${detail ? gris(detail) + '\n' : ''}`);
      return oui(`${accepter} ?`);
    },
    // La fenêtre avant / après de l'app, en diff : - en rouge, + en vert, avec trois lignes autour de chaque changement
    confirmerEcriture: async ({ chemin, ancien, nouveau, existe }) => {
      const { hunks } = structuredPatch(chemin, chemin, ancien, nouveau, '', '', { context: 3 });
      const lignes = hunks.flatMap((h) => [gris(`@@ ligne ${h.newStart} @@`), ...h.lines.map((l) => (l[0] === '+' ? vert(l) : l[0] === '-' ? rouge(l) : gris(l)))]);
      const MAX = 200;
      sortieEcran(`\n${gras(`■ ${existe ? 'Modifier' : 'Créer'} ${chemin}`)}\n${lignes.slice(0, MAX).join('\n')}\n`);
      if (lignes.length > MAX) sortieEcran(gris(`… et ${lignes.length - MAX} lignes de plus\n`));
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
    sortieEcran('\r\x1b[K');
  };
  return {
    arreter,
    lancer() {
      if (minuterie || !process.stdout.isTTY) return;
      let n = 0;
      const dessiner = () => sortieEcran(`\r${gris(`  Miaou réfléchit ${IMAGES[n++ % IMAGES.length]}`)}`);
      dessiner();
      minuterie = setInterval(dessiner, 160);
      attenteActive = arreter;
    },
  };
}

// ---------- Une réponse ----------
// La sortie d'une réponse, comme dans Claude Code : « ● » devant le début, les lignes suivantes décalées de deux
// espaces, les actions en gris sous « ⎿ ». Le texte arrive par morceaux : on suit où en est la ligne.
function creerSortie(ecrireBrut = (t) => sortieEcran(t)) {
  let etat = 'debut'; // debut : rien d'écrit ; milieu : au milieu d'une ligne ; nouvelle : au début d'une ligne
  return {
    texte(t) {
      String(t || '').split('\n').forEach((morceau, i) => {
        if (i > 0 && etat !== 'debut') { ecrireBrut('\n'); etat = 'nouvelle'; }
        let m = morceau;
        if (etat === 'debut') { m = m.replace(/^\s+/, ''); if (!m) return; ecrireBrut(`${jaune('●')} `); }
        else if (!m) return;
        else if (etat === 'nouvelle') ecrireBrut('  ');
        ecrireBrut(m);
        etat = 'milieu';
      });
    },
    action(t) {
      if (etat === 'milieu') ecrireBrut('\n');
      ecrireBrut(`${gris(`  ⎿  ${t}`)}\n`);
      if (etat !== 'debut') etat = 'nouvelle';
    },
    fin() { if (etat === 'milieu') ecrireBrut('\n'); },
  };
}

// Certains modèles (qwen3:4b par exemple) réfléchissent même en mode Rapide, et n'écrivent que la fin de leur
// réflexion (« </think> »). L'app efface alors ce qu'elle avait affiché ; un terminal ne peut pas effacer ce qui a
// défilé. On garde donc de côté le début tant qu'il ressemble à une réflexion (balise <think>, ou un début en anglais),
// et on n'écrit que ce qui suit « </think> ». Sans « </think> » à la fin, tout est écrit : rien n'est perdu.
const AVANT_DE_DECIDER = 120;
function creerFiltrePensee(ecrire, { langue = () => null } = {}) {
  let etat = 'verif'; // verif : on regarde le début ; pensee : on attend </think> ; direct : on écrit tout
  let tampon = '';
  let ecrit = false;
  const sortir = (t) => { if (t) { ecrit = true; ecrire(t); } };
  return {
    get ecrit() { return ecrit; },
    texte(t) {
      if (etat === 'direct') return sortir(t);
      tampon += t;
      const fin = tampon.indexOf('</think>');
      if (fin >= 0) { etat = 'direct'; sortir(tampon.slice(fin + 8).replace(/^\s+/, '')); tampon = ''; return; }
      if (etat === 'pensee') return;
      if (/^\s*<think>/.test(tampon) || (tampon.length >= AVANT_DE_DECIDER && langue(tampon) === 'en')) { etat = 'pensee'; return; }
      if (tampon.length >= AVANT_DE_DECIDER) { etat = 'direct'; sortir(tampon); tampon = ''; }
    },
    // Fin de la réponse : ce qui attend encore est écrit (sans la balise d'ouverture)
    fin() { if (tampon) sortir(tampon.replace(/^\s*<think>/, '')); tampon = ''; etat = 'direct'; },
    // L'agent a retiré la réflexion et renvoie la réponse propre : on l'écrit seulement si rien ne l'a déjà été
    remplacer(t) { tampon = ''; etat = 'direct'; if (!ecrit) sortir(String(t || '').replace(/^\s+/, '')); },
    enAttente: () => etat !== 'direct',
  };
}

// La vitesse et la durée, en gris sous la réponse (Ollama seulement : il donne ses mesures)
function ligneMesures(mesures, debut) {
  const somme = (cle) => mesures.reduce((t, m) => t + (Number.isFinite(m[cle]) ? m[cle] : 0), 0);
  const tokens = somme('eval_count');
  const duree = somme('eval_duration');
  const morceaux = [];
  if (tokens && duree) morceaux.push(`${(tokens * 1e9 / duree).toFixed(1).replace('.', ',')} tokens/s`);
  morceaux.push(`${((Date.now() - debut) / 1000).toFixed(1).replace('.', ',')} s`);
  return gris(`  ${morceaux.join(' · ')}`);
}

async function repondre({ conversation, question, o, lire, signal }) {
  conversation.push({ role: 'user', content: question });
  const messages = [{ role: 'system', content: consignes(o) }, { role: 'system', name: 'contexte_projet', content: infosProjet(o.dossier, question) }, ...conversation];
  const debut = Date.now();
  const mesures = [];
  const attente = creerAttente();
  const sortie = creerSortie();
  // La réflexion que certains modèles écrivent quand même est gardée de côté (voir creerFiltrePensee)
  let filtre = creerFiltrePensee((t) => { attente.arreter(); sortie.texte(t); }, { langue: langueProbable });
  // L'agent annonce qu'il retire ce qui a été affiché : soit la réflexion (la réponse propre suit aussitôt),
  // soit un appel d'outil écrit en texte (rien ne suit)
  let remplacement = false;
  const ecrire = (t) => {
    if (remplacement) { remplacement = false; filtre.remplacer(t); return; }
    filtre.texte(t);
  };
  const annuler = () => {
    remplacement = true;
    queueMicrotask(() => { if (remplacement) { remplacement = false; etiquette("(c'était un appel d'outil)"); } });
  };
  const etiquette = (t) => { filtre.fin(); attente.arreter(); sortie.action(t); filtre = creerFiltrePensee((x) => { attente.arreter(); sortie.texte(x); }, { langue: langueProbable }); };
  const config = infosFournisseur(o.fournisseur);
  const ollama = config.type === 'ollama';
  const limites = ollama ? LIMITES_OLLAMA : limitesTaille(config);
  // Après chaque outil, le modèle réfléchit de nouveau : l'attente reprend
  const envoyerVu = (envoyer) => (...args) => { attente.lancer(); return envoyer(...args); };
  const { fini, historique } = await discuter({
    messages, modele: o.modele, envoyer: envoyerVu(ollama ? envoyerOllama : envoyeurParApp(o.fournisseur)), limites,
    options: { projet: true, documents: false, connecteur: !!readJson('settings.json', {}).adresseMcp, ...(ollama ? { onStatistiques: (m) => mesures.push(m) } : {}) },
    ctx: {
      projet: () => o.dossier, ouvrirProjet: (d) => { o.dossier = d; }, reglages: () => readJson('settings.json', {}),
      dossierDocuments: path.join(dossierDonnees(), 'documents'), ui: creerUi(lire), prof: o.prof, liensDonnes: [], documentsJoints: new Set(),
      signal, maxExtrait: limites ? limites.resultatOutil - 500 : 20000, fournisseurLocal: estLocal(config), nomFournisseur: config.nom,
    },
    ev: {
      morceau: ecrire,
      // Un appel d'outil écrit en texte a été affiché : dans un terminal on ne peut pas l'effacer, on le dit
      annuler,
      outil: (nom, args) => { const f = ETIQUETTES[nom]; if (f) etiquette(f(args || {})); },
      pause: (s) => etiquette(`pause de ${s} s demandée par le fournisseur`),
    },
  }).finally(() => { filtre.fin(); attente.arreter(); sortie.fin(); });
  if (!fini) sortieEcran(jaune('  (trop d\'étapes : demande-lui de continuer)\n'));
  sortieEcran(`${ligneMesures(mesures, debut)}\n`);
  // On garde la réponse finale pour la suite de la discussion, sans les résultats d'outils (trop lourds)
  conversation.push({ role: 'assistant', content: historique.at(-1)?.content || '' });
}

// ---------- Mode chantier (/chantier dans la discussion) ----------
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
    dire: (texte) => sortieEcran(jaune(`${texte}\n`)),
  });
  if (depot.modifs) sortieEcran(jaune(`Attention : ${depot.modifs} fichier(s) modifié(s) mais pas enregistré(s) dans git ne seront pas dans la copie.\n`));
  sortieEcran(`${gras('Chantier')} ${gris(`· ${resume}`)}\n`);
  const debut = Date.now();
  const r = await lancerChantier({
    projet: dossier, plan, chef, codeurs,
    dossierCopies: path.join(dossierDonnees(), 'chantiers'), signal,
    ev: {
      etape: (i, n, titre) => sortieEcran(`\n${gras(`Étape ${i}/${n}`)} ${titre}\n`),
      info: (t) => sortieEcran(gris(`${t}\n`)),
    },
  });
  const fichier = path.join(dossierDonnees(), 'chantiers', `${r.branche.replace('catai/', '')}.md`);
  fs.writeFileSync(fichier, `${r.rapport}\n\nDurée : ${Math.round((Date.now() - debut) / 60000)} min.\n`);
  sortieEcran(`\n${r.rapport}\n\n${gris(`Rapport enregistré : ${fichier}`)}\n`);
  return 0;
}

// ---------- Les commandes de la discussion ----------
// [nom, ce qu'on peut écrire après, à quoi elle sert] : sert à /aide et à la complétion par Tab
const COMMANDES_CLI = [
  ['/modele', '<nom>', 'changer de modèle'],
  ['/modeles', '', 'les modèles installés sur ce PC'],
  ['/fournisseur', '<nom>', 'changer de fournisseur (ollama, gemini, groq…)'],
  ['/dossier', '<chemin>', 'travailler dans un autre dossier'],
  ['/prof', '', 'mode prof oui / non'],
  ['/oublier', '', 'nouvelle discussion'],
  ['/chantier', '<plan.md>', "l'équipe code un plan dans une copie git"],
  ['/jeter', '<nom>', "supprime la copie et la branche d'un chantier"],
  ['/equipe', '', 'qui fait quoi pendant un chantier'],
  ['/aide', '', 'cette liste'],
  ['/quitter', '', 'sortir'],
];
const AIDE_DISCUSSION = [
  ...COMMANDES_CLI.map(([nom, suite, texte]) => `  ${jaune(nom.padEnd(13))}${gris(suite.padEnd(12))}${texte}`),
  '',
  gris('  Tab complète une commande · Ctrl+C arrête la réponse, deux fois pour quitter'),
].join('\n');

// Tab : les commandes qui commencent par ce qu'on a tapé (toutes si on n'a tapé que « / »)
function completer(ligne) {
  if (!ligne.startsWith('/') || /\s/.test(ligne)) return [[], ligne];
  const noms = COMMANDES_CLI.map(([nom]) => nom);
  const trouvees = noms.filter((nom) => nom.startsWith(ligne.toLowerCase()));
  return [trouvees.length ? trouvees : noms, ligne];
}

// Largeur visible d'un texte (sans les codes de couleur)
const largeur = (t) => [...String(t).replace(/\x1b\[[0-9;]*m/g, '')].length;
const colonnes = () => Math.max(40, Math.min(process.stdout.columns || 80, 100));
const dossierCourt = (d) => {
  const maison = os.homedir();
  return d === maison || d.startsWith(maison + path.sep) ? '~' + d.slice(maison.length) : d;
};
const etat = (o) => `${o.modele} · ${infosFournisseur(o.fournisseur)?.nom || o.fournisseur}${o.prof ? ' · mode prof' : ''}`;

// Le chat, en caractères, pour l'accueil
const CHAT = [' /\\_/\\ ', '( o.o )', ' > ^ < '];

// L'accueil : un cadre arrondi avec le chat, le modèle et le dossier, comme Claude Code
function accueil(o) {
  const lignes = [gras('Cat Ai'), gris(etat(o)), gris(dossierCourt(o.dossier))];
  const interieur = Math.min(colonnes() - 4, Math.max(...lignes.map((l, i) => largeur(CHAT[i]) + 3 + largeur(l))) + 2);
  const bord = (g, d) => gris(`${g}${'─'.repeat(interieur + 2)}${d}`);
  const corps = lignes.map((l, i) => {
    const contenu = `${jaune(CHAT[i])}   ${l}`;
    return `${gris('│')} ${contenu}${' '.repeat(Math.max(0, interieur - largeur(contenu)))} ${gris('│')}`;
  });
  sortieEcran(`\n${bord('╭', '╮')}\n${corps.join('\n')}\n${bord('╰', '╯')}\n`);
  if (ecran.ouvert) ecran.aide('/ pour les commandes · Tab pour compléter · Ctrl+C pour arrêter');
  else sortieEcran(`${gris('  / pour les commandes · Tab pour compléter · Ctrl+C pour arrêter')}\n`);
}

// Avant chaque question : une ligne avec le modèle et le dossier, puis l'invite « ❯ »
function invite(o) {
  if (ecran.ouvert) { ecran.statut(`${etat(o)} · ${dossierCourt(o.dossier)}`); return ` ${jaune('❯')} `; }
  const titre = ` ${etat(o)} · ${dossierCourt(o.dossier)} `;
  const reste = Math.max(2, colonnes() - largeur(titre) - 2);
  return `\n${gris(`──${titre}${'─'.repeat(reste)}`)}\n${jaune('❯')} `;
}

// Une commande « /… » de la discussion. Renvoie 'quitter', ou true si la ligne était une commande.
async function commande(ligne, { o, conversation, lancer }) {
  const [brut, ...reste] = ligne.split(/\s+/);
  const nom = brut.toLowerCase();
  const suite = ligne.slice(brut.length).trim();
  const dire = (texte) => sortieEcran(`${gris(texte)}\n`);
  switch (nom) {
    case '/quitter': case '/q': case '/exit': return 'quitter';
    case '/': case '/aide': case '/help': sortieEcran(`${AIDE_DISCUSSION}\n`); return true;
    case '/prof': o.prof = !o.prof; dire(`mode prof ${o.prof ? 'activé' : 'désactivé'}`); return true;
    case '/oublier': case '/nouveau': conversation.length = 0; dire('nouvelle discussion'); return true;
    case '/modele': case '/modèle': {
      if (!reste[0]) { dire(`modèle : ${o.modele} (/modeles pour la liste)`); return true; }
      o.modele = reste[0];
      dire(`modèle : ${o.modele}`);
      return true;
    }
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
      sortieEcran(`${dessiner(null, 0).join('\n')}\n${gris("  (l'équipe se compose dans la page Agents de l'app)")}\n`);
      return true;
    }
    case '/chantier': {
      if (!suite) { dire('Donne un plan : /chantier plan.md, ou /chantier suivi de ce qu\'il faut faire.'); return true; }
      const chemin = path.resolve(o.dossier, suite.replace(/^"|"$/g, ''));
      const plan = fs.existsSync(chemin) && fs.statSync(chemin).isFile() ? fs.readFileSync(chemin, 'utf8') : suite;
      await lancer((signal) => faireChantier({ dossier: o.dossier, plan, signal }));
      return true;
    }
    case '/jeter': {
      if (!reste[0]) { dire('Donne le nom du chantier : /jeter <nom> (il est dans le rapport du chantier).'); return true; }
      const { branche, copie } = require(path.join(racine, 'principal/chantier')).jeterChantier(o.dossier, reste[0]);
      dire(`jeté : branche ${branche}${copie ? ` et copie ${copie}` : ''}`);
      return true;
    }
    default:
      if (nom.startsWith('/')) { dire(`commande inconnue : ${nom} (tape / pour la liste)`); return true; }
      return false;
  }
}

async function principal() {
  configurerStockage({ dossier: dossierDonnees() });
  const o = lireOptions(process.argv.slice(2));
  if (o.aide) { sortieEcran(`${AIDE}\n`); return 0; }
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
  const rl = readline.createInterface({ input: entree, output: process.stdout, completer, terminal: entree === process.stdin ? undefined : !!entree.isTTY });
  // Une entrée redirigée ne s'affiche pas : on écrit la réponse après la question (la console, elle, l'affiche déjà)
  const lire = creerLecteur(rl, entree === process.stdin && !process.stdin.isTTY);
  const conversation = [];
  // Ctrl+C pendant une réponse l'arrête ; deux fois de suite, ou à l'invite, on quitte. Avec la console lue
  // directement, Ctrl+C arrive comme un signal du processus, pas par readline : on écoute les deux.
  let enCours = null;
  const surCtrlC = () => {
    if (enCours && !enCours.signal.aborted) { enCours.abort(); sortieEcran(gris('\n(arrêté)\n')); } else { ecran.fermer(); rl.close(); process.exit(0); }
  };
  rl.on('SIGINT', surCtrlC);
  process.on('SIGINT', surCtrlC);
  // Tout ce qui dure (une réponse, un chantier) peut être arrêté par Ctrl+C
  const lancer = async (travail, siErreur = () => {}) => {
    enCours = new AbortController();
    try {
      await travail(enCours.signal);
    } catch (err) {
      if (err.name !== 'AbortError') sortieEcran(rouge(`\nErreur : ${err.message}\n`));
      siErreur();
    } finally { enCours = null; }
  };
  const unTour = (question) => lancer((signal) => repondre({ conversation, question, o, lire, signal }), () => conversation.pop());
  try {
    if (o.question) { await unTour(o.question); return 0; }
    // Une vraie discussion : plein écran, comme « claude » (on retrouve le terminal d'avant en sortant)
    ecran.attacher(rl);
    ecran.ouvrir();
    accueil(o);
    for (;;) {
      let ligne = await lire(invite(o));
      if (ligne === null) return 0; // entrée fermée
      ligne = ligne.trim();
      if (!ligne) continue;
      // Ce qu'on vient d'écrire monte dans la conversation, et le champ se vide
      if (ecran.ouvert) { ecran.invite(''); sortieEcran(`\n${jaune('❯')} ${gras(ligne)}\n`); }
      const fait = await commande(ligne, { o, conversation, lancer });
      if (fait === 'quitter') return 0;
      if (fait) continue;
      sortieEcran('\n');
      await unTour(ligne);
    }
  } finally {
    ecran.fermer();
    rl.close();
  }
}

if (require.main === module) principal().then((code) => { ecran.fermer(); process.exit(code); }, (err) => { ecran.fermer(); process.stderr.write(`${err.stack || err}\n`); process.exit(1); });

module.exports = { lireOptions, dossierDonnees, consignes, infosProjet, commande, creerSortie, creerFiltrePensee, ligneMesures, completer, COMMANDES_CLI };
