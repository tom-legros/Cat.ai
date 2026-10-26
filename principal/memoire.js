// Mémoire du chat : les faits qu'il retient sur l’utilisateur et ses projets.
// Toute la mémoire est remise dans les consignes à CHAQUE message : elle doit rester petite,
// sans doublons, sinon elle mange la place du petit modèle (8 192 tokens avec Ollama).
const MAX_FAITS = 40;
const MAX_LONGUEUR_FAIT = 200;

// Pour comparer deux faits : sans majuscules, sans accents, sans ponctuation ni espaces en trop
const normaliser = (texte) => texte.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Ajoute un fait à la mémoire, sans la modifier. Renvoie :
// - { memoire, fait } : ajouté ;
// - { memoire, fait, remplace } : le fait complète un fait déjà retenu, qu'il remplace ;
// - { erreur } : rien n'a changé (vide, déjà connu, mémoire pleine), avec la raison pour le modèle.
function ajouterFait(memoire, texte) {
  const fait = String(texte ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LONGUEUR_FAIT);
  const cle = normaliser(fait);
  if (!cle) return { erreur: 'Le fait à retenir est vide.' };
  const deja = memoire.find((f) => normaliser(f) === cle || normaliser(f).includes(cle));
  if (deja) return { erreur: `Déjà retenu : « ${deja} ». Inutile de le mémoriser encore.` };
  // Le nouveau fait dit la même chose en plus complet : il prend la place de l'ancien
  const moinsComplet = memoire.find((f) => cle.includes(normaliser(f)));
  if (moinsComplet) return { memoire: memoire.map((f) => (f === moinsComplet ? fait : f)), fait, remplace: moinsComplet };
  if (memoire.length >= MAX_FAITS) {
    return { erreur: `Mémoire pleine (${MAX_FAITS} faits) : rien n'a été retenu. Dis à l’utilisateur de faire du tri dans « Mémoire », dans la barre de gauche.` };
  }
  return { memoire: [...memoire, fait], fait };
}

module.exports = { MAX_FAITS, MAX_LONGUEUR_FAIT, ajouterFait };
