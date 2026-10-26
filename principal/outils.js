// Les outils proposés au modèle, ce que chaque mode ou rôle a le droit d'écrire,
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
      description: "Lit le contenu d'un fichier du projet. Pour un long fichier coupé, donne ligne pour lire la suite à partir de cette ligne.",
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
      description: "Enregistre un fait durable et important sur l'utilisateur ou ses projets (préférences, technos, objectifs) pour s'en souvenir dans les prochaines discussions. Un fait court, une seule fois : pas les détails d'une seule discussion.",
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
      if (r.startsWith('L’utilisateur a refusé')) return `n'a pas pu lire ${chemin} (L’utilisateur a refusé : fichier sensible)`;
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
      if (r.startsWith("L'utilisateur a refusé")) return `voulait modifier ${chemin}, mais l’utilisateur a refusé : le fichier n'a pas changé`;
      return `n'a pas pu modifier ${chemin} : le fichier n'a pas changé`;
    case 'memoriser':
      return r.startsWith('Mémorisé') ? `a retenu : ${args.fait}` : '';
    case 'ouvrir_dossier':
      return r.startsWith('Dossier ouvert') ? `a ouvert le dossier ${chemin}` : '';
    default:
      return '';
  }
}

module.exports = { TOOLS, OUTILS_ECRITURE, peutEcrire, outilsPour, RIEN_N_A_CHANGE, ecritureRefusee, remplacerTexte, desechapper, parseTextToolCalls, matchingBrace, resumerAction };
