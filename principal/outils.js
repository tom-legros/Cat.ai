// Les outils proposés au modèle, ce que le mode prof a le droit d'écrire,
// et les petites fonctions qui travaillent sur leurs arguments. Que des fonctions pures.

// ---------- Outils que le modèle peut utiliser ----------
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'ouvrir_dossier',
      description: "Ouvre un dossier de l'ordinateur comme projet, avec son chemin complet (ex : C:\\Users\\moi\\Documents\\portfolio, ou /home/moi/projets/portfolio sous Linux). À utiliser quand l'utilisateur parle d'un dossier ou d'un projet. L'utilisateur doit confirmer.",
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
      description: "Lit le contenu d'un fichier du projet. Un long fichier arrive par morceaux : l'en-tête donne la ligne à demander pour lire la suite.",
      parameters: {
        type: 'object',
        properties: {
          chemin: { type: 'string', description: 'Chemin relatif au projet' },
          ligne: { type: 'number', description: 'Facultatif : numéro de la première ligne à lire (1 = début du fichier)' },
        },
        required: ['chemin'],
      },
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
      description: "Crée un fichier, ou remplace un fichier entier avec le contenu COMPLET donné. Pour modifier un fichier existant, surtout un long, ne le réécris pas : change seulement les passages avec remplacer_texte. L'utilisateur doit confirmer.",
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
      name: 'lire_document',
      description: "Lit un document joint par l'utilisateur (PDF, cours, long texte) : un morceau à partir d'une ligne, ou les passages qui contiennent un texte. L'identifiant du document est écrit dans le message où il a été joint.",
      parameters: {
        type: 'object',
        properties: {
          document: { type: 'string', description: 'Identifiant du document (16 lettres et chiffres), donné dans le message' },
          ligne: { type: 'number', description: 'Facultatif : première ligne à lire (1 = début)' },
          texte: { type: 'string', description: 'Facultatif : texte à chercher dans le document, au lieu de lire à partir d\'une ligne' },
        },
        required: ['document'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'chercher_web',
      description: "Cherche sur internet et renvoie les meilleurs résultats (titre, adresse, extrait). À utiliser pour une doc (Linux, une commande, un langage), une erreur, ou une info récente. Ensuite, lis les pages utiles avec lire_page_web. Quelques mots-clés suffisent, sans info personnelle.",
      parameters: { type: 'object', properties: { requete: { type: 'string', description: 'Les mots à chercher, comme dans un moteur de recherche' } }, required: ['requete'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lire_page_web',
      description: "Lit le texte d'une page internet dont tu as l'adresse exacte (un lien donné par l'utilisateur, ou un résultat de chercher_web), pour la résumer ou répondre à partir d'elle. Pour une autre adresse, l'utilisateur doit confirmer.",
      parameters: { type: 'object', properties: { url: { type: 'string', description: "Adresse complète de la page, qui commence par https://" } }, required: ['url'] },
    },
  },
];

// En mode prof, le chat n'a pas le droit d'écrire : il explique, l'utilisateur code.
// mode = { prof, projet, fournisseurId }
const OUTILS_ECRITURE = new Set(['ecrire_fichier', 'remplacer_texte']);
const peutEcrire = ({ prof } = {}) => !prof;
// Sans dossier ouvert (projet: false), les outils de fichiers ne servent à rien : leur description, plus de la moitié
// de celle de tous les outils, n'est pas envoyée, et Ollama a environ 1 000 mots de moins à lire à chaque début de
// discussion. ouvrir_dossier reste : dès qu'un dossier est ouvert, l'étape suivante du chat les retrouve.
const OUTILS_PROJET = new Set(['lister_fichiers', 'lire_fichier', 'chercher', 'ecrire_fichier', 'remplacer_texte']);
const outilsPour = (mode) => TOOLS.filter(({ function: { name } }) => {
  if (mode?.projet === false && OUTILS_PROJET.has(name)) return false;
  if (mode?.documents === false && name === 'lire_document') return false;
  return peutEcrire(mode) || !OUTILS_ECRITURE.has(name);
});

// Les petits modèles annoncent parfois une modification qui n'a pas eu lieu : chaque refus le dit clairement
const RIEN_N_A_CHANGE = " Le fichier n'a pas changé : ne dis pas à l'utilisateur qu'il est modifié.";
// Début du résultat d'une lecture de fichier sensible refusée : main.js et resumerAction le reconnaissent
const REFUS_LECTURE = "L'utilisateur a refusé la lecture de ";

// Les petits modèles tournent parfois en rond (même lecture, même recherche, même écriture proposée) :
// au-delà de REPETITIONS_MAX fois le même appel avec les mêmes arguments pour un message, il n'est plus refait.
// `deja` est une Map propre à chaque message de l'utilisateur.
const REPETITIONS_MAX = 2;
const BOUCLE = "Tu as déjà fait exactement cette action pour ce message, le résultat serait le même : ne la refais pas. Continue autrement, ou réponds à l'utilisateur avec ce que tu as.";
function appelRepete(deja, nom, args) {
  const cle = `${nom} ${JSON.stringify(args ?? {})}`;
  const fois = (deja.get(cle) || 0) + 1;
  deja.set(cle, fois);
  return fois > REPETITIONS_MAX;
}

// Renvoie la raison du refus, ou rien si l'écriture est permise
function ecritureRefusee({ prof } = {}) {
  if (prof) return "Mode prof activé : tu n'as pas le droit d'écrire de fichier. Explique à l'utilisateur ce qu'il doit faire et laisse-le coder." + RIEN_N_A_CHANGE;
}

// Remplace le passage `ancien` de `contenu` par `nouveau`. Renvoie { contenu, fois } ou { erreur } pour le modèle.
// Par défaut, l'ancien texte doit apparaître exactement une fois : s'il apparaît plusieurs fois, on ne devine pas
// lequel modifier. Avec partout (renommage), toutes les occurrences sont remplacées : l'utilisateur les voit toutes dans l'avant / après.
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

// Une ligne qui résume ce qu'un outil a fait, d'après son résultat : gardée dans l'historique de la discussion
// pour que le modèle sache, aux messages suivants, ce qu'il a déjà lu ou modifié (sans le contenu des fichiers).
// Renvoie '' pour ce qui n'est pas une action à retenir.
function resumerAction(nom, args = {}, resultat = '') {
  const r = String(resultat);
  const chemin = args.chemin || '';
  const rate = r.startsWith('Erreur') || r.startsWith('Fichier trop gros') || r.includes("n'existe pas");
  switch (nom) {
    case 'lire_fichier':
      if (r.startsWith(REFUS_LECTURE)) return `n'a pas pu lire ${chemin} (lecture refusée : fichier sensible)`;
      if (rate) return `n'a pas pu lire ${chemin}`;
      return `a lu ${chemin}${Number(args.ligne) > 1 ? ` à partir de la ligne ${Math.floor(Number(args.ligne))}` : ''}`;
    case 'chercher': {
      if (rate) return `n'a pas pu chercher « ${args.texte} »`;
      const trouves = r.split('\n').filter((l) => /^[^\s(…].*:\d+: /.test(l)).length;
      return `a cherché « ${args.texte} »${args.dossier ? ` dans ${args.dossier}` : ''} (${trouves ? `${trouves}${r.includes("d'autres résultats") ? '+' : ''} résultat${trouves > 1 ? 's' : ''}` : 'aucun résultat'})`;
    }
    case 'lister_fichiers':
      return rate ? '' : `a listé les fichiers${args.dossier ? ` de ${args.dossier}` : ''}`;
    case 'ecrire_fichier':
    case 'remplacer_texte':
      if (r.startsWith('Fichier créé')) return `a créé ${chemin}`;
      if (r.startsWith('Fichier modifié')) return `a modifié ${chemin}`;
      if (r.startsWith("L'utilisateur a refusé")) return `voulait modifier ${chemin}, mais la modification a été refusée : le fichier n'a pas changé`;
      return `n'a pas pu modifier ${chemin} : le fichier n'a pas changé`;
    case 'lire_document':
      if (/^(Identifiant|Ce document)/.test(r)) return "n'a pas pu lire le document joint";
      return args.texte ? `a cherché « ${args.texte} » dans le document joint` : `a lu le document joint${Number(args.ligne) > 1 ? ` à partir de la ligne ${Math.floor(Number(args.ligne))}` : ''}`;
    case 'chercher_web': {
      if (!r.startsWith('Résultats de recherche')) return `n'a rien trouvé en cherchant « ${args.requete} » sur internet`;
      const nombre = (r.match(/^\d+\. /gm) || []).length;
      return `a cherché « ${args.requete} » sur internet (${nombre} résultat${nombre > 1 ? 's' : ''})`;
    }
    case 'lire_page_web':
      if (r.startsWith("L'utilisateur a refusé")) return `n'a pas pu lire la page ${args.url} (lecture refusée)`;
      return r.startsWith('Page : ') ? `a lu la page ${args.url}` : `n'a pas pu lire la page ${args.url}`;
    case 'memoriser':
      return r.startsWith('Mémorisé') ? `a retenu : ${args.fait}` : '';
    case 'ouvrir_dossier':
      return r.startsWith('Dossier ouvert') ? `a ouvert le dossier ${chemin}` : '';
    default:
      return '';
  }
}

module.exports = { TOOLS, OUTILS_ECRITURE, peutEcrire, outilsPour, RIEN_N_A_CHANGE, REFUS_LECTURE, BOUCLE, appelRepete, ecritureRefusee, remplacerTexte, desechapper, parseTextToolCalls, matchingBrace, resumerAction };
