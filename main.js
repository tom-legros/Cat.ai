const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const OLLAMA = 'http://127.0.0.1:11434';
const dataFile = (name) => path.join(app.getPath('userData'), name);
const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv', 'vendor', '.idea', '.vscode']);
const MAX_FILE = 100 * 1024;
const MAX_STEPS = 8;

let win;
let projectDir = null;
const controllers = new Map();

// ---------- Stockage (discussions, mémoire, réglages, fournisseurs) ----------
// Ce que chaque fichier contient, pour des alertes compréhensibles
const CONTENU_DES_FICHIERS = {
  'conversations.json': 'tes discussions',
  'memory.json': 'la mémoire du chat',
  'settings.json': 'les réglages',
  'fournisseurs.json': 'les fournisseurs et tes clés API',
};

// Fichiers abîmés et réparés. Avant que la fenêtre soit prête, les alertes attendent ici
// et l'interface les demande au démarrage ; ensuite, elles lui sont envoyées tout de suite.
const alertesStockage = [];

function signalerStockage(texte) {
  alertesStockage.push(texte);
  if (win && !win.webContents.isLoading()) win.webContents.send('alertes-stockage', alertesStockage.splice(0));
}

function readJson(name, fallback) {
  let texte;
  try {
    texte = fs.readFileSync(dataFile(name), 'utf8');
  } catch (err) {
    // Pas encore de fichier : premier lancement, rien d'anormal
    if (err.code === 'ENOENT') return fallback;
    // Fichier présent mais pas lisible (bloqué par l'antivirus…) : il est peut-être très bien.
    // Renvoyer fallback ferait écraser son contenu au prochain enregistrement : on s'arrête là.
    throw new Error(`Impossible de lire ${name} (${err.code}) : réessaie dans un instant ou relance l'app.`);
  }
  try {
    return JSON.parse(texte);
  } catch {
    return reparer(name, fallback);
  }
}

// Fichier abîmé (coupé en plein milieu, modifié à la main…) : on ne l'écrase jamais.
// Il est mis de côté sous un autre nom, et on repart de la sauvegarde faite par writeJson si elle est lisible.
function reparer(name, fallback) {
  const fichier = dataFile(name);
  // Heure locale au format 2026-10-26 03:02:59 (le format suédois est justement celui-là)
  const date = new Date().toLocaleString('sv-SE').replace(/[ :]/g, '-');
  const misDeCote = `${fichier}.illisible-${date}`;
  fs.renameSync(fichier, misDeCote);
  const contenu = CONTENU_DES_FICHIERS[name] || name;
  const sauvegarde = `${fichier}.sauvegarde`;
  if (estLisible(sauvegarde)) {
    // Recopiée à la place du fichier abîmé : les lectures suivantes la trouvent directement
    fs.copyFileSync(sauvegarde, fichier);
    signalerStockage(`Le fichier qui garde ${contenu} était abîmé. Je suis reparti de la sauvegarde, faite juste avant la dernière modification : seule cette modification est perdue. Le fichier abîmé est mis de côté ici : ${misDeCote}`);
    return JSON.parse(fs.readFileSync(fichier, 'utf8'));
  }
  signalerStockage(`Le fichier qui garde ${contenu} était abîmé, et il n'y avait pas de sauvegarde lisible : je repars de zéro. Le fichier abîmé est mis de côté ici : ${misDeCote}`);
  return fallback;
}

// Écriture atomique : le nouveau contenu part d'abord dans un fichier temporaire, écrit jusqu'au disque,
// puis il prend la place de l'ancien d'un seul coup (renommage). Si l'app plante ou que le PC s'éteint
// en plein milieu, on garde soit l'ancienne version, soit la nouvelle, jamais un fichier à moitié écrit.
// Avant de remplacer, la version actuelle est copiée dans « nom.sauvegarde », seulement si elle est lisible :
// une copie abîmée ne servirait à rien et écraserait la dernière bonne sauvegarde.
function writeJson(name, value) {
  const fichier = dataFile(name);
  const temporaire = `${fichier}.tmp`;
  const descripteur = fs.openSync(temporaire, 'w');
  try {
    fs.writeFileSync(descripteur, JSON.stringify(value, null, 2));
    // Le système garde les écritures en cache un moment : sans fsync, une coupure de courant juste après
    // le renommage pourrait laisser un fichier vide à la place des deux versions
    fs.fsyncSync(descripteur);
  } finally {
    fs.closeSync(descripteur);
  }
  if (estLisible(fichier)) fs.copyFileSync(fichier, `${fichier}.sauvegarde`);
  fs.renameSync(temporaire, fichier);
}

function estLisible(fichier) {
  try {
    JSON.parse(fs.readFileSync(fichier, 'utf8'));
    return true;
  } catch {
    return false;
  }
}

// ---------- Ollama ----------
// On lance seulement le serveur, caché, au lieu de l'appli Ollama et de sa fenêtre.
// S'il tournait déjà, on ne touche à rien ; si c'est nous qui l'avons lancé, on l'arrête en quittant.
let serveurOllama = null;

async function ollamaRepond() {
  try {
    return (await fetch(`${OLLAMA}/api/version`)).ok;
  } catch {
    return false;
  }
}

async function demarrerOllama() {
  if (await ollamaRepond()) return;
  const exe = path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe');
  if (!fs.existsSync(exe)) return;
  serveurOllama = spawn(exe, ['serve'], {
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, OLLAMA_VULKAN: '1' },
  });
  serveurOllama.on('exit', () => (serveurOllama = null));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#050505',
    title: 'Le chat noir',
    icon: path.join(__dirname, 'icone.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile('index.html');

  // Un lien dans une réponse s'ouvre dans le navigateur, jamais dans la fenêtre de l'app
  const ouvrirDehors = (url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); };
  win.webContents.on('will-navigate', (e, url) => { e.preventDefault(); ouvrirDehors(url); });
  win.webContents.setWindowOpenHandler(({ url }) => { ouvrirDehors(url); return { action: 'deny' }; });
}

// ---------- Outils que le modèle peut utiliser ----------
// Empêche le modèle de sortir du dossier projet choisi, y compris par un lien symbolique
// ou une jonction Windows placés dans le projet : on vérifie aussi où mène vraiment le chemin
function safePath(rel) {
  if (!projectDir) throw new Error("Aucun dossier projet ouvert. Demande à l'utilisateur d'en ouvrir un.");
  const full = path.resolve(projectDir, rel || '.');
  if (!estDans(full, projectDir) || !estDans(cheminReel(full), cheminReel(projectDir))) throw new Error('Chemin en dehors du projet.');
  return full;
}

const estDans = (chemin, dossier) => chemin === dossier || chemin.startsWith(dossier + path.sep);

// Vraie destination d'un chemin, liens suivis. Pour un fichier qui n'existe pas encore (ecrire_fichier),
// on résout le dossier parent le plus proche qui existe, puis on rajoute la fin du chemin.
function cheminReel(chemin) {
  try {
    return fs.realpathSync.native(chemin);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    // Un lien cassé (sa destination n'existe pas) : impossible de savoir où il mène, et écrire dedans
    // créerait le fichier à sa destination. On refuse.
    if (fs.lstatSync(chemin, { throwIfNoEntry: false })) throw new Error("Lien dont la destination n'existe pas : refusé.");
    const parent = path.dirname(chemin);
    if (parent === chemin) return chemin;
    return path.join(cheminReel(parent), path.basename(chemin));
  }
}

// Fichiers qui contiennent souvent des secrets (mots de passe, clés API, clés privées).
// Leur contenu n'est jamais joint tout seul au message : le modèle doit le lire avec lire_fichier, et l’utilisateur confirme.
// Les modèles d'exemple (.env.example…) sont faits pour être partagés : ils restent lisibles.
const SENSIBLES = [
  /^\.env(\..+)?$/i,                                // .env, .env.local, .env.production…
  /\.(pem|key|p12|pfx|jks|keystore|ppk)$/i,         // certificats et clés privées
  /^id_(rsa|dsa|ecdsa|ed25519)$/i,                  // clés SSH privées (les .pub sont publiques)
  /^\.(npmrc|pypirc|netrc|git-credentials)$/i,      // jetons de npm, PyPI, Git
  /^(credentials|secrets?)(\.json)?$/i,
];
const EXEMPLES = /\.(example|sample|template|dist)$/i;

function estSensible(chemin) {
  const nom = path.basename(chemin);
  return !EXEMPLES.test(nom) && SENSIBLES.some((motif) => motif.test(nom));
}

// Lecture d'un fichier sensible : L’utilisateur décide, en sachant si le contenu reste sur son PC ou part en ligne
async function accordLectureSensible(chemin, fournisseurId) {
  const config = configFournisseur(fournisseurId);
  const local = !config || config.type === 'ollama' || HOTES_LOCAUX.includes(hote(config.baseUrl));
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Refuser', 'Autoriser'],
    defaultId: 0,
    cancelId: 0,
    title: 'Fichier sensible',
    message: `Le chat veut lire ${chemin}, un fichier qui contient souvent des secrets (mots de passe, clés API).`,
    detail: local
      ? 'Le modèle tourne sur ton PC : le contenu reste chez toi.'
      : `Le modèle est en ligne : le contenu partira sur les serveurs de ${config.nom}.`,
  });
  return response === 1;
}

// max : 300 pour la liste donnée au modèle, plus pour une recherche qui doit fouiller tout le projet
function listFiles(dir, prefix = '', out = [], max = 300) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED.has(entry.name) || out.length >= max) continue;
    const rel = prefix + entry.name;
    if (entry.isDirectory()) {
      out.push(rel + '/');
      listFiles(path.join(dir, entry.name), rel + '/', out, max);
    } else out.push(rel);
  }
  return out;
}

// Cherche un texte (ou une expression régulière) dans les fichiers du projet : une ligne « fichier:ligne: extrait »
// par résultat. Mêmes protections que lire_fichier : chemins vérifiés, fichiers sensibles jamais fouillés,
// fichiers binaires et trop gros ignorés.
const MAX_RESULTATS = 50;
const MAX_FICHIERS_FOUILLES = 3000;

function chercherDansProjet(texte, { regex = false, dossier = '' } = {}) {
  const motif = String(texte ?? '');
  if (!motif) return 'Donne le texte à chercher.';
  let correspond;
  if (regex) {
    if (motif.length > 200) return 'Expression régulière trop longue (200 caractères au plus) : simplifie-la.';
    let expression;
    try {
      expression = new RegExp(motif, 'i');
    } catch (err) {
      return `Expression régulière invalide (${err.message}). Corrige-la, ou cherche un texte simple sans regex.`;
    }
    // Lignes coupées à 1 000 caractères : une regex mal écrite sur une ligne de code minifié pourrait bloquer l'app
    correspond = (ligne) => expression.test(ligne.slice(0, 1000));
  } else {
    const minuscules = motif.toLowerCase();
    correspond = (ligne) => ligne.toLowerCase().includes(minuscules);
  }

  const sousDossier = String(dossier || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const base = safePath(sousDossier);
  if (!fs.statSync(base).isDirectory()) return `${sousDossier} n'est pas un dossier. Pour un seul fichier, utilise lire_fichier.`;

  const resultats = [];
  let sensibles = 0;
  for (const rel of listFiles(base, '', [], MAX_FICHIERS_FOUILLES)) {
    if (rel.endsWith('/')) continue;
    const relatif = sousDossier ? `${sousDossier}/${rel}` : rel;
    if (estSensible(relatif)) { sensibles++; continue; }
    let full;
    try {
      full = safePath(relatif);
    } catch {
      continue; // lien qui mène hors du projet
    }
    const stat = fs.statSync(full);
    if (!stat.isFile() || stat.size > MAX_FILE) continue;
    const contenu = fs.readFileSync(full, 'utf8');
    if (contenu.includes('\u0000')) continue; // binaire
    const lignes = contenu.split(/\r?\n/);
    for (let i = 0; i < lignes.length && resultats.length <= MAX_RESULTATS; i++) {
      if (correspond(lignes[i])) resultats.push(`${relatif}:${i + 1}: ${lignes[i].trim().slice(0, 200)}`);
    }
    if (resultats.length > MAX_RESULTATS) break;
  }

  const ou = sousDossier ? ` dans ${sousDossier}` : '';
  const noteSensibles = sensibles ? `\n(${sensibles} fichier${sensibles > 1 ? 's' : ''} sensible${sensibles > 1 ? 's' : ''}, comme .env, non fouillé${sensibles > 1 ? 's' : ''})` : '';
  if (!resultats.length) return `Aucun résultat pour « ${motif} »${ou}.${noteSensibles}`;
  const trop = resultats.length > MAX_RESULTATS;
  const lignes = resultats.slice(0, MAX_RESULTATS).join('\n');
  return lignes + (trop ? `\n… et d'autres résultats : précise ta recherche (un texte plus long, ou un sous-dossier).` : '') + noteSensibles;
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'ouvrir_dossier',
      description: "Ouvre un dossier de l'ordinateur comme projet, avec son chemin complet (ex : C:\\Users\\moi\\Documents\\portfolio). À utiliser quand l'utilisateur parle d'un dossier ou d'un projet. L'utilisateur doit confirmer.",
      parameters: { type: 'object', properties: { chemin: { type: 'string', description: 'Chemin complet du dossier' } }, required: ['chemin'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lister_fichiers',
      description: 'Liste les fichiers du dossier projet ouvert (ou d\'un sous-dossier).',
      parameters: { type: 'object', properties: { dossier: { type: 'string', description: 'Sous-dossier relatif, vide pour la racine' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lire_fichier',
      description: 'Lit le contenu d\'un fichier du projet.',
      parameters: { type: 'object', properties: { chemin: { type: 'string', description: 'Chemin relatif au projet' } }, required: ['chemin'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'chercher',
      description: "Cherche un texte dans tous les fichiers du projet (ou d'un sous-dossier) et renvoie chaque ligne trouvée sous la forme fichier:ligne: extrait. À utiliser pour trouver où une fonction, une variable ou un message est défini ou utilisé, au lieu de lire les fichiers un par un. Majuscules et minuscules sont confondues.",
      parameters: {
        type: 'object',
        properties: {
          texte: { type: 'string', description: 'Texte à chercher (ou expression régulière si regex vaut true)' },
          regex: { type: 'boolean', description: 'true si texte est une expression régulière' },
          dossier: { type: 'string', description: 'Sous-dossier relatif où chercher, vide pour tout le projet' },
        },
        required: ['texte'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ecrire_fichier',
      description: "Crée un fichier, ou remplace un fichier entier avec le contenu COMPLET donné. Pour modifier une partie d'un fichier existant, utilise plutôt remplacer_texte. L'utilisateur doit confirmer.",
      parameters: {
        type: 'object',
        properties: {
          chemin: { type: 'string', description: 'Chemin relatif au projet' },
          contenu: { type: 'string', description: 'Contenu complet du fichier' },
        },
        required: ['chemin', 'contenu'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remplacer_texte',
      description: "Modifie un passage d'un fichier existant du projet : remplace ancien_texte par nouveau_texte. ancien_texte doit être copié EXACTEMENT depuis le fichier (espaces et retours à la ligne compris) et apparaître une seule fois : prends quelques lignes autour si besoin. Pour renommer quelque chose partout dans le fichier : ancien_texte = SEULEMENT l'ancien nom (ex : calculer), nouveau_texte = le nouveau nom, et remplacer_partout à true. C'est la bonne façon de corriger ou modifier un fichier. L'utilisateur doit confirmer.",
      parameters: {
        type: 'object',
        properties: {
          chemin: { type: 'string', description: 'Chemin relatif au projet' },
          ancien_texte: { type: 'string', description: 'Passage actuel, copié exactement depuis le fichier' },
          nouveau_texte: { type: 'string', description: 'Ce qui le remplace (vide pour le supprimer)' },
          remplacer_partout: { type: 'boolean', description: 'true pour remplacer toutes les occurrences (renommage) ; sinon ancien_texte doit être unique' },
        },
        required: ['chemin', 'ancien_texte', 'nouveau_texte'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memoriser',
      description: "Enregistre un fait durable sur l'utilisateur ou ses projets (préférences, technos, objectifs) pour s'en souvenir dans les prochaines discussions.",
      parameters: { type: 'object', properties: { fait: { type: 'string', description: 'Le fait à retenir, en une phrase' } }, required: ['fait'] },
    },
  },
];

// En mode prof, le chat n'a pas le droit d'écrire : il explique, l’utilisateur code.
// Les rôles (consignes dans renderer.js) : le relecteur n'écrit rien, le rédacteur README n'écrit que des .md.
// mode = { prof, role, fournisseurId }
const OUTILS_ECRITURE = new Set(['ecrire_fichier', 'remplacer_texte']);
const peutEcrire = ({ prof, role } = {}) => !prof && role !== 'relecteur';
const outilsPour = (mode) => (peutEcrire(mode) ? TOOLS : TOOLS.filter((t) => !OUTILS_ECRITURE.has(t.function.name)));

// Les petits modèles annoncent parfois une modification qui n'a pas eu lieu : chaque refus le dit clairement
const RIEN_N_A_CHANGE = " Le fichier n'a pas changé : ne dis pas à l’utilisateur qu'il est modifié.";

// Renvoie la raison du refus, ou rien si l'écriture est permise
function ecritureRefusee({ prof, role } = {}, chemin) {
  if (prof) return "Mode prof activé : tu n'as pas le droit d'écrire de fichier. Explique à l’utilisateur ce qu'il doit faire et laisse-le coder." + RIEN_N_A_CHANGE;
  if (role === 'relecteur') return "Rôle relecteur : tu ne modifies aucun fichier. Liste les problèmes à l’utilisateur, il choisira quoi corriger." + RIEN_N_A_CHANGE;
  if (role === 'readme' && !/\.md$/i.test(String(chemin || ''))) return "Rôle rédacteur README : tu n'écris que des fichiers Markdown (.md), jamais de code. Dis à l’utilisateur que modifier ce fichier n'est pas ton rôle, et qu'il peut passer en Généraliste ou en Débogueur pour ça. Ne fais rien d'autre à la place." + RIEN_N_A_CHANGE;
}

// Remplace le passage `ancien` de `contenu` par `nouveau`. Renvoie { contenu, fois } ou { erreur } pour le modèle.
// Par défaut, l'ancien texte doit apparaître exactement une fois : s'il apparaît plusieurs fois, on ne devine pas
// lequel modifier. Avec partout (renommage), toutes les occurrences sont remplacées : L’utilisateur les voit toutes dans l'avant / après.
// Pas de String.replace : il interprète $& ou $1 dans le nouveau texte, fréquents dans du code (PHP, regex…).
function remplacerTexte(contenu, ancien, nouveau, partout = false) {
  if (!ancien) return { erreur: 'ancien_texte est vide : copie le passage à modifier depuis le fichier.' };
  // qwen3 « échappe deux fois » : il envoie les deux caractères \ et n au lieu d'un vrai retour à la ligne.
  // On essaie d'abord le passage tel quel (un vrai "\n" dans du code doit rester trouvable), puis déséchappé.
  const essais = [[ancien, nouveau]];
  if (/\\[nrt"\\]/.test(ancien)) essais.push([desechapper(ancien), desechapper(nouveau)]);
  for (let [a, n] of essais) {
    // Fichier Windows (fins de ligne \r\n) mais passage écrit avec de simples \n : on s'aligne sur le fichier
    if (contenu.includes('\r\n') && !a.includes('\r\n')) {
      a = a.replace(/\n/g, '\r\n');
      n = n.replace(/\r?\n/g, '\r\n');
    }
    const morceaux = contenu.split(a);
    const fois = morceaux.length - 1;
    if (!fois) continue;
    if (fois > 1 && !partout) return { erreur: `ancien_texte apparaît ${fois} fois dans le fichier : ajoute quelques lignes autour pour qu'il n'apparaisse qu'une fois, ou mets remplacer_partout à true pour tout remplacer.` + RIEN_N_A_CHANGE };
    return { contenu: morceaux.join(n), fois };
  }
  return { erreur: "ancien_texte est introuvable dans le fichier. Relis-le avec lire_fichier et copie le passage exactement, espaces et retours à la ligne compris (de vrais retours à la ligne, pas \\n)." + RIEN_N_A_CHANGE };
}

const desechapper = (texte) => texte.replace(/\\([nrt"\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' })[c]);

async function runTool(name, args, mode) {
  if (OUTILS_ECRITURE.has(name)) {
    const refus = ecritureRefusee(mode, args.chemin);
    if (refus) return refus;
  }
  switch (name) {
    case 'ouvrir_dossier': {
      const full = path.resolve(String(args.chemin || ''));
      if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) return `Le dossier ${full} n'existe pas. Demande le bon chemin à l'utilisateur.`;
      const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Autoriser', 'Refuser'],
        defaultId: 0,
        cancelId: 1,
        title: 'Ouvrir un dossier',
        message: `L'IA veut accéder au dossier :\n${full}`,
        detail: "Elle pourra lire ses fichiers. Pour chaque modification, elle te redemandera.",
      });
      if (response !== 0) return "L'utilisateur a refusé l'accès à ce dossier.";
      setProject(full);
      return `Dossier ouvert : ${full}\nFichiers :\n${listFiles(full).join('\n')}`;
    }
    case 'lister_fichiers': {
      const files = listFiles(safePath(args.dossier));
      return files.length ? files.join('\n') : '(dossier vide)';
    }
    case 'lire_fichier': {
      const full = safePath(args.chemin);
      const size = fs.statSync(full).size;
      if (size > MAX_FILE) return `Fichier trop gros (${Math.round(size / 1024)} Ko), lecture refusée.`;
      if (estSensible(full) && !(await accordLectureSensible(args.chemin, mode.fournisseurId))) {
        return `L’utilisateur a refusé la lecture de ${args.chemin} : ce fichier peut contenir des secrets. Fais sans, ou demande-lui l'information dont tu as besoin.`;
      }
      return fs.readFileSync(full, 'utf8');
    }
    case 'chercher': {
      return chercherDansProjet(args.texte, { regex: args.regex === true || args.regex === 'true', dossier: args.dossier });
    }
    case 'ecrire_fichier': {
      return ecrireAvecAccord(args.chemin, String(args.contenu ?? ''));
    }
    case 'remplacer_texte': {
      const full = safePath(args.chemin);
      if (!fs.existsSync(full)) return `Le fichier ${args.chemin} n'existe pas. Pour créer un fichier, utilise ecrire_fichier.`;
      if (fs.statSync(full).size > MAX_FILE) return 'Fichier trop gros pour être modifié par le chat.' + RIEN_N_A_CHANGE;
      const partout = args.remplacer_partout === true || args.remplacer_partout === 'true';
      const resultat = remplacerTexte(fs.readFileSync(full, 'utf8'), String(args.ancien_texte ?? ''), String(args.nouveau_texte ?? ''), partout);
      if (resultat.erreur) return resultat.erreur;
      const reponse = await ecrireAvecAccord(args.chemin, resultat.contenu);
      // Le nombre de passages changés aide à repérer un renommage incomplet. Pas de consigne ici :
      // qwen3 recopie parfois la réponse de l'outil telle quelle à l’utilisateur.
      if (!reponse.startsWith('Fichier modifié') || !partout) return reponse;
      return `${reponse} (${resultat.fois} remplacement${resultat.fois > 1 ? 's' : ''})`;
    }
    case 'memoriser': {
      const memory = readJson('memory.json', []);
      memory.push(String(args.fait));
      writeJson('memory.json', memory);
      win.webContents.send('memory-changed', memory);
      return 'Mémorisé.';
    }
    default:
      return `Outil inconnu : ${name}`;
  }
}

// Toute écriture passe par la fenêtre avant / après de l'interface (renderer.js),
// qui répond par 'confirm-write-reply'
const REFUS_ECRITURE = "L'utilisateur a refusé la modification.";

// Pour le modèle seulement : le bouton Enregistrer des blocs de code affiche le message de writeWithConfirm à l’utilisateur
async function ecrireAvecAccord(chemin, contenu) {
  const resultat = await writeWithConfirm(chemin, contenu);
  return resultat === REFUS_ECRITURE ? resultat + RIEN_N_A_CHANGE : resultat;
}

const confirmations = new Map();
let prochaineConfirmation = 1;

ipcMain.on('confirm-write-reply', (_e, { id, ok }) => {
  confirmations.get(id)?.(ok);
  confirmations.delete(id);
});

function demanderConfirmation(infos) {
  const id = prochaineConfirmation++;
  return new Promise((resolve) => {
    confirmations.set(id, resolve);
    win.webContents.send('confirm-write', { id, ...infos });
  });
}

async function writeWithConfirm(chemin, contenu) {
  const full = safePath(chemin);
  const exists = fs.existsSync(full);
  let ancien = '';
  if (exists) {
    if (fs.statSync(full).size > MAX_FILE) return 'Fichier existant trop gros pour être remplacé par le chat.';
    ancien = fs.readFileSync(full, 'utf8');
  }
  const ok = await demanderConfirmation({ chemin: full, ancien, nouveau: contenu, existe: exists });
  if (!ok) return REFUS_ECRITURE;
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contenu);
  return `Fichier ${exists ? 'modifié' : 'créé'} : ${chemin}`;
}

// Bouton "Enregistrer" sur un bloc de code
ipcMain.handle('save-code', async (_e, { chemin, contenu }) => {
  try {
    return { ok: true, message: await writeWithConfirm(chemin, contenu) };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

// ---------- Discussion avec Ollama ----------
// Envoie la discussion à Ollama et lit la réponse en streaming (JSON ligne par ligne).
// onMorceau(texte) est appelé pour chaque morceau de texte reçu ; signal permet le bouton stop.
// options.prof / options.role : mode prof et rôle, qui décident si l'outil d'écriture est proposé au modèle.
// Renvoie { content, toolCalls } : le texte complet et les appels d'outils demandés.
async function envoyerOllama(messages, modele, onMorceau, signal, options = {}) {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    // think: false : qwen3 répond direct au lieu d'écrire une longue réflexion avant
    body: JSON.stringify({ model: modele, messages, tools: outilsPour(options), stream: true, think: modele.startsWith('qwen3') ? false : undefined, options: { num_ctx: 8192 } }),
    signal,
  });
  if (!res.ok) throw new Error(`Ollama a répondu ${res.status}`);
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const toolCalls = [];
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const data = JSON.parse(line);
      if (data.message?.content) {
        content += data.message.content;
        onMorceau(data.message.content);
      }
      if (data.message?.tool_calls) toolCalls.push(...data.message.tool_calls);
    }
  }
  return { content, toolCalls };
}

// ---------- Discussion avec un fournisseur compatible OpenAI (Gemini, Groq, OpenRouter…) ----------
// Même code pour tous : seule config.baseUrl change. config = { nom, baseUrl, cle }.
// Mêmes paramètres et même retour qu'envoyerOllama, pour que la boucle du handler 'chat' ne change pas.
// Gemini 3 réfléchit longtemps avant de répondre (plus de 2 min parfois, sans rien afficher) :
// on lui demande de réfléchir peu. Seulement pour Gemini, les autres fournisseurs n'en ont pas besoin.
const REFLEXION = { gemini: 'low' };

// Longueur maximale d'une réponse. Sans elle, OpenRouter réserve la longueur maximale du modèle
// (64 000 tokens) et refuse si le crédit de la clé ne couvre pas ce maximum.
const LONGUEUR_MAX = { openrouter: 4096 };

async function envoyerOpenAI(config, messages, modele, onMorceau, signal, options = {}) {
  const corps = { model: modele, messages: versOpenAI(messages), tools: outilsPour(options), stream: true };
  if (REFLEXION[config.id]) corps.reasoning_effort = REFLEXION[config.id];
  if (LONGUEUR_MAX[config.id]) corps.max_tokens = LONGUEUR_MAX[config.id];
  const limites = limitesTaille(config);
  if (limites?.reponse) corps.max_tokens = limites.reponse;
  const envoyer = (body) => fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.cle}`,
      'X-Title': 'Le chat noir', // OpenRouter affiche ce nom dans ses statistiques
    },
    body: JSON.stringify(body),
    signal,
  });
  let res;
  try {
    res = await envoyer(corps);
    // Un modèle qui ne connaît pas ce réglage répond 400 : on renvoie la même demande sans lui
    if (res.status === 400 && corps.reasoning_effort && /reasoning|thinking/i.test(await res.clone().text())) {
      delete corps.reasoning_effort;
      res = await envoyer(corps);
    }
    // Limite par minute atteinte (429) avec une attente courte : on patiente et on réessaie, deux fois au plus
    for (let essai = 0; essai < 2 && res.status === 429; essai++) {
      const secondes = await attenteDemandee(res);
      if (secondes === null || secondes > 60) break; // quota du jour épuisé ou attente trop longue : on affiche l'erreur
      options.onPause?.(Math.ceil(secondes));
      await attendre(secondes * 1000 + 500, signal);
      res = await envoyer(corps);
    }
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error(`Impossible de joindre ${config.nom} (${config.baseUrl}). Vérifie ta connexion internet et l'adresse du fournisseur.`);
  }
  if (!res.ok) {
    const erreur = new Error(await messageErreurOpenAI(config, res));
    // Le fournisseur dit que ce modèle n'existe plus (ou n'est pas utilisable) : le handler le retirera de la liste
    erreur.modeleCasse = estModeleCasse(res.status, erreur.message);
    throw erreur;
  }

  // Le flux arrive en SSE : des lignes "data: {...}" jusqu'à "data: [DONE]"
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const appels = []; // les appels d'outils arrivent en morceaux, rangés par index
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const ligne = line.trim();
      if (!ligne.startsWith('data:')) continue;
      const donnees = ligne.slice(5).trim();
      if (donnees === '[DONE]') return { content, toolCalls: finirAppels(appels) };
      let data;
      try {
        data = JSON.parse(donnees);
      } catch {
        continue; // ligne incomplète ou commentaire du serveur
      }
      if (data.error) throw new Error(`${config.nom} a renvoyé une erreur : ${data.error.message || JSON.stringify(data.error)}`);
      const delta = data.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        content += delta.content;
        onMorceau(delta.content);
      }
      for (const morceau of delta.tool_calls || []) {
        const appel = (appels[morceau.index ?? appels.length] ??= { id: '', name: '', arguments: '' });
        if (morceau.id) appel.id = morceau.id;
        if (morceau.function?.name) appel.name += morceau.function.name;
        if (morceau.function?.arguments) appel.arguments += morceau.function.arguments;
      }
    }
  }
  return { content, toolCalls: finirAppels(appels) };
}

// Combien de secondes le fournisseur demande d'attendre après un 429 : en-tête Retry-After,
// sinon le texte de l'erreur (« Please try again in 12.5s » chez Groq). null si rien n'est précisé.
async function attenteDemandee(res) {
  const entete = Number(res.headers.get('retry-after'));
  if (entete > 0) return entete;
  const texte = await res.clone().text().catch(() => '');
  const m = texte.match(/try again in\s+(?:(\d+)m)?\s*([\d.]+)\s*(ms|s)\b/i);
  if (!m) return null;
  return (Number(m[1]) || 0) * 60 + (m[3] === 'ms' ? Number(m[2]) / 1000 : Number(m[2]));
}

// Attente qui s'arrête tout de suite si l’utilisateur clique sur Stop
function attendre(ms, signal) {
  return new Promise((resolve, reject) => {
    const minuterie = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(minuterie); reject(Object.assign(new Error('Arrêté'), { name: 'AbortError' })); }, { once: true });
  });
}

// Appels d'outils OpenAI (arguments en texte JSON) → format Ollama utilisé par le reste du code (arguments en objet)
function finirAppels(appels) {
  return appels.filter(Boolean).map((a, i) => {
    let args = {};
    try {
      args = a.arguments ? JSON.parse(a.arguments) : {};
    } catch {}
    return { id: a.id || `appel_${i}`, function: { name: a.name, arguments: args } };
  });
}

// Historique au format Ollama → format OpenAI : les arguments deviennent du texte JSON,
// et chaque résultat d'outil est relié à son appel par tool_call_id
function versOpenAI(messages) {
  const enAttente = [];
  return messages.map((m) => {
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const tool_calls = m.tool_calls.map((c, i) => {
        const id = c.id || `appel_${Date.now()}_${i}`;
        enAttente.push(id);
        const args = c.function.arguments;
        return { id, type: 'function', function: { name: c.function.name, arguments: typeof args === 'string' ? args : JSON.stringify(args || {}) } };
      });
      return { role: 'assistant', content: m.content || null, tool_calls };
    }
    if (m.role === 'tool') {
      // Résultat déjà relié : on retire son appel de la file ; sinon on prend le plus ancien appel sans réponse
      const position = m.tool_call_id ? enAttente.indexOf(m.tool_call_id) : 0;
      const [id] = position >= 0 ? enAttente.splice(position, 1) : [];
      return { role: 'tool', tool_call_id: m.tool_call_id || id || 'appel_inconnu', content: m.content };
    }
    return { role: m.role, content: m.content };
  });
}

// "Ce modèle n'existe plus" selon les fournisseurs : Gemini (404 « no longer available »),
// Groq (400 « decommissioned », 404 « does not exist »), OpenRouter (404 « No endpoints found », 400 « not a valid model »).
// Jamais pour un problème de clé ou de limite.
function estModeleCasse(status, message) {
  if (status !== 400 && status !== 404) return false;
  if (/refuse la clé/i.test(message)) return false;
  // "not found" seul ne suffit pas (une mauvaise adresse répond aussi 404 Not Found) : il faut que le message parle du modèle
  return /no longer available|decommission|deprecated|does not exist|no endpoints|not a valid model|is not enabled|requires terms acceptance|model[^.\n]*(not found|not supported|unsupported|not available)|(not found|not supported|unsupported)[^.\n]*model/i.test(message);
}

// Message clair en français selon le code d'erreur HTTP, avec le détail donné par le fournisseur
async function messageErreurOpenAI(config, res) {
  let detail = '';
  try {
    const texte = await res.text();
    try {
      const json = JSON.parse(texte);
      detail = (Array.isArray(json) ? json[0] : json)?.error?.message || texte;
    } catch {
      detail = texte;
    }
  } catch {}
  detail = detail.trim().slice(0, 300);
  const suite = detail ? `\nDétail : ${detail}` : '';
  // Gemini répond 400 (et pas 401) quand la clé est fausse : on le reconnaît à son message
  const cleInvalide = res.status === 400 && /api[ _-]?key|API_KEY_INVALID/i.test(detail);
  // OpenRouter répond 403 « Key limit exceeded » quand la limite de crédit fixée sur la clé est atteinte :
  // la clé marche, c'est son budget qui est épuisé
  if (res.status === 403 && /limit exceeded|credit|insufficient/i.test(detail)) return `${config.nom} : la limite de crédit de cette clé est atteinte (${res.status}). La clé marche, mais son budget est épuisé : augmente la limite sur le site de ${config.nom}, ou choisis un modèle gratuit (« :free »).${suite}`;
  if (res.status === 402) return `${config.nom} : plus assez de crédit sur ton compte (402). Ajoute du crédit, ou choisis un modèle gratuit (« :free »).${suite}`;
  if (res.status === 401 || res.status === 403 || cleInvalide) return `${config.nom} refuse la clé API (${res.status}). Vérifie la clé dans le panneau Fournisseurs.${suite}`;
  if (res.status === 429) return `Limite atteinte chez ${config.nom} (429) : trop de messages d'un coup ou quota gratuit épuisé. Attends un peu, ou change de modèle.${suite}`;
  if (res.status === 404) return `${config.nom} ne trouve pas ce modèle ou cette adresse (404). Vérifie le modèle choisi.${suite}`;
  if (res.status >= 500) return `${config.nom} a un problème de son côté (${res.status}). Ce n'est pas toi : réessaie dans quelques minutes.${suite}`;
  return `${config.nom} a répondu ${res.status}.${suite}`;
}

// Qwen-Coder écrit souvent ses appels d'outils en JSON dans le texte au lieu de vrais appels :
// on cherche chaque objet {"name": ..., "arguments": ...} n'importe où dans la réponse
function parseTextToolCalls(content) {
  const names = new Set(TOOLS.map((t) => t.function.name));
  const calls = [];
  let i = content.indexOf('{');
  while (i !== -1) {
    const end = matchingBrace(content, i);
    if (end === -1) break;
    try {
      const obj = JSON.parse(content.slice(i, end + 1));
      const args = typeof obj.arguments === 'string' ? JSON.parse(obj.arguments) : obj.arguments || obj.parameters || {};
      if (names.has(obj.name)) {
        calls.push({ function: { name: obj.name, arguments: args } });
        i = content.indexOf('{', end + 1);
        continue;
      }
    } catch {}
    i = content.indexOf('{', i + 1);
  }
  return calls;
}

// Trouve l'accolade fermante correspondante en ignorant celles dans les chaînes
function matchingBrace(s, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

// La bonne fonction d'envoi selon le fournisseur ; la clé est lue ici, jamais reçue de l'interface
function envoyeurPour(fournisseurId) {
  const config = configFournisseur(fournisseurId);
  if (!config) throw new Error('Fournisseur inconnu. Choisis-en un dans la liste.');
  if (config.type === 'ollama') return envoyerOllama;
  if (!config.baseUrl) throw new Error(`Aucune adresse pour ${config.nom} : remplis-la dans le panneau Fournisseurs.`);
  if (!config.cle) throw new Error(`Aucune clé API pour ${config.nom} : ajoute-la dans le panneau Fournisseurs.`);
  return (...args) => envoyerOpenAI(config, ...args);
}

// Dernier garde-fou avant d'envoyer : jamais de modèle payant là où seuls les gratuits sont autorisés
function verifierGratuit(fournisseurId, modele) {
  const config = configFournisseur(fournisseurId);
  if (!config) throw new Error('Fournisseur inconnu : rien n\'a été envoyé.');
  if (!modeleGratuit(config, modele)) {
    throw new Error(`${modele} n'est pas gratuit chez ${config.nom} : rien n'a été envoyé. ${conseilGratuit(config)}`);
  }
}

ipcMain.on('chat', async (event, { id, model, messages, prof, role, fournisseurId = 'ollama' }) => {
  const controller = new AbortController();
  controllers.set(id, controller);
  const history = [...messages];
  let nudged = false;
  const onMorceau = (text) => event.sender.send('chat-chunk', { id, text });
  try {
    verifierGratuit(fournisseurId, model);
    const envoyer = envoyeurPour(fournisseurId);
    // Fournisseur avec une petite limite de taille (Groq gratuit) : chaque envoi est allégé
    const limites = limitesTaille(configFournisseur(fournisseurId));
    for (let step = 0; step < MAX_STEPS; step++) {
      const aEnvoyer = limites ? compacter(history, limites.total) : history;
      // onPause : affiche une étiquette pendant que l'app attend la fin de la limite par minute
      const onPause = (secondes) => event.sender.send('chat-tool', { id, name: 'pause', args: { secondes } });
      let { content, toolCalls } = await envoyer(aEnvoyer, model, onMorceau, controller.signal, { prof, role, onPause });
      if (!toolCalls.length && content.includes('"name"')) {
        const parsed = parseTextToolCalls(content);
        if (parsed.length) {
          event.sender.send('chat-undo', { id, length: content.length });
          toolCalls = parsed;
          content = '';
        }
      }
      history.push({ role: 'assistant', content, tool_calls: toolCalls.length ? toolCalls : undefined });
      // Les petits modèles annoncent souvent une action sans la faire : on les relance une fois
      if (!toolCalls.length && !nudged && /je vais (ouvrir|regarder|lire|lister|consulter|jeter|écrire|créer|modifier)/i.test(content)) {
        nudged = true;
        history.push({ role: 'user', content: "Vas-y, utilise l'outil maintenant au lieu de l'annoncer." });
        event.sender.send('chat-chunk', { id, text: '\n\n' });
        continue;
      }
      if (!toolCalls.length) break;
      for (const call of toolCalls) {
        const { name, arguments: args } = call.function;
        // Les étiquettes montrent seulement le chemin, pas les gros textes
        event.sender.send('chat-tool', { id, name, args: { ...args, contenu: undefined, ancien_texte: undefined, nouveau_texte: undefined } });
        // Écriture refusée par le mode prof ou le rôle : L’utilisateur le voit, même si le modèle prétend le contraire
        if (OUTILS_ECRITURE.has(name) && ecritureRefusee({ prof, role }, args?.chemin)) {
          event.sender.send('chat-tool', { id, name: 'refus', args: { chemin: args.chemin } });
        }
        let result;
        try {
          result = await runTool(name, args || {}, { prof, role, fournisseurId });
        } catch (err) {
          result = `Erreur : ${err.message}`;
        }
        // tool_name sert à Ollama, tool_call_id aux fournisseurs OpenAI (chacun ignore l'autre)
        const texte = limites ? raccourcir(String(result), limites.resultatOutil) : String(result);
        history.push({ role: 'tool', content: texte, tool_name: name, tool_call_id: call.id });
      }
    }
    event.sender.send('chat-done', { id });
  } catch (err) {
    if (err.name === 'AbortError') event.sender.send('chat-done', { id });
    else {
      if (err.modeleCasse) marquerModeleCasse(fournisseurId, model);
      event.sender.send('chat-error', { id, error: err.message, modeleCasse: err.modeleCasse ? model : null });
    }
  } finally {
    controllers.delete(id);
  }
});

ipcMain.on('chat-stop', (_e, id) => {
  controllers.get(id)?.abort();
  // Si une fenêtre avant / après attendait, on la considère comme refusée
  confirmations.forEach((resolve) => resolve(false));
  confirmations.clear();
  win.webContents.send('confirm-write-cancel');
});

// Résume le début d'une longue discussion, pour que le modèle ne l'oublie pas
ipcMain.handle('summarize', async (_e, { model, messages, ancienResume, fournisseurId = 'ollama' }) => {
  const texte = messages.map((m) => `${m.role === 'user' ? 'L’utilisateur' : 'Le chat'} : ${m.content}`).join('\n\n');
  const consigne = `Résume cette discussion entre l’utilisateur et son assistant en 10 lignes maximum, en français.
Garde : ce que l’utilisateur veut faire, les décisions prises, les fichiers et noms importants, ce qui reste à faire. Pas de blabla.
${ancienResume ? `\nRésumé de ce qui s'est passé encore avant :\n${ancienResume}\n` : ''}
Discussion :
${texte}`;
  const config = configFournisseur(fournisseurId);
  if (!modeleGratuit(config, model)) return null; // pas de résumé payant
  try {
    if (!config || config.type === 'ollama') {
      const res = await fetch(`${OLLAMA}/api/chat`, {
        method: 'POST',
        body: JSON.stringify({ model, messages: [{ role: 'user', content: consigne }], stream: false, think: model.startsWith('qwen3') ? false : undefined, options: { num_ctx: 8192 } }),
      });
      const data = await res.json();
      return data.message?.content?.trim() || null;
    }
    // Fournisseur en ligne : même requête, sans streaming et sans outils
    const res = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.cle}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: consigne }], stream: false, reasoning_effort: REFLEXION[config.id] }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return null; // y compris si le réglage de réflexion est refusé : le résumé est facultatif
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.replace(/<think>[\s\S]*?<\/think>/g, '').trim() || null;
  } catch {
    return null;
  }
});

// Fichier glissé dans la fenêtre : on lit son texte (le chemin vient de preload.js)
ipcMain.handle('read-dropped', (_e, chemin) => {
  try {
    const stat = fs.statSync(chemin);
    if (stat.isDirectory()) return { dossier: true, chemin };
    if (stat.size > MAX_FILE) return { erreur: `${path.basename(chemin)} est trop gros (${Math.round(stat.size / 1024)} Ko, max 100 Ko).` };
    const contenu = fs.readFileSync(chemin, 'utf8');
    if (contenu.includes('\u0000')) return { erreur: `${path.basename(chemin)} n'est pas un fichier texte.` };
    return { nom: path.basename(chemin), chemin, contenu };
  } catch (err) {
    return { erreur: err.message };
  }
});

// ---------- Liste des modèles ----------
// Modèles qui ne savent pas discuter (embeddings, voix, images, vidéo, modération…) : jamais proposés
const NE_DISCUTE_PAS = /embed|tts|whisper|transcri|speech|audio|realtime|live|imagen|image|veo|lyria|aqa|guard|moderation|robotics|computer-use|orpheus|playai|allam/i;

// Seuls les modèles gratuits sont autorisés : rien ne doit jamais être facturé.
// On regarde l'adresse du fournisseur, pas son identifiant : le Personnalisé peut pointer vers OpenRouter ou Gemini.
function hote(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

// ---------- Taille des messages ----------
// L'offre gratuite de Groq accepte 8 000 tokens par minute, réponse comprise (et 1 000 tokens de réponse
// pour certains modèles). Un seul fichier lu peut dépasser ça : on garde chaque envoi sous ces limites.
// 1 token ≈ 3 caractères pour du code : 18 000 caractères + les outils + 1 000 tokens de réponse < 8 000 tokens.
// Une réponse peut demander plusieurs envois dans la même minute (un par fichier lu) : chaque envoi reste petit.
const LIMITES_TAILLE = {
  'api.groq.com': { total: 12000, resultatOutil: 4000, reponse: 1000 },
};
const limitesTaille = (config) => (config?.baseUrl ? LIMITES_TAILLE[hote(config.baseUrl)] : null) || null;

const taille = (m) => (m.content || '').length + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);
const NOTE_RACCOURCI = '\n[… raccourci pour rester sous la limite du fournisseur. Relis le fichier avec lire_fichier si tu as besoin de la suite.]';

function raccourcir(texte, max) {
  return texte.length > max ? texte.slice(0, max) + NOTE_RACCOURCI : texte;
}

// Ramène l'historique sous `total` caractères, sans casser le lien entre un appel d'outil et son résultat :
// 1. on raccourcit les résultats d'outils, du plus ancien au plus récent ;
// 2. puis on retire les plus vieux échanges (un message de l’utilisateur, ou une réponse avec ses résultats d'outils),
//    en gardant toujours les consignes du début et le dernier message de l’utilisateur avec ce qui le suit.
function compacter(messages, total) {
  const liste = messages.map((m) => ({ ...m }));
  const somme = () => liste.reduce((n, m) => n + taille(m), 0);
  // Les consignes (avec le contenu des fichiers cités) ne prennent jamais plus de la moitié
  if (liste[0]?.role === 'system') liste[0].content = raccourcir(liste[0].content, total / 2);
  for (const m of liste) {
    if (somme() <= total) return liste;
    if (m.role === 'tool' && m.content.length > 800) m.content = raccourcir(m.content, 800);
  }
  // Les messages système du début (consignes, résumé de la discussion) restent toujours
  let debut = 0;
  while (liste[debut]?.role === 'system') debut++;
  while (somme() > total) {
    const dernierUtilisateur = liste.map((m) => m.role).lastIndexOf('user');
    // Un échange = un message, plus les résultats d'outils qui suivent une réponse avec appels
    let fin = debut + 1;
    while (fin < liste.length && liste[fin].role === 'tool') fin++;
    if (fin > dernierUtilisateur) break; // il ne reste que le message en cours : on ne peut plus rien retirer
    liste.splice(debut, fin - debut);
  }
  // Encore trop gros (gros fichier joint, beaucoup de fichiers lus) : on raccourcit le message en cours
  if (somme() > total) {
    for (const m of liste.slice(debut)) {
      if (m.role === 'tool' && m.content.length > 300) m.content = raccourcir(m.content, 300);
      if (m.role === 'user' && m.content.length > total / 3) m.content = raccourcir(m.content, total / 3);
    }
  }
  return liste;
}

// Liste blanche : tout ce qui n'est pas dedans est refusé, même si on ne sait pas que c'est payant.
// - Ollama et les serveurs sur ton PC (LM Studio…) : gratuits.
// - Groq : tout est dans l'offre gratuite.
// - OpenRouter : seulement les « :free », les autres sont facturés sur le crédit du compte.
// - Gemini : seulement les « flash » (sans « image »), les seuls de l'offre gratuite.
// - Toute autre adresse (OpenAI, Anthropic, Mistral…) : refusée, ces services sont payants.
const HOTES_LOCAUX = ['localhost', '127.0.0.1', '[::1]'];

function fournisseurGratuit(baseUrl) {
  const h = hote(baseUrl);
  return HOTES_LOCAUX.includes(h) || h === 'api.groq.com' || h === 'openrouter.ai' || h === 'generativelanguage.googleapis.com';
}

function modeleGratuit(config, modele) {
  if (!config) return false;
  if (config.type === 'ollama') return true;
  if (!fournisseurGratuit(config.baseUrl)) return false;
  const h = hote(config.baseUrl);
  if (h === 'openrouter.ai') return /:free$/.test(modele);
  if (h === 'generativelanguage.googleapis.com') return /flash/i.test(modele) && !/image/i.test(modele);
  return true;
}

function conseilGratuit(config) {
  const h = hote(config.baseUrl);
  if (!fournisseurGratuit(config.baseUrl)) return 'Cette adresse n\'est pas un fournisseur gratuit : utilise Ollama, Gemini, Groq, OpenRouter, ou un serveur sur ton PC.';
  if (h === 'generativelanguage.googleapis.com') return 'Choisis un modèle « flash » : les autres ne sont pas dans l\'offre gratuite.';
  return 'Choisis un modèle qui finit par « :free », ils sont gratuits.';
}

// Ce que le fournisseur dit lui-même du modèle : Groq indique les modèles désactivés,
// OpenRouter indique s'il gère les outils (indispensables pour lire et écrire les fichiers)
function peutDiscuter(m) {
  if (m.active === false) return false;
  if (Array.isArray(m.supported_parameters) && !m.supported_parameters.includes('tools')) return false;
  const sortie = m.architecture?.output_modalities;
  if (Array.isArray(sortie) && !sortie.includes('text')) return false;
  return true;
}

// Modèles qui ont répondu "n'existe plus" : cachés pendant 30 jours, puis on leur redonne une chance
const DUREE_CASSE = 30 * 24 * 60 * 60 * 1000;

function modelesCasses(fournisseurId) {
  const liste = readJson('fournisseurs.json', {}).modelesCasses?.[fournisseurId] || {};
  return Object.entries(liste).filter(([, date]) => Date.now() - date < DUREE_CASSE).map(([id]) => id);
}

function marquerModeleCasse(fournisseurId, modele) {
  const reglages = readJson('fournisseurs.json', {});
  reglages.modelesCasses ??= {};
  reglages.modelesCasses[fournisseurId] ??= {};
  reglages.modelesCasses[fournisseurId][modele] = Date.now();
  // Si c'était le modèle retenu pour ce fournisseur, on l'oublie
  if (reglages.modeles?.[fournisseurId] === modele) delete reglages.modeles[fournisseurId];
  writeJson('fournisseurs.json', reglages);
}
// Ollama : GET /api/tags ; compatible OpenAI : GET {baseUrl}/models.
// Renvoie toujours { ok, models, erreur? } : la liste est rafraîchie toutes les 10 s, on ne lève jamais d'erreur.
async function listerModeles(config) {
  if (!config || config.type === 'ollama') {
    try {
      const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      return { ok: true, models: data.models.map((m) => m.name) };
    } catch {
      return { ok: false, models: [], erreur: 'Ollama ne répond pas.' };
    }
  }
  if (!config.baseUrl) return { ok: false, models: [], erreur: `Aucune adresse pour ${config.nom}.` };
  // Une adresse payante enregistrée avant cette règle : on ne la contacte même pas
  if (!fournisseurGratuit(config.baseUrl)) return { ok: false, models: [], erreur: conseilGratuit(config) };
  if (!config.cle) return { ok: false, models: [], erreur: `Aucune clé API pour ${config.nom}.` };
  try {
    const res = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/models`, {
      headers: { Authorization: `Bearer ${config.cle}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, models: [], erreur: await messageErreurOpenAI(config, res) };
    const data = await res.json();
    const casses = modelesCasses(config.id);
    // Gemini préfixe ses modèles par "models/", mais attend le nom sans le préfixe dans /chat/completions
    const models = (data.data || data.models || [])
      .filter(peutDiscuter)
      .map((m) => String(m.id || m.name || '').replace(/^models\//, ''))
      .filter((id) => id && !NE_DISCUTE_PAS.test(id) && !casses.includes(id))
      // Chez Gemini, seuls les modèles gemini-… gèrent les outils (gemma, antigravity… non)
      .filter((id) => config.id !== 'gemini' || id.startsWith('gemini-'))
      // Seulement les modèles gratuits : rien ne peut être facturé
      .filter((id) => modeleGratuit(config, id))
      .sort((a, b) => a.localeCompare(b));
    return { ok: true, models };
  } catch (err) {
    return { ok: false, models: [], erreur: err.name === 'TimeoutError' ? `${config.nom} met trop de temps à répondre.` : `Impossible de joindre ${config.nom}.` };
  }
}

// ---------- Fournisseurs et clés API ----------
// Tout est dans fournisseurs.json, dans le dossier userData (jamais dans le projet ni dans Git).
// Les clés y sont chiffrées avec safeStorage (DPAPI sur Windows : seul ton compte Windows peut les lire).
// Elles ne sortent jamais de main.js : l'interface sait seulement si une clé est enregistrée ou non.
const FOURNISSEURS_DE_BASE = [
  { id: 'ollama', type: 'ollama', nom: 'Ollama (local)' },
  { id: 'gemini', type: 'openai', nom: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { id: 'groq', type: 'openai', nom: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'openrouter', type: 'openai', nom: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'perso', type: 'openai', nom: 'Personnalisé', baseUrl: '', modifiable: true },
];

function lireReglagesFournisseurs() {
  const r = readJson('fournisseurs.json', {});
  // ...r garde aussi modelesCasses quand le fichier est réécrit
  return { ...r, actif: r.actif || 'ollama', modeles: r.modeles || {}, fournisseurs: r.fournisseurs || {} };
}

// Fusionne la liste de base avec ce que l’utilisateur a enregistré (clé chiffrée, URL et nom du personnalisé)
function tousLesFournisseurs() {
  const { fournisseurs } = lireReglagesFournisseurs();
  return FOURNISSEURS_DE_BASE.map((base) => {
    const perso = fournisseurs[base.id] || {};
    return {
      ...base,
      nom: base.modifiable && perso.nom ? perso.nom : base.nom,
      baseUrl: base.modifiable ? perso.baseUrl || '' : base.baseUrl,
      cleChiffree: perso.cleChiffree || null,
    };
  });
}

// Début habituel des clés de chaque fournisseur, pour repérer une clé collée dans la mauvaise carte.
// On ne vérifie que ce début, et l'interface ne reçoit qu'un vrai / faux.
// Pas de règle pour Gemini : Google a plusieurs formats de clés, une vraie clé était signalée à tort.
const DEBUT_DES_CLES = {
  groq: { debut: 'gsk_', exemple: 'gsk_…' },
  openrouter: { debut: 'sk-or-', exemple: 'sk-or-v1-…' },
};

function formatDouteux(id, cle) {
  const attendu = DEBUT_DES_CLES[id];
  return !!(attendu && cle && !cle.startsWith(attendu.debut));
}

function avertissementFormat(id, nom) {
  return `Cette clé ne ressemble pas à une clé ${nom} (elles commencent par ${DEBUT_DES_CLES[id].exemple}). Elle est enregistrée quand même : vérifie que tu ne l'as pas collée dans la mauvaise carte.`;
}

function dechiffrer(cleChiffree) {
  if (!cleChiffree) return '';
  try {
    return safeStorage.decryptString(Buffer.from(cleChiffree, 'base64'));
  } catch {
    return ''; // clé chiffrée par un autre compte ou un autre PC : illisible ici
  }
}

// Config complète d'un fournisseur à partir de son identifiant, clé déchiffrée comprise.
// À n'utiliser que dans main.js : ce qui part vers l'interface passe par versInterface().
function configFournisseur(id = 'ollama') {
  const f = tousLesFournisseurs().find((x) => x.id === id);
  if (!f) return null;
  if (f.type === 'ollama') return { id: f.id, type: 'ollama', nom: f.nom };
  return { id: f.id, type: 'openai', nom: f.nom, baseUrl: f.baseUrl, cle: dechiffrer(f.cleChiffree) };
}

// Ce que l'interface a le droit de voir : tout sauf la clé
function versInterface() {
  const { actif, modeles } = lireReglagesFournisseurs();
  return {
    actif,
    modeles,
    chiffrementDispo: safeStorage.isEncryptionAvailable(),
    fournisseurs: tousLesFournisseurs().map(({ cleChiffree, ...f }) => {
      const cle = dechiffrer(cleChiffree);
      const douteux = formatDouteux(f.id, cle);
      return { ...f, aCle: f.type === 'ollama' || !!cle, formatDouteux: douteux, avertissement: douteux ? avertissementFormat(f.id, f.nom) : null };
    }),
  };
}

// Seules les adresses https sont acceptées (http seulement en local, pour un serveur sur ton PC)
function adresseValide(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || (u.protocol === 'http:' && HOTES_LOCAUX.includes(u.hostname));
  } catch {
    return false;
  }
}

ipcMain.handle('fournisseurs-lire', () => versInterface());

// Enregistre un fournisseur : { id, cle?, nom?, baseUrl? }
// cle absente = on garde l'ancienne ; cle vide = on la supprime ; nom et baseUrl seulement pour le personnalisé
ipcMain.handle('fournisseurs-enregistrer', (_e, { id, cle, nom, baseUrl }) => {
  const base = FOURNISSEURS_DE_BASE.find((f) => f.id === id);
  if (!base || base.type === 'ollama') return { ok: false, erreur: 'Fournisseur inconnu.' };
  const reglages = lireReglagesFournisseurs();
  const f = { ...(reglages.fournisseurs[id] || {}) };
  if (base.modifiable) {
    if (nom !== undefined) f.nom = String(nom).trim().slice(0, 40);
    if (baseUrl !== undefined) {
      const url = String(baseUrl).trim().replace(/\/+$/, '');
      if (url && !adresseValide(url)) return { ok: false, erreur: "Adresse invalide : elle doit commencer par https:// (ou http:// pour un serveur sur ton PC)." };
      if (url && !fournisseurGratuit(url)) return { ok: false, erreur: "Adresse refusée : l'app est 100 % gratuite. Seuls un serveur sur ton PC (http://localhost…), Groq, OpenRouter et Gemini sont acceptés." };
      f.baseUrl = url;
    }
  }
  if (cle !== undefined) {
    const propre = String(cle).trim();
    if (!propre) delete f.cleChiffree;
    else {
      // Jamais de clé en clair sur le disque : si le chiffrement n'est pas dispo, on refuse
      if (!safeStorage.isEncryptionAvailable()) return { ok: false, erreur: "Le chiffrement de Windows n'est pas disponible : la clé n'a pas été enregistrée." };
      f.cleChiffree = safeStorage.encryptString(propre).toString('base64');
    }
  }
  reglages.fournisseurs[id] = f;
  writeJson('fournisseurs.json', reglages);
  const avertissement = cle && formatDouteux(id, String(cle).trim()) ? avertissementFormat(id, base.nom) : null;
  return { ok: true, avertissement, reglages: versInterface() };
});

// Choisit le fournisseur actif et, si donné, le modèle retenu pour lui
ipcMain.handle('fournisseurs-choisir', (_e, { id, modele }) => {
  if (!FOURNISSEURS_DE_BASE.some((f) => f.id === id)) return { ok: false, erreur: 'Fournisseur inconnu.' };
  const reglages = lireReglagesFournisseurs();
  reglages.actif = id;
  // Un modèle payant n'est jamais retenu
  if (modele && modeleGratuit(configFournisseur(id), String(modele))) reglages.modeles[id] = String(modele);
  writeJson('fournisseurs.json', reglages);
  return { ok: true, reglages: versInterface() };
});

ipcMain.handle('models', async (_e, fournisseurId = 'ollama') => {
  const config = configFournisseur(fournisseurId);
  if (!config) return { ok: false, models: [], erreur: 'Fournisseur inconnu.' };
  return listerModeles(config);
});

// ---------- Projet ----------
ipcMain.handle('open-project', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Ouvrir un dossier projet' });
  if (!canceled) setProject(path.resolve(filePaths[0]));
  return projectDir;
});

ipcMain.handle('close-project', () => setProject(null));

function setProject(dir) {
  projectDir = dir;
  writeJson('settings.json', { ...readJson('settings.json', {}), projectDir });
  win.webContents.send('project-changed', projectDir);
  return projectDir;
}

// Ouvre un dossier détecté dans le message de l'utilisateur, après confirmation
ipcMain.handle('open-project-path', async (_e, dir) => {
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Ouvrir', 'Non'],
    defaultId: 0,
    cancelId: 1,
    title: 'Ouvrir un dossier',
    message: `Tu parles de ce projet. Je l'ouvre pour que l'IA puisse lire son code ?\n${dir}`,
  });
  if (response === 0) setProject(dir);
  return projectDir;
});

// Contexte donné directement au modèle : liste des fichiers + fichiers cités dans le message
ipcMain.handle('project-context', (_e, message) => {
  if (!projectDir) return null;
  const files = listFiles(projectDir);
  const mentioned = fichiersCites(message, files).slice(0, 3).map((f) => ({ path: f, content: contenuJoint(f) }));
  return { files: files.slice(0, 150), mentioned };
});

// Fichiers cités dans le message de l’utilisateur : leur chemin relatif, ou leur nom comme mot entier.
// Un nom sans extension (a, test, api) n'est retenu qu'à partir de 6 lettres (Makefile, LICENSE…) :
// sinon il serait « cité » dans presque tous les messages. Les chemins complets passent en premier.
function fichiersCites(message, fichiers) {
  const texte = message.toLowerCase().replace(/\\/g, '/');
  // Mot entier : pas collé à une lettre, un tiret ou un point avant ; après, un point ne compte
  // que s'il termine la phrase (« regarde notes.js. » oui, « notes.js.bak » non)
  const motEntier = (nom) => new RegExp(`(^|[^\\w.-])${nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\w.-]|\\.(?!\\w))`).test(texte);
  const parChemin = [];
  const parNom = [];
  for (const f of fichiers) {
    if (f.endsWith('/')) continue;
    const nom = path.basename(f).toLowerCase();
    if (f.includes('/') && motEntier(f.toLowerCase())) parChemin.push(f);
    else if ((nom.includes('.') || nom.length >= 6) && motEntier(nom)) parNom.push(f);
  }
  return [...parChemin, ...parNom];
}

// Ce qui est joint au message pour un fichier cité : son texte, ou la raison pour laquelle il ne l'est pas
function contenuJoint(relatif) {
  let full;
  try {
    full = safePath(relatif);
  } catch {
    return '(mène en dehors du projet : pas joint)';
  }
  if (estSensible(full)) return '(fichier sensible, pas joint automatiquement : lis-le avec lire_fichier si tu en as vraiment besoin, l’utilisateur devra confirmer)';
  if (fs.statSync(full).size > MAX_FILE) return '(fichier trop gros)';
  const contenu = fs.readFileSync(full, 'utf8');
  return contenu.includes('\u0000') ? "(fichier binaire, pas joint)" : contenu;
}

// Dossiers de projets connus, donnés au modèle pour qu'il ait les chemins exacts
ipcMain.handle('known-projects', () => {
  const root = path.join(app.getPath('documents'), 'MesProjets');
  const out = [];
  const dossiers = (dir) => fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !IGNORED.has(e.name) && !e.name.startsWith('.'));
  try {
    for (const e of dossiers(root)) {
      const chemin = path.join(root, e.name);
      // Un dossier qui ne contient que des dossiers (ex : Autre) sert à ranger des projets : on liste ce qu'il contient.
      // Sinon c'est un projet, et ses sous-dossiers (src, data, public…) n'en sont pas.
      const contenu = fs.readdirSync(chemin, { withFileTypes: true }).filter((x) => !x.name.startsWith('.') && x.name !== 'desktop.ini');
      if (contenu.length && contenu.every((x) => x.isDirectory())) dossiers(chemin).forEach((s) => out.push(path.join(chemin, s.name)));
      else out.push(chemin);
    }
  } catch {}
  return out.slice(0, 40);
});

ipcMain.handle('special-dirs', () => ({
  bureau: app.getPath('desktop'),
  documents: app.getPath('documents'),
  téléchargements: app.getPath('downloads'),
}));

ipcMain.handle('dir-exists', (_e, dir) => {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
});

ipcMain.handle('get-project', () => {
  if (projectDir === null) {
    const saved = readJson('settings.json', {}).projectDir;
    if (saved && fs.existsSync(saved)) projectDir = saved;
  }
  return projectDir;
});

// ---------- Mémoire et conversations ----------
ipcMain.handle('load-memory', () => readJson('memory.json', []));
ipcMain.handle('save-memory', (_e, memory) => writeJson('memory.json', memory));
ipcMain.handle('load-convs', () => readJson('conversations.json', []));
ipcMain.handle('save-convs', (_e, convs) => writeJson('conversations.json', convs));
// Les alertes ne sont données qu'une fois : la liste est vidée en même temps
ipcMain.handle('alertes-stockage', () => alertesStockage.splice(0));

// Une seule app ouverte à la fois : deux fenêtres liraient et enregistreraient chacune leur version
// des discussions et des réglages, et la dernière qui enregistre effacerait le travail de l'autre.
// Relancer l'app ramène simplement la fenêtre déjà ouverte au premier plan.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(() => {
    demarrerOllama();
    createWindow();
  });
}
app.on('window-all-closed', () => app.quit());
app.on('quit', () => serveurOllama?.kill());
