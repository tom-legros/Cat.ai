// Mode chantier : coder pendant que l'utilisateur n'est pas là, à partir d'un plan détaillé.
//
//   chef         découpe le plan en petites étapes et donne chacune à un codeur (le modèle le plus malin dispo)
//   codeurs      codent une étape avec les outils du projet (un modèle local : gratuit, sans limite)
//   contrôles    après chaque étape, dans l'ordre : les tests du projet, puis les relecteurs. Une étape ne passe
//                que si tous acceptent. Un lecteur de logs peut expliquer au codeur pourquoi les tests cassent.
// L'équipe se compose dans la page Agents de l'app (principal/equipe.js).
//
// Tout se passe dans une COPIE : une branche git à part, dans un dossier à part (git worktree). L'ouvrier y écrit
// sans fenêtre de confirmation, puisque rien ne touche aux fichiers de l'utilisateur ; chaque étape réussie y est
// committée. À la fin, un rapport dit ce qui a été fait, et l'utilisateur garde ce qu'il veut (git merge, ou rien).
// C'est le garde-fou « rien n'est écrit sans accord », validé à la fin plutôt qu'à chaque fichier.
// Sans surveillance, l'ouvrier ne lit aucun fichier sensible, n'ouvre aucune page non trouvée par lui-même,
// et n'a pas internet ni d'autre dossier.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { discuter } = require('./agent');
const { listFiles } = require('./fichiers');
const { lancerTestsNode } = require('./tests-projet');

// Ce que fait un codeur, dit simplement dans le suivi du chantier
const GESTES = { lister_fichiers: 'regarde les fichiers', lire_fichier: 'lit', chercher: 'cherche', ecrire_fichier: 'écrit', remplacer_texte: 'modifie' };
const ESSAIS_PAR_ETAPE = 3;
const MAX_ETAPES = 15;
const OUTILS_OUVRIER = ['lister_fichiers', 'lire_fichier', 'chercher', 'ecrire_fichier', 'remplacer_texte'];

const git = (dossier, ...args) => execFileSync('git', args, { cwd: dossier, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// ---------- Ce que le chef répond : du JSON, parfois entouré de texte ou d'un bloc ``` ----------
function lireJson(texte) {
  const t = String(texte || '');
  // Du premier [ ou { jusqu'à un ] ou } : on essaie en partant de la fin, jusqu'à trouver un JSON valide
  for (let debut = t.search(/[[{]/); debut >= 0 && debut < t.length; debut = t.slice(debut + 1).search(/[[{]/) + debut + 1 || -1) {
    for (let fin = t.length; fin > debut; fin--) {
      if (t[fin - 1] !== ']' && t[fin - 1] !== '}') continue;
      try { return JSON.parse(t.slice(debut, fin)); } catch { /* plus court */ }
    }
    if (t.slice(debut + 1).search(/[[{]/) < 0) break;
  }
  return null;
}

// Les étapes du plan : [{ titre, consigne }], au plus MAX_ETAPES
function etapesDepuis(reponse) {
  const j = lireJson(reponse);
  const liste = Array.isArray(j) ? j : Array.isArray(j?.etapes) ? j.etapes : [];
  return liste
    .map((e) => ({ titre: String(e?.titre || '').trim().slice(0, 120), consigne: String(e?.consigne || '').trim().slice(0, 2000), ...(e?.agent ? { agent: String(e.agent).trim().slice(0, 40) } : {}) }))
    .filter((e) => e.titre && e.consigne)
    .slice(0, MAX_ETAPES);
}

// L'avis du chef sur une étape : { ok, remarque }
function avisDepuis(reponse) {
  const j = lireJson(reponse);
  if (j && typeof j.ok === 'boolean') return { ok: j.ok, remarque: String(j.remarque || '').slice(0, 1500) };
  // Pas de JSON lisible : on ne valide pas une étape sur un malentendu
  return { ok: false, remarque: 'Le relecteur n\'a pas répondu clairement : refais l\'étape en suivant exactement la consigne.' };
}

// Une seule réponse, sans outils (le chef parle, il ne touche à rien)
async function demander(envoyer, modele, messages, signal) {
  let texte = '';
  const { content } = await envoyer(messages, modele, (t) => { texte += t; }, signal, { seulement: [] });
  return content || texte;
}

const CONSIGNE_DECOUPE = `Tu es le chef de chantier d'un petit programme qui code seul, étape par étape, avec un modèle local assez modeste.
Découpe le plan ci-dessous en étapes PETITES et précises (une fonction, un fichier, un test), dans l'ordre où les faire.
Si le plan est déjà une liste d'étapes, garde ces étapes : ne les multiplie pas.
N'ajoute AUCUNE étape de vérification, de relecture, de test à lancer ou de « finalisation » : les tests sont lancés
automatiquement après chaque étape. Ne refais pas ce qui existe déjà dans le projet.
Chaque consigne doit se suffire à elle-même : nomme les fichiers et les fonctions, dis exactement quoi changer.
Réponds UNIQUEMENT avec du JSON, sans rien autour : [{"titre": "...", "consigne": "..."}, ...] (15 étapes au plus).`;

// Avec plusieurs codeurs, le chef dit lequel fait chaque étape
const consigneEquipe = (codeurs) => `

Plusieurs codeurs sont disponibles. Donne chaque étape à celui qui convient le mieux, avec son nom exact :
${codeurs.map((c) => `- ${c.nom}${c.specialite ? ` : ${c.specialite}` : ''}`).join('\n')}
Le JSON devient : [{"titre": "...", "consigne": "...", "agent": "nom du codeur"}, ...]`;

const CONSIGNE_LOGS = `Des tests échouent après le changement d'un autre modèle. Lis leur sortie et le changement.
Réponds en 5 lignes au plus, sans réécrire le code : quel test casse, pourquoi, et quoi corriger précisément (fichier, fonction).`;

// Dans la sortie des tests, les lignes qui disent ce qui casse : le nom du test raté et l'erreur
function lignesEchec(sortie) {
  const utiles = String(sortie).split('\n').map((l) => l.trim())
    .filter((l) => /^(✖|not ok)|Error|expected|actual|Cannot find|is not (a function|defined)/i.test(l) && !/^ℹ/.test(l));
  return [...new Set(utiles)].slice(0, 6).join('\n');
}

const CONSIGNE_RELECTURE = `Tu relis une étape faite par un autre modèle. Compare le changement (diff git) à la consigne de l'étape.
Accepte si la consigne est remplie, même si ce n'est pas parfait. Refuse si c'est faux, incomplet, hors sujet ou si ça casse autre chose.
Réponds UNIQUEMENT avec du JSON : {"ok": true} ou {"ok": false, "remarque": "ce qu'il faut corriger, précisément"}.`;

const consigneOuvrier = (plan, etape, faites, remarque) => `Tu travailles seul, sans personne à qui poser de questions, sur un chantier de code.
Le plan général (pour le contexte seulement) :
${plan.slice(0, 3000)}

Étapes déjà faites : ${faites.length ? faites.map((e) => e.titre).join(' ; ') : 'aucune'}.

TON ÉTAPE, et rien d'autre : ${etape.titre}
${etape.consigne}
${remarque ? `\nLa tentative précédente a été refusée : ${remarque}\n` : ''}
Lis les fichiers dont tu as besoin, puis modifie-les avec remplacer_texte (ou ecrire_fichier pour un nouveau fichier).
Les modifications sont appliquées directement. Quand l'étape est faite, réponds en une phrase ce que tu as changé.`;

// ---------- Le chantier ----------
// opts :
//   projet           dossier du projet (dépôt git)
//   plan             texte du plan
//   chef             { envoyer, modele } (envoyer : même forme qu'envoyerOllama)
//   codeurs          [{ nom, specialite, envoyer, modele, limites, controles }], controles dans l'ordre :
//                      { type: 'tests', logs?: { envoyer, modele } }   les tests du projet, s'il en a
//                      { type: 'relecture', nom, envoyer, modele }    un relecteur
//   ouvrier / verificateur   l'ancienne forme, sans équipe : un codeur, les tests, puis une relecture (par le chef
//                    si verificateur n'est pas donné)
//   dossierCopies    où créer la copie de travail
//   ev               { etape(i, n, titre), info(texte), morceau(texte) } pour suivre l'avancement
//   signal           pour arrêter
// Renvoie { branche, copie, etapes: [{ titre, ok, essais, raison? }], rapport }
async function lancerChantier({ projet, plan, chef, codeurs, ouvrier, verificateur = chef, dossierCopies, ev = {}, signal, nom = horodatage() }) {
  codeurs ||= [{ ...ouvrier, nom: 'Codeur', controles: [{ type: 'tests' }, { type: 'relecture', nom: 'relecture', envoyer: verificateur.envoyer, modele: verificateur.modele }] }];
  if (!codeurs.length) throw new Error('Il faut au moins un codeur.');
  const racine = git(projet, 'rev-parse', '--show-toplevel');
  const branche = `catai/chantier-${nom}`;
  const copie = path.join(dossierCopies, `chantier-${nom}`);
  fs.mkdirSync(dossierCopies, { recursive: true });
  git(racine, 'worktree', 'add', '-b', branche, copie, 'HEAD');
  // Les dépendances du projet servent aux tests : un lien vers celles du projet, pas une copie
  if (fs.existsSync(path.join(racine, 'node_modules')) && !fs.existsSync(path.join(copie, 'node_modules'))) {
    fs.symlinkSync(path.join(racine, 'node_modules'), path.join(copie, 'node_modules'), 'junction');
  }
  const aDesTests = () => listFiles(copie).some((f) => /\.test\.[cm]?js$|(^|\/)test\/.*\.[cm]?js$/.test(f));

  ev.info?.(`Copie de travail : ${copie} (branche ${branche})`);
  const decoupe = await demander(chef.envoyer, chef.modele, [
    { role: 'system', content: CONSIGNE_DECOUPE + (codeurs.length > 1 ? consigneEquipe(codeurs) : '') },
    { role: 'user', content: `Fichiers du projet :\n${listFiles(copie).slice(0, 200).join('\n')}\n\nLe plan :\n${plan}` },
  ], signal);
  const etapes = etapesDepuis(decoupe);
  if (!etapes.length) throw new Error("Le chef n'a pas réussi à découper le plan en étapes. Écris un plan plus précis (une liste de choses à faire).");

  // Un codeur écrit sans fenêtre, seulement dans la copie (cheminSur l'empêche d'en sortir) ; tout le reste est refusé
  const ctxPour = (codeur) => ({
    projet: () => copie, ouvrirProjet: () => {}, reglages: () => ({}), dossierDocuments: copie, prof: false,
    liensDonnes: [], documentsJoints: new Set(), signal, maxExtrait: codeur.limites ? codeur.limites.resultatOutil - 500 : 20000,
    fournisseurLocal: true, nomFournisseur: '',
    ui: { demander: async () => false, confirmerEcriture: async () => true, choisirExecutable: async () => null },
  });
  // Le codeur nommé par le chef, sinon le premier
  const codeurDe = (etape) => codeurs.find((c) => c.nom.toLowerCase() === etape.agent?.toLowerCase()) || codeurs[0];

  // Un contrôle après l'essai d'une étape. Renvoie '' si c'est bon, sinon la remarque pour le codeur.
  async function controler(controle, etape, diff) {
    if (controle.type === 'tests') {
      if (!aDesTests()) return '';
      const bilan = await lancerTestsNode(copie, signal);
      if (bilan.startsWith('Tests réussis')) { ev.info?.('  tests : réussis'); return ''; }
      const echec = lignesEchec(bilan);
      ev.info?.(`  tests : échec${echec ? ` (${echec.split('\n')[0].slice(0, 100)})` : ''}`);
      let diagnostic = '';
      if (controle.logs) {
        try {
          diagnostic = (await demander(controle.logs.envoyer, controle.logs.modele, [
            { role: 'system', content: CONSIGNE_LOGS },
            { role: 'user', content: `Consigne de l'étape : ${etape.titre}\n${etape.consigne}\n\nLe changement :\n${diff.slice(0, 4000)}\n\nSortie des tests :\n${bilan.slice(0, 6000)}` },
          ], signal)).trim().slice(0, 1200);
          if (diagnostic) ev.info?.(`  logs : ${diagnostic.split('\n')[0].slice(0, 120)}`);
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          ev.info?.(`  logs : pas de diagnostic (${err.message})`);
        }
      }
      const resume = diagnostic ? `Diagnostic :\n${diagnostic}` : echec ? `En bref :\n${echec}` : '';
      return `Les tests échouent après ton changement. ${resume ? `${resume}\n\nSortie complète :\n` : ''}${bilan.slice(0, 3000)}`;
    }
    const avis = avisDepuis(await demander(controle.envoyer, controle.modele, [
      { role: 'system', content: CONSIGNE_RELECTURE },
      { role: 'user', content: `Consigne de l'étape : ${etape.titre}\n${etape.consigne}\n\nLe changement :\n${diff.slice(0, 12000)}` },
    ], signal));
    if (avis.ok) return '';
    ev.info?.(`  ${controle.nom || 'relecture'} : refusée (${avis.remarque.slice(0, 120)})`);
    return avis.remarque || 'Le relecteur a refusé cette étape.';
  }
  const resultats = [];
  // Un arrêt demandé en cours d'étape n'est pas une panne : on garde ce qui est fait et on rend le rapport
  try {
  for (const [i, etape] of etapes.entries()) {
    if (signal?.aborted) break;
    const codeur = codeurDe(etape);
    ev.etape?.(i + 1, etapes.length, codeurs.length > 1 ? `${etape.titre} (${codeur.nom})` : etape.titre);
    let remarque = '';
    let reussie = false;
    let essais = 0;
    while (!reussie && essais < ESSAIS_PAR_ETAPE && !signal?.aborted) {
      essais++;
      // Chaque essai repart de l'état de l'étape précédente
      git(copie, 'reset', '--hard', '-q');
      git(copie, 'clean', '-fdq', '-e', 'node_modules');
      await discuter({
        messages: [{ role: 'user', content: consigneOuvrier(plan, etape, resultats.filter((r) => r.ok), remarque) }],
        modele: codeur.modele, envoyer: codeur.envoyer, limites: codeur.limites, ctx: ctxPour(codeur),
        options: { seulement: OUTILS_OUVRIER, projet: true, documents: false },
        ev: { morceau: ev.morceau, outil: (nom, a) => ev.info?.(`  ${GESTES[nom] || nom} ${a?.chemin || a?.texte || a?.dossier || ''}`.trimEnd()) },
      });
      git(copie, 'add', '-A');
      const diff = git(copie, 'diff', '--cached');
      if (!diff) { remarque = "Rien n'a été modifié. Fais vraiment les changements demandés avec les outils."; continue; }
      remarque = '';
      for (const controle of codeur.controles || []) {
        remarque = await controler(controle, etape, diff);
        if (remarque) break;
      }
      if (remarque) continue;
      git(copie, '-c', 'user.name=Cat Ai', '-c', 'user.email=chantier@cat-ai.invalid', 'commit', '-q', '-m', `Chantier, étape ${i + 1} : ${etape.titre}`);
      reussie = true;
    }
    resultats.push({ titre: etape.titre, ok: reussie, essais, raison: reussie ? '' : remarque });
    ev.info?.(reussie ? `  étape ${i + 1} faite` : `  étape ${i + 1} abandonnée après ${essais} essais`);
    // Une étape ratée : on s'arrête, les suivantes s'appuieraient sur elle
    if (!reussie) break;
  }
  } catch (err) {
    if (!signal?.aborted) throw err;
    ev.info?.('Arrêt demandé : le chantier s\'arrête ici.');
  }
  git(copie, 'reset', '--hard', '-q');
  git(copie, 'clean', '-fdq', '-e', 'node_modules');
  const rapport = rapportChantier({ branche, copie, etapes, resultats, racine });
  return { branche, copie, etapes: resultats, rapport };
}

function rapportChantier({ branche, copie, etapes, resultats, racine }) {
  const faites = resultats.filter((r) => r.ok).length;
  const lignes = [`# Rapport du chantier`, '', `${faites} étape${faites > 1 ? 's' : ''} sur ${etapes.length} faite${faites > 1 ? 's' : ''}.`, ''];
  etapes.forEach((e, i) => {
    const r = resultats[i];
    lignes.push(`${i + 1}. ${r ? (r.ok ? '[fait]' : '[bloqué]') : '[pas commencé]'} ${e.titre}${r && !r.ok && r.raison ? `\n   Raison : ${r.raison.split('\nSortie complète')[0].replace(/\n+/g, ' / ').slice(0, 400)}` : ''}`);
  });
  lignes.push('', `Le travail est sur la branche ${branche}, dans ${copie}.`, '', 'Pour voir les changements :', `  git -C "${racine}" diff HEAD...${branche}`, 'Pour les garder :', `  git -C "${racine}" merge ${branche}`, 'Pour tout jeter (la copie et la branche) :', `  catai chantier --jeter ${branche.replace('catai/chantier-', '')}`);
  return lignes.join('\n');
}

// Jette une copie de chantier et sa branche. Le lien vers node_modules est retiré d'abord : supprimer le dossier
// en le suivant effacerait les dépendances du vrai projet.
function jeterChantier(projet, nom) {
  const racine = git(projet, 'rev-parse', '--show-toplevel');
  const branche = `catai/chantier-${nom}`;
  const copie = git(racine, 'worktree', 'list', '--porcelain').split(/\r?\n\r?\n/)
    .find((b) => b.includes(`branch refs/heads/${branche}`))?.match(/^worktree (.+)$/m)?.[1];
  if (copie) {
    const lien = path.join(copie, 'node_modules');
    if (fs.existsSync(lien) && fs.lstatSync(lien).isSymbolicLink()) fs.unlinkSync(lien);
    git(racine, 'worktree', 'remove', '--force', copie);
  }
  git(racine, 'branch', '-D', branche);
  return { branche, copie };
}

function horodatage(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`;
}

module.exports = { lancerChantier, jeterChantier, lignesEchec, etapesDepuis, avisDepuis, lireJson, rapportChantier, OUTILS_OUVRIER, ESSAIS_PAR_ETAPE };
