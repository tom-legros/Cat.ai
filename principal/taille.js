// Taille des messages : garder chaque envoi sous la limite du fournisseur (Groq gratuit),
// sans casser le lien entre un appel d'outil et son résultat. Que des fonctions pures.
const { hote } = require('./gratuit');

// ---------- Taille des messages ----------
// L'offre gratuite de Groq accepte 8 000 tokens par minute, réponse comprise (et 1 000 tokens de réponse
// pour certains modèles). Un seul fichier lu peut dépasser ça : on garde chaque envoi sous ces limites.
// 1 token ≈ 3 caractères pour du code : 18 000 caractères + les outils + 1 000 tokens de réponse < 8 000 tokens.
// Une réponse peut demander plusieurs envois dans la même minute (un par fichier lu) : chaque envoi reste petit.
const LIMITES_TAILLE = {
  'api.groq.com': { total: 12000, resultatOutil: 4000, reponse: 1000 },
};
// Le PC d'un autre de la maison qui partage sa carte graphique : c'est son Ollama, avec les mêmes 8 192 tokens
const limitesTaille = (config) => {
  if (!config?.baseUrl) return null;
  const h = hote(config.baseUrl);
  if (LIMITES_TAILLE[h]) return LIMITES_TAILLE[h];
  return require('./gratuit').reseauPrive(h) ? LIMITES_OLLAMA : null;
};

// Ollama tourne avec 8 192 tokens de contexte (num_ctx, dans envoi.js). Quand ça déborde, il retire les messages
// les plus anciens SANS PRÉVENIR, et la question de l'utilisateur peut disparaître derrière un gros fichier lu.
// On compacte donc nous-mêmes : 8 192 tokens, moins ~1 500 pour la réponse et ~1 200 pour la description des outils,
// laissent ~5 500 tokens, soit ~16 000 caractères.
const LIMITES_OLLAMA = { total: 16000, resultatOutil: 8000 };

// Contenu des fichiers cités joint automatiquement au message : au plus ~3 000 tokens en tout.
// Au-delà, le modèle lit la suite lui-même avec lire_fichier.
const MAX_JOINT = 9000;

// Estimation grossière : ~3 caractères par token pour du code et du français
const estimerTokens = (texte) => Math.ceil(texte.length / 3);

// Une image compte pour ~1 500 tokens chez un modèle qui voit (qwen3.5, gemma3) : on la compte comme 4 500 caractères,
// sinon une discussion avec des photos dépasserait le contexte d'Ollama sans que compacter le voie
const TAILLE_IMAGE = 4500;
const taille = (m) => (m.content || '').length + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0) + (m.images?.length || 0) * TAILLE_IMAGE;

// Coupe un texte trop long, avec une note qui dit au modèle où reprendre s'il s'agit d'un fichier
function raccourcir(texte, max) {
  max = Math.max(0, Math.floor(max));
  if (texte.length <= max) return texte;
  const entete = /^\(([^\n]*) : lignes (\d+) à \d+ sur \d+\./.exec(texte);
  const doc = entete && /^document ([a-f0-9]{16})$/.exec(entete[1]);
  let place = max;
  while (place >= 0) {
    const garde = texte.slice(0, place);
    const n = garde.split('\n').length;
    const suite = entete ? Math.max(Number(entete[2]), Number(entete[2]) + n - 2) : n;
    const relire = doc ? `lire_document, document = « ${doc[1]} » et ligne = ${suite}` : `lire_fichier et ligne = ${suite}`;
    const note = `\n[… coupé ici pour tenir dans la limite du modèle. Si c'est un fichier, la suite commence à la ligne ${suite} : relis-le avec ${relire}.]`;
    if (garde.length + note.length <= max) return garde + note;
    place = Math.min(place - 1, max - note.length);
  }
  // Trop peu de place pour une indication complète : ne jamais dépasser max.
  return '…'.slice(0, max);
}

// Ramène l'historique sous `total` caractères, sans casser le lien entre un appel d'outil et son résultat :
// 1. on raccourcit les résultats d'outils, du plus gros au plus petit : un fichier lu en entier passe avant
//    un résultat de recherche, court et précieux (coupé, le modèle relançait sans fin la même recherche) ;
// 2. puis on retire les plus vieux échanges (un message de l'utilisateur, ou une réponse avec ses résultats d'outils),
//    en gardant toujours les consignes du début et le dernier message de l'utilisateur avec ce qui le suit.
// Un appel d'outil dont les longs textes (plus de 300 caractères) sont remplacés par une mention courte.
// Les arguments sont un objet (Ollama) ou du JSON en texte (fournisseurs compatibles OpenAI).
function appelRaccourci(appel) {
  const brut = appel?.function?.arguments;
  const enTexte = typeof brut === 'string';
  let args = brut;
  if (enTexte) { try { args = JSON.parse(brut); } catch { return { ...appel, function: { ...appel.function, arguments: raccourcir(brut, 300) } }; } }
  if (!args || typeof args !== 'object') return appel;
  const courts = Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === 'string' && v.length > 300 ? `[${v.length} caractères, déjà écrit]` : v]));
  return { ...appel, function: { ...appel.function, arguments: enTexte ? JSON.stringify(courts) : courts } };
}

function compacter(messages, total) {
  const liste = messages.map((m) => ({ ...m }));
  const somme = () => liste.reduce((n, m) => n + taille(m), 0);
  // Garder les instructions entières ; réduire les données facultatives d'abord.
  for (const m of liste.filter((m) => m.role === 'system' && m.name === 'contexte_projet')) {
    const place = Math.max(0, Math.min(total / 2, total - (somme() - taille(m))));
    m.content = raccourcir(m.content, place);
  }
  // sort est stable : à taille égale, le plus ancien passe en premier
  const parTaille = liste.filter((m) => m.role === 'tool').sort((a, b) => b.content.length - a.content.length);
  for (const m of parTaille) {
    if (somme() <= total) return liste;
    if (m.content.length > 800) m.content = raccourcir(m.content, 800);
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
      // Un appel d'outil déjà exécuté (un fichier entier passé à ecrire_fichier) : ses longs arguments ne servent plus,
      // le résultat de l'outil suit. Vu avec un README de 15 Ko réécrit d'un coup : la tâche s'arrêtait.
      if (m.role === 'assistant' && m.tool_calls?.length) m.tool_calls = m.tool_calls.map(appelRaccourci);
      if (m.role === 'user' && m.content.length > total / 3) m.content = raccourcir(m.content, total / 3);
    }
  }
  // Une longue suite d'outils pour un seul message (un petit modèle qui relit les mêmes fichiers) : on retire les plus
  // vieilles étapes (un appel et ses résultats), jamais la dernière, et on le dit au modèle au lieu d'abandonner.
  let retirees = 0;
  const dernierUtilisateur = liste.map((m) => m.role).lastIndexOf('user');
  while (somme() > total) {
    let i = dernierUtilisateur + 1;
    while (i < liste.length && !(liste[i].role === 'assistant' && liste[i].tool_calls?.length)) i++;
    let j = i + 1;
    while (j < liste.length && liste[j].role === 'tool') j++;
    if (i >= liste.length || j >= liste.length) break; // c'est la dernière étape : on la garde
    liste.splice(i, j - i);
    retirees++;
  }
  if (retirees && dernierUtilisateur >= 0) {
    const m = liste[dernierUtilisateur];
    m.content = `${m.content}\n\n(Note de l'app : ${retirees} étape(s) d'outils plus anciennes ont été retirées faute de place. Ne refais pas les mêmes lectures : réponds avec ce que tu as déjà trouvé.)`;
  }
  if (somme() > total) throw new Error('Contexte trop volumineux : les consignes sont conservées. Réduis la mémoire ou les pièces jointes avant de réessayer.');
  return liste;
}

// Liste des fichiers du dossier ouvert donnée dans les consignes : au plus ~800 tokens.
// Avec un gros dossier (Documents, Bureau…), 150 chemins remplissaient à eux seuls la moitié des 8 192 tokens
// d'Ollama, et la fin des consignes était coupée à chaque message. Le reste, le modèle le voit avec lister_fichiers.
const MAX_LISTE = 2500;

// Garde les premiers fichiers tant qu'ils tiennent dans `max` caractères ; `coupee` dit s'il en manque
function listeCourte(fichiers, max = MAX_LISTE) {
  const gardes = [];
  let place = max;
  for (const f of fichiers) {
    if (f.length + 1 > place) break;
    gardes.push(f);
    place -= f.length + 1;
  }
  return { fichiers: gardes, coupee: gardes.length < fichiers.length };
}

module.exports = { TAILLE_IMAGE, LIMITES_TAILLE, LIMITES_OLLAMA, MAX_JOINT, MAX_LISTE, limitesTaille, estimerTokens, taille, raccourcir, compacter, listeCourte };
