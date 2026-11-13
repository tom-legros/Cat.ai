// Les agents du mode chantier : qui fait le chef, l'ouvrier et le vérificateur.
// Que des fonctions pures, sur le contenu de fournisseurs.json : elles sont faciles à tester.
//
// - Le chef découpe le plan et relit : un modèle en ligne (Gemini) s'il y a une clé, sinon le modèle du PC.
// - L'ouvrier code pendant des heures : toujours un modèle du PC (Ollama), sinon le quota gratuit du jour y passerait.
// - Le vérificateur relit après les tests du projet : le chef, tant qu'un autre n'a pas été choisi.
const { modeleGratuit } = require('./gratuit');

const ROLES = ['chef', 'ouvrier', 'verificateur'];

function rolesDepuis(reglages) {
  const modeles = reglages.modeles || {};
  const choisis = reglages.roles || {};
  const local = { fournisseur: 'ollama', modele: modeles.ollama || '' };
  const aCleGemini = !!reglages.fournisseurs?.gemini?.cleChiffree;
  const chef = choisis.chef || (aCleGemini ? { fournisseur: 'gemini', modele: modeles.gemini || '' } : local);
  return {
    chef,
    ouvrier: { fournisseur: 'ollama', modele: choisis.ouvrier?.modele || local.modele },
    verificateur: choisis.verificateur || chef,
    verificateurCommeChef: !choisis.verificateur,
  };
}

// Renvoie les réglages avec le rôle changé, ou { erreur }. choix vide pour le vérificateur : il redevient le chef.
// infos(id) donne { type, baseUrl } du fournisseur, ou null s'il n'existe pas.
function changerRole(reglages, role, choix, infos) {
  if (!ROLES.includes(role)) return { erreur: 'Agent inconnu.' };
  const roles = { ...(reglages.roles || {}) };
  if (!choix) {
    if (role !== 'verificateur') return { erreur: 'Il faut un fournisseur et un modèle.' };
    delete roles.verificateur;
    return { reglages: { ...reglages, roles } };
  }
  const fournisseur = String(choix.fournisseur || '');
  const modele = String(choix.modele || '');
  const config = infos(fournisseur);
  if (!config) return { erreur: 'Fournisseur inconnu.' };
  if (role === 'ouvrier' && config.type !== 'ollama') return { erreur: "L'ouvrier tourne sur ton PC, avec Ollama." };
  if (!modele) return { erreur: 'Il faut choisir un modèle.' };
  // Un modèle payant n'est jamais retenu
  if (!modeleGratuit(config, modele)) return { erreur: "Ce modèle n'est pas gratuit." };
  roles[role] = { fournisseur, modele };
  return { reglages: { ...reglages, roles } };
}

module.exports = { ROLES, rolesDepuis, changerRole };
