// Fichiers du projet ouvert : chemins sûrs, fichiers sensibles, liste, recherche et fichiers cités.
// Chaque fonction reçoit le dossier projet en paramètre : rien ne dépend d'Electron ni d'un état global.
const path = require('path');
const fs = require('fs');

const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv', 'vendor', '.idea', '.vscode']);
// Fichiers joints automatiquement au message ou glissés dans la fenêtre : au plus 100 Ko, ils partent en entier
const MAX_FILE = 100 * 1024;
// Fichiers que le modèle lit, fouille ou modifie avec ses outils : jusqu'à 2 Mo, car il les lit par morceaux
// (extraitLignes) et les modifie passage par passage avec remplacer_texte, sans jamais tout renvoyer
const MAX_FICHIER_OUTIL = 2 * 1024 * 1024;

// Empêche le modèle de sortir du dossier projet choisi, y compris par un lien symbolique
// ou une jonction Windows placés dans le projet : on vérifie aussi où mène vraiment le chemin
function cheminSur(projet, rel) {
  if (!projet) throw new Error("Aucun dossier projet ouvert. Demande à l'utilisateur d'en ouvrir un.");
  const full = path.resolve(projet, rel || '.');
  if (!estDans(full, projet) || !estDans(cheminReel(full), cheminReel(projet))) throw new Error('Chemin en dehors du projet.');
  return full;
}

const estDans = (chemin, dossier) => chemin === dossier || chemin.startsWith(dossier + path.sep);

// Vraie destination d'un chemin, liens suivis. Pour un fichier qui n'existe pas encore (ecrire_fichier),
// on résout le dossier parent le plus proche qui existe, puis on rajoute la fin du chemin.
function cheminReel(chemin) {
  try {
    return fs.realpathSync.native(chemin);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    // Un lien cassé (sa destination n'existe pas) : impossible de savoir où il mène, et écrire dedans
    // créerait le fichier à sa destination. On refuse.
    if (fs.lstatSync(chemin, { throwIfNoEntry: false })) throw new Error("Lien dont la destination n'existe pas : refusé.");
    const parent = path.dirname(chemin);
    if (parent === chemin) return chemin;
    return path.join(cheminReel(parent), path.basename(chemin));
  }
}

// Fichiers qui contiennent souvent des secrets (mots de passe, clés API, clés privées).
// Leur contenu n'est jamais joint tout seul au message : le modèle doit le lire avec lire_fichier, et l'utilisateur confirme.
// Les modèles d'exemple (.env.example…) sont faits pour être partagés : ils restent lisibles.
const SENSIBLES = [
  /^\.env(\..+)?$/i,                                // .env, .env.local, .env.production…
  /\.(pem|key|p12|pfx|jks|keystore|ppk)$/i,         // certificats et clés privées
  /^id_(rsa|dsa|ecdsa|ed25519)$/i,                  // clés SSH privées (les .pub sont publiques)
  /^\.(npmrc|pypirc|netrc|git-credentials)$/i,      // jetons de npm, PyPI, Git
  /^(credentials|secrets?)(\.json)?$/i,
];
const EXEMPLES = /\.(example|sample|template|dist)$/i;

function estSensible(chemin) {
  const nom = path.basename(chemin);
  return !EXEMPLES.test(nom) && SENSIBLES.some((motif) => motif.test(nom));
}

// max : 300 pour la liste donnée au modèle, plus pour une recherche qui doit fouiller tout le projet
function listFiles(dir, prefix = '', out = [], max = 300) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED.has(entry.name) || out.length >= max) continue;
    const rel = prefix + entry.name;
    if (entry.isDirectory()) {
      out.push(rel + '/');
      listFiles(path.join(dir, entry.name), rel + '/', out, max);
    } else out.push(rel);
  }
  return out;
}

// Cherche un texte (ou une expression régulière) dans les fichiers du projet : une ligne « fichier:ligne: extrait »
// par résultat. Mêmes protections que lire_fichier : chemins vérifiés, fichiers sensibles jamais fouillés,
// fichiers binaires et trop gros ignorés.
const MAX_RESULTATS = 50;
const MAX_FICHIERS_FOUILLES = 3000;
// Les fichiers sont lus d'un bloc dans le processus principal : au-delà de 20 Mo lus, la recherche s'arrête
const MAX_OCTETS_FOUILLES = 20 * 1024 * 1024;

function chercherDansProjet(projet, texte, { regex = false, dossier = '' } = {}) {
  const motif = String(texte ?? '');
  if (!motif) return 'Donne le texte à chercher.';
  let correspond;
  if (regex) {
    if (motif.length > 200) return 'Expression régulière trop longue (200 caractères au plus) : simplifie-la.';
    let expression;
    try {
      expression = new RegExp(motif, 'i');
    } catch (err) {
      return `Expression régulière invalide (${err.message}). Corrige-la, ou cherche un texte simple sans regex.`;
    }
    // Lignes coupées à 1 000 caractères : une regex mal écrite sur une ligne de code minifié pourrait bloquer l'app
    correspond = (ligne) => expression.test(ligne.slice(0, 1000));
  } else {
    const minuscules = motif.toLowerCase();
    correspond = (ligne) => ligne.toLowerCase().includes(minuscules);
  }

  const sousDossier = String(dossier || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const base = cheminSur(projet, sousDossier);
  if (!fs.statSync(base).isDirectory()) return `${sousDossier} n'est pas un dossier. Pour un seul fichier, utilise lire_fichier.`;

  const resultats = [];
  let sensibles = 0;
  let octets = 0;
  let arretee = false;
  for (const rel of listFiles(base, '', [], MAX_FICHIERS_FOUILLES)) {
    if (rel.endsWith('/')) continue;
    const relatif = sousDossier ? `${sousDossier}/${rel}` : rel;
    if (estSensible(relatif)) { sensibles++; continue; }
    let full;
    try {
      full = cheminSur(projet, relatif);
    } catch {
      continue; // lien qui mène hors du projet
    }
    const stat = fs.statSync(full);
    if (!stat.isFile() || stat.size > MAX_FICHIER_OUTIL) continue;
    if ((octets += stat.size) > MAX_OCTETS_FOUILLES) { arretee = true; break; }
    const contenu = fs.readFileSync(full, 'utf8');
    if (contenu.includes('\u0000')) continue; // binaire
    const lignes = contenu.split(/\r?\n/);
    for (let i = 0; i < lignes.length && resultats.length <= MAX_RESULTATS; i++) {
      if (correspond(lignes[i])) resultats.push(`${relatif}:${i + 1}: ${lignes[i].trim().slice(0, 200)}`);
    }
    if (resultats.length > MAX_RESULTATS) break;
  }

  const ou = sousDossier ? ` dans ${sousDossier}` : '';
  const noteArret = arretee ? '\n(recherche arrêtée : le dossier est trop gros, cherche dans un sous-dossier pour la suite)' : '';
  const noteSensibles = sensibles ? `\n(${sensibles} fichier${sensibles > 1 ? 's' : ''} sensible${sensibles > 1 ? 's' : ''}, comme .env, non fouillé${sensibles > 1 ? 's' : ''})` : '';
  if (!resultats.length) return `Aucun résultat pour « ${motif} »${ou}.${noteSensibles}${noteArret}`;
  const trop = resultats.length > MAX_RESULTATS;
  const lignes = resultats.slice(0, MAX_RESULTATS).join('\n');
  return lignes + (trop ? `\n… et d'autres résultats : précise ta recherche (un texte plus long, ou un sous-dossier).` : '') + noteSensibles + noteArret;
}

// Fichiers cités dans le message de l'utilisateur : leur chemin relatif, ou leur nom comme mot entier.
// Un nom sans extension (a, test, api) n'est retenu qu'à partir de 6 lettres (Makefile, LICENSE…) :
// sinon il serait « cité » dans presque tous les messages. Les chemins complets passent en premier.
function fichiersCites(message, fichiers) {
  const texte = message.toLowerCase().replace(/\\/g, '/');
  // Mot entier : pas collé à une lettre, un tiret ou un point avant ; après, un point ne compte
  // que s'il termine la phrase (« regarde notes.js. » oui, « notes.js.bak » non)
  const motEntier = (nom) => new RegExp(`(^|[^\\w.-])${nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\w.-]|\\.(?!\\w))`).test(texte);
  const parChemin = [];
  const parNom = [];
  for (const f of fichiers) {
    if (f.endsWith('/')) continue;
    const nom = path.basename(f).toLowerCase();
    if (f.includes('/') && motEntier(f.toLowerCase())) parChemin.push(f);
    else if ((nom.includes('.') || nom.length >= 6) && motEntier(nom)) parNom.push(f);
  }
  return [...parChemin, ...parNom];
}

// Un morceau d'un long fichier pour lire_fichier : les lignes à partir de `ligne`, tant qu'elles tiennent dans `max`
// caractères, avec un en-tête qui dit quoi demander pour la suite. Un fichier court revient en entier.
function extraitLignes(contenu, chemin, ligne = 1, max = 20000) {
  // Le saut de ligne de la fin n'est pas une ligne de plus
  const lignes = contenu.replace(/\r?\n$/, '').split('\n');
  const debut = Math.max(1, Math.floor(Number(ligne)) || 1);
  if (debut > lignes.length) return `${chemin} n'a que ${lignes.length} lignes.`;
  if (debut === 1 && contenu.length <= max) return contenu;
  let fin = debut - 1;
  let taille = 0;
  // Toujours au moins une ligne, même très longue : elle est alors coupée ci-dessous, et l'en-tête le dit
  while (fin < lignes.length && (fin === debut - 1 || taille + lignes[fin].length + 1 <= max)) taille += lignes[fin++].length + 1;
  const texte = lignes.slice(debut - 1, fin).join('\n');
  const coupee = texte.length > max ? ` La ligne ${debut} est trop longue : seuls ses ${max} premiers caractères sont montrés, le reste ne peut pas être lu.` : '';
  const suite = fin < lignes.length ? ` Pour la suite : lire_fichier avec ligne = ${fin + 1}.` : " C'est la fin du fichier.";
  return `(${chemin} : lignes ${debut} à ${fin} sur ${lignes.length}.${coupee}${suite})\n${texte.slice(0, max)}`;
}

// Ce qui est joint au message pour un fichier cité : son texte, ou la raison pour laquelle il ne l'est pas
function contenuJoint(projet, relatif) {
  let full;
  try {
    full = cheminSur(projet, relatif);
  } catch {
    return '(mène en dehors du projet : pas joint)';
  }
  if (estSensible(full)) return "(fichier sensible, pas joint automatiquement : lis-le avec lire_fichier si tu en as vraiment besoin, l'utilisateur devra confirmer)";
  if (fs.statSync(full).size > MAX_FILE) return '(fichier trop gros)';
  const contenu = fs.readFileSync(full, 'utf8');
  return contenu.includes('\u0000') ? "(fichier binaire, pas joint)" : contenu;
}

module.exports = { IGNORED, MAX_FILE, MAX_FICHIER_OUTIL, extraitLignes, cheminSur, estSensible, listFiles, chercherDansProjet, fichiersCites, contenuJoint };
