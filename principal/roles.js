// Rôles créés par l'utilisateur : nettoyage, et partage entre amis dans un petit fichier .catai.
// Que des fonctions pures : un fichier reçu vient de quelqu'un d'autre, tout ce qu'il contient est vérifié ici.
//
// Un rôle finit dans les consignes du modèle, mais il n'ouvre aucun droit : écrire un fichier passe toujours
// par la fenêtre avant / après, et lire un fichier sensible demande toujours l'accord de l'utilisateur.

const MAX_ROLES = 12;
const MAX_NOM = 40;
const MAX_CONSIGNE = 1000;
// Un rôle fait moins de 2 Ko : au-delà, ce n'est pas un fichier de rôle et on ne le lit même pas
const MAX_FICHIER_ROLE = 10 * 1024;
const TYPE_FICHIER = 'cat-ai-role';

// Retire les caractères de contrôle (sauf le retour à la ligne) et coupe à la longueur maximale
const nettoyerTexte = (v, max) => String(v ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max);

// Un rôle propre { nom, consigne }, ou null s'il manque le nom ou la consigne
function nettoyerRole(r) {
  const role = { nom: nettoyerTexte(r?.nom, MAX_NOM).replace(/\n/g, ' '), consigne: nettoyerTexte(r?.consigne, MAX_CONSIGNE) };
  return role.nom && role.consigne ? role : null;
}

const nettoyerRoles = (roles) => (Array.isArray(roles) ? roles : []).map(nettoyerRole).filter(Boolean).slice(0, MAX_ROLES);

// Contenu du fichier partagé : du JSON lisible, avec un type pour reconnaître un fichier de rôle
const roleVersFichier = (role) => JSON.stringify({ type: TYPE_FICHIER, version: 1, nom: role.nom, consigne: role.consigne }, null, 2) + '\n';

// Lit un fichier reçu : { role } s'il est valide, sinon { erreur } avec une phrase pour l'utilisateur
function roleDepuisFichier(texte) {
  if (String(texte).length > MAX_FICHIER_ROLE) return { erreur: "Ce fichier est trop gros pour être un rôle Cat Ai." };
  let donnees;
  try {
    donnees = JSON.parse(String(texte).replace(/^﻿/, ''));
  } catch {
    return { erreur: "Ce fichier n'est pas un rôle Cat Ai : il est illisible." };
  }
  if (donnees?.type !== TYPE_FICHIER) return { erreur: "Ce fichier n'est pas un rôle Cat Ai." };
  const role = nettoyerRole(donnees);
  if (!role) return { erreur: 'Ce rôle est incomplet : il lui manque un nom ou une consigne.' };
  return { role };
}

// Nom de fichier proposé à l'enregistrement : le nom du rôle, sans les caractères interdits par Windows
const nomFichierRole = (nom) => `${String(nom).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/[. ]+$/, '').trim() || 'Rôle'}.catai`;

// Ajoute un rôle reçu à la liste : { roles } (liste à enregistrer), { deja } s'il est déjà là à l'identique,
// ou { erreur }. Un rôle du même nom mais avec une autre consigne garde les deux, le nouveau marqué « (reçu) ».
function ajouterRole(roles, role) {
  const liste = nettoyerRoles(roles);
  if (liste.some((r) => r.nom === role.nom && r.consigne === role.consigne)) return { deja: true };
  if (liste.length >= MAX_ROLES) return { erreur: `Tu as déjà ${MAX_ROLES} rôles : supprimes-en un pour faire de la place.` };
  let { nom } = role;
  if (liste.some((r) => r.nom === nom)) nom = `${nom.slice(0, MAX_NOM - 8)} (reçu)`;
  return { roles: [...liste, { nom, consigne: role.consigne }] };
}

module.exports = { MAX_ROLES, MAX_FICHIER_ROLE, nettoyerRoles, roleVersFichier, roleDepuisFichier, nomFichierRole, ajouterRole };
