// Le titre d'une discussion, donné par le modèle après la première réponse.
// La consigne reste minuscule (le premier message, raccourci) : quelques tokens à lire, une dizaine à écrire.
// Ce que le modèle renvoie est nettoyé ; si ce n'est pas un vrai titre, on garde l'ancien.

const MAX_MESSAGE = 600;
const MAX_TITRE = 60;

function consigneTitre(premierMessage) {
  const message = String(premierMessage || '').replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE);
  return 'Donne un titre court (3 à 6 mots, en français) à une discussion qui commence par ce message. '
    + 'Réponds seulement par le titre, sans guillemets, sans emoji et sans point final.\n\n'
    + `Message : ${message}`;
}

function nettoyerTitre(texte) {
  let t = String(texte || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .split('\n').map((l) => l.trim()).find(Boolean) || '';
  t = t
    .replace(/^(titre|title)\s*:\s*/i, '')
    .replace(/[*_#`]/g, '')
    .replace(/^["'«“‘\s]+|["'»”’\s]+$/g, '')
    .replace(/[.!…:;,\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length < 3) return null;
  if (t.length > MAX_TITRE) {
    // Coupé à un mot entier, pour ne pas finir au milieu d'un mot
    t = t.slice(0, MAX_TITRE).replace(/\s+\S*$/, '').trim();
  }
  return t.length >= 3 ? t : null;
}

module.exports = { consigneTitre, nettoyerTitre, MAX_TITRE };
