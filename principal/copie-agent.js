// Mode Auto du chat : l'agent écrit sans demander, mais dans une copie git du projet (un worktree sur sa propre
// branche catai/agent-<nom>). La copie part de l'état exact du projet, y compris les changements pas encore
// enregistrés dans git et les fichiers nouveaux. Rien ne touche le projet tant que l'utilisateur n'a pas cliqué
// « Garder » : les changements de la copie sont alors appliqués à ses fichiers, sans commit.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const NOM_COPIE = /^[\w-]{1,60}$/;
const MAX_NON_SUIVI = 5 * 1024 * 1024;
const MAX_FICHIERS_NON_SUIVIS = 2000;
const MAX_PATCH_AFFICHE = 400_000;
const IDENTITE = ['-c', 'user.name=Cat Ai', '-c', 'user.email=chantier@cat-ai.invalid'];

const git = (dossier, args, options = {}) => execFileSync('git', args, {
  cwd: dossier, encoding: options.binaire ? 'buffer' : 'utf8', windowsHide: true,
  stdio: [options.entree !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'], input: options.entree, maxBuffer: 256 * 1024 * 1024,
});
const gitTexte = (dossier, ...args) => git(dossier, args).trim();

// Tout ajouter à l'index de la copie, sauf le lien vers node_modules (déjà ignoré dans la plupart des projets :
// git refuse alors qu'on le nomme, même pour l'exclure)
function ajouterTout(copie) {
  let ignore = true;
  try { git(copie, ['check-ignore', '-q', 'node_modules']); } catch { ignore = false; }
  git(copie, ['add', '-A', ...(ignore ? [] : ['--', '.', ':!node_modules'])]);
}

const brancheDe = (nom) => `catai/agent-${nom}`;
const copieDe = (dossierCopies, nom) => path.join(dossierCopies, `agent-${nom}`);

function verifierNom(nom) {
  if (!NOM_COPIE.test(String(nom))) throw new Error('Nom de copie invalide.');
  return String(nom);
}

// La copie enregistrée pour ce nom dans le dépôt, ou null (branche disparue, copie retirée…)
function trouverCopie(racine, nom) {
  const branche = brancheDe(verifierNom(nom));
  let liste;
  try { liste = gitTexte(racine, 'worktree', 'list', '--porcelain', '-z'); } catch { return null; }
  const champs = liste.split('\0\0').map((bloc) => bloc.split('\0')).find((c) => c.includes(`branch refs/heads/${branche}`));
  const copie = champs?.find((c) => c.startsWith('worktree '))?.slice('worktree '.length);
  return copie && fs.existsSync(copie) ? path.normalize(copie) : null;
}

// Le dépôt d'origine d'une copie : là où « Garder » applique les changements
function depotDeLaCopie(copie) {
  const commun = path.resolve(copie, gitTexte(copie, 'rev-parse', '--git-common-dir'));
  return path.dirname(commun);
}

// Crée la copie de travail. projet peut être un sous-dossier du dépôt : on renvoie aussi le même sous-dossier
// dans la copie, là où l'agent travaille.
function preparerCopie(projet, dossierCopies, nom) {
  verifierNom(nom);
  const racine = gitTexte(projet, 'rev-parse', '--show-toplevel');
  gitTexte(racine, 'rev-parse', '--verify', 'HEAD');
  const copie = copieDe(dossierCopies, nom);
  fs.mkdirSync(dossierCopies, { recursive: true });
  git(racine, ['worktree', 'add', '-q', '-b', brancheDe(nom), copie, 'HEAD']);
  try {
    // Les changements pas encore enregistrés dans git (fichiers suivis)
    const enCours = git(racine, ['diff', 'HEAD', '--binary'], { binaire: true });
    if (enCours.length) git(copie, ['apply', '--binary', '--whitespace=nowarn', '-'], { entree: enCours });
    // Les fichiers nouveaux, pas encore suivis (les fichiers ignorés par .gitignore restent dehors)
    const nouveaux = gitTexte(racine, 'ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
    for (const fichier of nouveaux.slice(0, MAX_FICHIERS_NON_SUIVIS)) {
      const source = path.join(racine, fichier);
      const infos = fs.lstatSync(source, { throwIfNoEntry: false });
      if (!infos?.isFile() || infos.size > MAX_NON_SUIVI) continue;
      fs.mkdirSync(path.dirname(path.join(copie, fichier)), { recursive: true });
      fs.copyFileSync(source, path.join(copie, fichier));
    }
    // Les dépendances servent aux tests : un lien vers celles du projet, pas une copie
    if (fs.existsSync(path.join(racine, 'node_modules')) && !fs.existsSync(path.join(copie, 'node_modules'))) {
      fs.symlinkSync(path.join(racine, 'node_modules'), path.join(copie, 'node_modules'), 'junction');
    }
    ajouterTout(copie);
    git(copie, [...IDENTITE, 'commit', '-q', '--allow-empty', '--no-verify', '-m', 'État de départ (copie de Cat Ai)']);
  } catch (err) {
    try { retirer(racine, nom, copie); } catch { /* rien à nettoyer */ }
    throw err;
  }
  const base = gitTexte(copie, 'rev-parse', 'HEAD');
  // Comparer les noms canoniques, même si Windows a fourni un chemin court 8.3.
  const sousDossier = path.relative(fs.realpathSync.native(racine), fs.realpathSync.native(projet));
  return { nom, copie, base, dossier: sousDossier ? path.join(copie, sousDossier) : copie };
}

// Ce que l'agent a changé depuis le départ : la liste des fichiers avec leurs lignes, et le patch à montrer
function changementsCopie(copie, base, { patch = false } = {}) {
  ajouterTout(copie);
  const fichiers = gitTexte(copie, 'diff', '--cached', '--numstat', '-z', base).split('\0').filter(Boolean).map((ligne) => {
    const [ajouts, retraits, ...chemin] = ligne.split('\t');
    return { chemin: chemin.join('\t'), ajouts: ajouts === '-' ? 0 : Number(ajouts), retraits: retraits === '-' ? 0 : Number(retraits), binaire: ajouts === '-' };
  });
  const total = fichiers.reduce((t, f) => ({ ajouts: t.ajouts + f.ajouts, retraits: t.retraits + f.retraits }), { ajouts: 0, retraits: 0 });
  const r = { fichiers, ...total };
  if (patch) {
    const texte = git(copie, ['diff', '--cached', base]);
    r.patch = texte.length > MAX_PATCH_AFFICHE ? texte.slice(0, MAX_PATCH_AFFICHE) + '\n… (la suite est trop longue pour être affichée)\n' : texte;
  }
  return r;
}

// Garder : les changements de la copie sont appliqués aux fichiers du projet (sans commit, l'utilisateur
// enregistre lui-même). Si le projet a changé depuis au même endroit, rien n'est appliqué.
function garderCopie(copie, base, nom) {
  const racine = depotDeLaCopie(copie);
  ajouterTout(copie);
  const patch = git(copie, ['diff', '--cached', '--binary', base], { binaire: true });
  if (patch.length) {
    try {
      git(racine, ['apply', '--check', '--binary', '--whitespace=nowarn', '-'], { entree: patch });
    } catch (err) {
      const detail = String(err.stderr || err.message).trim().split('\n')[0].slice(0, 200);
      return { ok: false, erreur: `Ton projet a changé aux mêmes endroits depuis : rien n'a été appliqué. Détail : ${detail}` };
    }
    git(racine, ['apply', '--binary', '--whitespace=nowarn', '-'], { entree: patch });
  }
  retirer(racine, nom, copie);
  return { ok: true };
}

// Jeter : la copie et sa branche disparaissent, le projet ne change pas
function jeterCopie(racine, nom) {
  retirer(racine, verifierNom(nom), trouverCopie(racine, nom));
  return { ok: true };
}

// Le lien vers node_modules est retiré d'abord : supprimer la copie en le suivant effacerait les vraies dépendances
function retirer(racine, nom, copie) {
  if (copie && fs.existsSync(copie)) {
    const lien = path.join(copie, 'node_modules');
    const infos = fs.lstatSync(lien, { throwIfNoEntry: false });
    if (infos?.isSymbolicLink()) fs.unlinkSync(lien);
    git(racine, ['worktree', 'remove', '--force', copie]);
  }
  try { git(racine, ['branch', '-D', brancheDe(nom)]); } catch { /* déjà supprimée */ }
}

module.exports = { NOM_COPIE, brancheDe, copieDe, trouverCopie, depotDeLaCopie, preparerCopie, changementsCopie, garderCopie, jeterCopie };
