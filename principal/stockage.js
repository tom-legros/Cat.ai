// Stockage des données de l'app (discussions, mémoire, réglages, fournisseurs) dans le dossier userData.
// Ne dépend pas d'Electron : main.js donne le dossier et la façon de prévenir l'interface (configurerStockage).
const path = require('path');
const fs = require('fs');

let dossierDonnees = null;
let avertir = () => {};
const dataFile = (name) => path.join(dossierDonnees, name);

// dossier : où sont les fichiers ; prevenir : appelée quand une nouvelle alerte attend l'interface
function configurerStockage({ dossier, prevenir }) {
  dossierDonnees = dossier;
  if (prevenir) avertir = prevenir;
}

// Ce que chaque fichier contient, pour des alertes compréhensibles
const CONTENU_DES_FICHIERS = {
  'conversations.json': 'tes discussions',
  'memory.json': 'la mémoire du chat',
  'settings.json': 'les réglages',
  'fournisseurs.json': 'les fournisseurs et tes clés API',
};

// Fichiers abîmés et réparés. Avant que la fenêtre soit prête, les alertes attendent ici
// et l'interface les demande au démarrage ; ensuite, main.js les lui envoie tout de suite (prevenir).
const alertesStockage = [];

function signalerStockage(texte) {
  alertesStockage.push(texte);
  avertir();
}

// Les alertes ne sont données qu'une fois : la liste est vidée en même temps
const prendreAlertes = () => alertesStockage.splice(0);

function readJson(name, fallback) {
  let texte;
  try {
    texte = fs.readFileSync(dataFile(name), 'utf8');
  } catch (err) {
    // Pas encore de fichier : premier lancement, rien d'anormal
    if (err.code === 'ENOENT') return fallback;
    // Fichier présent mais pas lisible (bloqué par l'antivirus…) : il est peut-être très bien.
    // Renvoyer fallback ferait écraser son contenu au prochain enregistrement : on s'arrête là.
    throw new Error(`Impossible de lire ${name} (${err.code}) : réessaie dans un instant ou relance l'app.`);
  }
  try {
    return JSON.parse(texte);
  } catch {
    return reparer(name, fallback);
  }
}

// Fichier abîmé (coupé en plein milieu, modifié à la main…) : on ne l'écrase jamais.
// Il est mis de côté sous un autre nom, et on repart de la sauvegarde faite par writeJson si elle est lisible.
function reparer(name, fallback) {
  const fichier = dataFile(name);
  // Heure locale au format 2026-10-26 03:02:59 (le format suédois est justement celui-là)
  const date = new Date().toLocaleString('sv-SE').replace(/[ :]/g, '-');
  const misDeCote = `${fichier}.illisible-${date}`;
  fs.renameSync(fichier, misDeCote);
  const contenu = CONTENU_DES_FICHIERS[name] || name;
  const sauvegarde = `${fichier}.sauvegarde`;
  if (estLisible(sauvegarde)) {
    // Recopiée à la place du fichier abîmé : les lectures suivantes la trouvent directement
    fs.copyFileSync(sauvegarde, fichier);
    signalerStockage(`Le fichier qui garde ${contenu} était abîmé. Je suis reparti de la sauvegarde, faite juste avant la dernière modification : seule cette modification est perdue. Le fichier abîmé est mis de côté ici : ${misDeCote}`);
    return JSON.parse(fs.readFileSync(fichier, 'utf8'));
  }
  signalerStockage(`Le fichier qui garde ${contenu} était abîmé, et il n'y avait pas de sauvegarde lisible : je repars de zéro. Le fichier abîmé est mis de côté ici : ${misDeCote}`);
  return fallback;
}

// Écriture atomique : le nouveau contenu part d'abord dans un fichier temporaire, écrit jusqu'au disque,
// puis il prend la place de l'ancien d'un seul coup (renommage). Si l'app plante ou que le PC s'éteint
// en plein milieu, on garde soit l'ancienne version, soit la nouvelle, jamais un fichier à moitié écrit.
// Avant de remplacer, la version actuelle est copiée dans « nom.sauvegarde », seulement si elle est lisible :
// une copie abîmée ne servirait à rien et écraserait la dernière bonne sauvegarde.
function writeJson(name, value) {
  const fichier = dataFile(name);
  const temporaire = `${fichier}.tmp`;
  const descripteur = fs.openSync(temporaire, 'w');
  try {
    fs.writeFileSync(descripteur, JSON.stringify(value, null, 2));
    // Le système garde les écritures en cache un moment : sans fsync, une coupure de courant juste après
    // le renommage pourrait laisser un fichier vide à la place des deux versions
    fs.fsyncSync(descripteur);
  } finally {
    fs.closeSync(descripteur);
  }
  if (estLisible(fichier)) fs.copyFileSync(fichier, `${fichier}.sauvegarde`);
  fs.renameSync(temporaire, fichier);
}

function estLisible(fichier) {
  try {
    JSON.parse(fs.readFileSync(fichier, 'utf8'));
    return true;
  } catch {
    return false;
  }
}

module.exports = { configurerStockage, readJson, writeJson, prendreAlertes };
