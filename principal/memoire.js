// Mémoire du chat : les faits qu'il retient sur l'utilisateur et ses projets.
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
    return { erreur: `Mémoire pleine (${MAX_FAITS} faits) : rien n'a été retenu. Dis à l'utilisateur de faire du tri dans « Mémoire », dans la barre de gauche.` };
  }
  return { memoire: [...memoire, fait], fait };
}

// Le prénom donné au premier lancement finit dans les consignes du modèle :
// une seule ligne, sans caractères de contrôle, et court. Renvoie '' s'il ne reste rien.
const MAX_PRENOM = 30;

function nettoyerPrenom(prenom) {
  return String(prenom ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_PRENOM).trim();
}

// La mémoire enregistrée depuis la fenêtre Mémoire (souvenir modifié ou oublié) : chaque fait sur une ligne,
// sans caractères de contrôle, coupé à la longueur maximale, sans vide ni doublon, et pas plus de MAX_FAITS.
function nettoyerMemoire(memoire) {
  const vus = new Set();
  return (Array.isArray(memoire) ? memoire : [])
    .map((f) => String(f ?? '').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().slice(0, MAX_LONGUEUR_FAIT))
    .filter((f) => f && !vus.has(normaliser(f)) && vus.add(normaliser(f)))
    .slice(0, MAX_FAITS);
}

function demandeMemoire(texte) {
  if (typeof texte !== 'string') return '';
  const demande = texte.trim().normalize('NFC');
  // Une question (« souviens-toi de ce qu'on a dit ? », « mémorise ce code et explique-le ») va au modèle
  if (/\?\s*$/.test(demande) || /\bde ce qu|\bexplique/i.test(demande)) return '';
  const correspondance = demande.match(/^(?:s['’]il te pla[iî]t[ ,]+)?(?:retiens|m[ée]morise|souviens[- ]toi|garde en m[ée]moire)[ :]+(?:que\s+|qu['’])?(.+)$/isu);
  return correspondance?.[1].trim() || '';
}

module.exports = { demandeMemoire, MAX_FAITS, MAX_LONGUEUR_FAIT, MAX_PRENOM, ajouterFait, nettoyerPrenom, nettoyerMemoire };
