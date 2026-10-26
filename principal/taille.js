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

module.exports = { LIMITES_TAILLE, limitesTaille, taille, raccourcir, compacter };
