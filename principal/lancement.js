// Prépare un chantier à partir de l'équipe de la page Agents : les mêmes agents pour l'app et pour `catai chantier`.
// Rien ici ne parle à un modèle : on reçoit de quoi envoyer (local et en ligne), on rend ce que lancerChantier attend.
const { execFileSync } = require('child_process');
const { equipeDepuis, planDeTravail } = require('./equipe');

// opts :
//   reglages          contenu de fournisseurs.json
//   infos(id)         { type, baseUrl } d'un fournisseur, ou null
//   envoyerLocal      envoyerOllama
//   envoyerEnLigne    (fournisseurId) => envoyer(messages, modele, …) ; c'est lui qui vérifie la gratuité et la clé
//   limitesLocales    LIMITES_OLLAMA
//   dire(texte)       pour prévenir quand un agent en ligne est remplacé
//   limitesEnLigne    (fournisseurId) => limites de taille de ce fournisseur, ou null s'il n'en a pas
//   chefForce         fournisseur du chef imposé (catai --chef), modeleForce : modèle du premier codeur (catai -m),
//                     codeurForce : fournisseur de tous les codeurs (catai --codeur)
// Renvoie { chef, codeurs, resume } ; resume est une ligne lisible : qui fait quoi.
function agentsDuChantier({ reglages, infos, envoyerLocal, envoyerEnLigne, limitesLocales, limitesEnLigne = () => null, dire = () => {}, chefForce, modeleForce, codeurForce }) {
  const equipe = planDeTravail(equipeDepuis(reglages, infos));
  const modeleLocal = modeleForce || equipe.codeurs[0].modele || reglages.modeles?.ollama || 'qwen3:8b';
  const secours = { envoyer: envoyerLocal, modele: modeleLocal };

  // Un agent qui parle sans coder (chef, relecteur, lecteur de logs) : sur le PC ou en ligne.
  // S'il ne répond pas (clé illisible, quota du jour), le modèle du PC prend sa place, et on le dit.
  const agentSur = (nom, choix) => {
    const local = choix.fournisseur === 'ollama';
    let agent = local ? { envoyer: envoyerLocal, modele: choix.modele || modeleLocal } : { envoyer: envoyerEnLigne(choix.fournisseur), modele: choix.modele };
    return {
      get modele() { return agent.modele; },
      nom: () => (agent === secours || local ? agent.modele : `${choix.fournisseur} ${agent.modele}`),
      surLePc: () => local || agent === secours,
      envoyer: async (...args) => {
        try { return await agent.envoyer(args[0], agent.modele, ...args.slice(2)); } catch (err) {
          if (err.name === 'AbortError' || agent === secours) throw err;
          dire(`${nom} indisponible (${String(err.message).split('\n')[0].slice(0, 160)}) : ${modeleLocal} le remplace.`);
          agent = secours;
          return agent.envoyer(args[0], agent.modele, ...args.slice(2));
        }
      },
    };
  };
  // Un même agent de l'arbre (un relecteur sous le chef, par exemple) sert à tous les codeurs
  const dejaFaits = new Map();
  const agentDe = (a) => dejaFaits.get(a.id) || dejaFaits.set(a.id, agentSur(a.nom, a)).get(a.id);
  const chef = chefForce ? agentSur('Chef', { fournisseur: chefForce, modele: reglages.modeles?.[chefForce] }) : agentDe(equipe.chef);
  const codeurs = equipe.codeurs.map((c, i) => {
    const controles = c.controles.map((k) => (k.type === 'tests'
      ? { type: 'tests', logs: k.logs ? agentDe(k.logs) : null }
      : { type: 'relecture', nom: k.nom, envoyer: agentDe(k.agent).envoyer, modele: k.agent.modele }));
    const choix = codeurForce ? { fournisseur: codeurForce, modele: reglages.modeles?.[codeurForce] } : c;
    if (choix.fournisseur === 'ollama') {
      const modele = (i === 0 ? modeleLocal : choix.modele) || modeleLocal;
      return { nom: c.nom, specialite: c.specialite, envoyer: envoyerLocal, limites: limitesLocales, modele, local: true, qui: () => modele, controles };
    }
    // Un codeur en ligne : plus fort, mais s'il n'a plus de quota le modèle du PC reprend, avec ses propres limites
    const agent = agentSur(c.nom, choix);
    return {
      nom: c.nom, specialite: c.specialite, envoyer: agent.envoyer, controles, qui: agent.nom,
      get modele() { return agent.modele; },
      get limites() { return agent.surLePc() ? limitesLocales : limitesEnLigne(choix.fournisseur); },
      get local() { return agent.surLePc(); },
    };
  });
  const autres = [...new Set([...dejaFaits.values()].filter((a) => a !== chef).map((a) => a.nom()))];
  const quiCode = codeurs.length > 1 ? `codeurs ${codeurs.map((c) => `${c.nom} (${c.qui()})`).join(', ')}` : `codeur ${codeurs[0].qui()}`;
  return { chef, codeurs, resume: `chef ${chef.nom()} · ${quiCode}${autres.length ? ` · contrôles : ${autres.join(', ')}` : ''}` };
}

const git = (dossier, ...args) => execFileSync('git', args, { cwd: dossier, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// Un chantier travaille sur une copie git du projet : il faut un dépôt avec au moins un commit.
// Renvoie { pret: true, modifs } (modifs : nombre de fichiers changés et pas encore committés, absents de la copie),
// ou { pret: false, raison: 'git-absent' | 'pas-de-depot' | 'pas-de-commit' }.
function etatDepot(dossier) {
  try { git(dossier, '--version'); } catch { return { pret: false, raison: 'git-absent' }; }
  try { git(dossier, 'rev-parse', '--show-toplevel'); } catch { return { pret: false, raison: 'pas-de-depot' }; }
  try { git(dossier, 'rev-parse', '--verify', 'HEAD'); } catch { return { pret: false, raison: 'pas-de-commit' }; }
  return { pret: true, modifs: git(dossier, 'status', '--porcelain').split('\n').filter(Boolean).length };
}

const MESSAGES_DEPOT = {
  'git-absent': "Git n'est pas installé sur ce PC : le chantier en a besoin pour travailler sur une copie.",
  'pas-de-depot': "Ce dossier n'est pas suivi par git : le chantier en a besoin pour travailler sur une copie.",
  'pas-de-commit': "Ce dossier n'a encore aucune version enregistrée dans git : le chantier a besoin d'un point de départ.",
};

// Met le dossier sous git avec une première version, pour qu'un chantier puisse partir. À n'appeler qu'après
// l'accord de l'utilisateur : cela crée un dossier .git dans son projet.
function preparerDepot(dossier) {
  const etat = etatDepot(dossier);
  if (etat.raison === 'git-absent') throw new Error(MESSAGES_DEPOT['git-absent']);
  if (etat.raison === 'pas-de-depot') git(dossier, 'init', '-q');
  git(dossier, 'add', '-A');
  git(dossier, '-c', 'user.name=Cat Ai', '-c', 'user.email=chantier@cat-ai.invalid', 'commit', '-q', '--allow-empty', '-m', 'Point de départ avant le premier chantier');
  return etatDepot(dossier);
}

// Garde le travail d'un chantier : fusionne sa branche dans le projet. Refusé si le projet a des changements en
// cours (la fusion pourrait les mélanger) ; en cas de conflit, la fusion est annulée et rien ne change.
function garderChantier(dossier, nom) {
  const branche = `catai/chantier-${nom}`;
  const racine = git(dossier, 'rev-parse', '--show-toplevel');
  if (git(racine, 'status', '--porcelain', '--untracked-files=no')) return { ok: false, erreur: 'Ton projet a des changements en cours : enregistre-les (commit) ou annule-les avant de garder le travail du chantier.' };
  try {
    git(racine, '-c', 'user.name=Cat Ai', '-c', 'user.email=chantier@cat-ai.invalid', 'merge', '--no-edit', branche);
    return { ok: true };
  } catch (err) {
    try { git(racine, 'merge', '--abort'); } catch { /* aucune fusion en cours */ }
    return { ok: false, erreur: `La fusion n'a pas pu se faire toute seule, rien n'a été changé. Détail : ${String(err.stderr || err.message).trim().split('\n')[0].slice(0, 200)}` };
  }
}

// Ce qu'un chantier a changé, en court : la liste des fichiers avec le nombre de lignes
function resumeChantier(dossier, nom) {
  try { return git(dossier, 'diff', '--stat', `HEAD...catai/chantier-${nom}`); } catch { return ''; }
}

module.exports = { agentsDuChantier, etatDepot, MESSAGES_DEPOT, preparerDepot, garderChantier, resumeChantier };
