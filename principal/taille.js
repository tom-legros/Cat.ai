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
const limitesTaille = (config) => (config?.baseUrl ? LIMITES_TAILLE[hote(config.baseUrl)] : null) || null;

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

const taille = (m) => (m.content || '').length + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);

// Coupe un texte trop long, avec une note qui dit au modèle où reprendre s'il s'agit d'un fichier
function raccourcir(texte, max) {
  if (texte.length <= max) return texte;
  const garde = texte.slice(0, max);
  const suite = garde.split('\n').length;
  return `${garde}\n[… coupé ici pour tenir dans la limite du modèle. Si c'est un fichier, la suite commence à la ligne ${suite} : relis-le avec lire_fichier et ligne = ${suite}.]`;
}

// Ramène l'historique sous `total` caractères, sans casser le lien entre un appel d'outil et son résultat :
// 1. on raccourcit les résultats d'outils, du plus gros au plus petit : un fichier lu en entier passe avant
//    un résultat de recherche, court et précieux (coupé, le modèle relançait sans fin la même recherche) ;
// 2. puis on retire les plus vieux échanges (un message de l'utilisateur, ou une réponse avec ses résultats d'outils),
//    en gardant toujours les consignes du début et le dernier message de l'utilisateur avec ce qui le suit.
function compacter(messages, total) {
  const liste = messages.map((m) => ({ ...m }));
  const somme = () => liste.reduce((n, m) => n + taille(m), 0);
  // Les consignes (avec le contenu des fichiers cités) ne prennent jamais plus de la moitié
  if (liste[0]?.role === 'system') liste[0].content = raccourcir(liste[0].content, total / 2);
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
      if (m.role === 'user' && m.content.length > total / 3) m.content = raccourcir(m.content, total / 3);
    }
  }
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

module.exports = { LIMITES_TAILLE, LIMITES_OLLAMA, MAX_JOINT, MAX_LISTE, limitesTaille, estimerTokens, taille, raccourcir, compacter, listeCourte };
