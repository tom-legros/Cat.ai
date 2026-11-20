// L'agent seul (docs/conception-agents.md, mode Rapide) : une mission de A à Z, sans équipe.
// Il travaille dans une copie git du projet (la même que le mode Auto du chat), lit, modifie, lance lui-même les tests.
// Après chaque essai, un programme vérifie : a-t-il changé quelque chose ? les tests du projet passent-ils ? Sinon il
// recommence avec la raison, dans la limite de ses essais. Il ne pose jamais de question : c'est une tâche de fond.
// À la fin : un commit dans la copie et un rapport. Le projet ne change que si l'utilisateur garde le travail.
const { execFileSync } = require('child_process');
const { discuter } = require('./agent');
const { listFiles } = require('./fichiers');
const { listeCourte } = require('./taille');
const { lancerTestsNode } = require('./tests-projet');
const { preparerCopie, changementsCopie } = require('./copie-agent');
const { avisDepuis } = require('./chantier');

const ESSAIS_MISSION = 3;
const OUTILS_MISSION = ['lister_fichiers', 'lire_fichier', 'chercher', 'ecrire_fichier', 'remplacer_texte', 'lancer_tests'];
const aDesTests = (dossier) => listFiles(dossier).some((f) => /[.-]test\.[cm]?js$|(^|\/)tests?\/.*\.[cm]?js$/.test(f));

const CONSIGNE_MISSION = `Tu es un développeur qui travaille SEUL sur une mission, sans personne pour répondre à tes questions.
1. Lis d'abord les fichiers concernés (lire_fichier, chercher).
2. Fais TOUS les changements demandés, et seulement eux : remplacer_texte pour modifier un fichier existant (copie le
   passage exactement), ecrire_fichier pour créer un fichier. Pense à exporter ce que tu ajoutes et à mettre à jour
   les fichiers qui utilisent ce que tu renommes.
3. Si le projet a des tests, lance-les avec lancer_tests quand tu as fini, et corrige jusqu'à ce qu'ils passent.
   N'ajoute pas de tests que la mission ne demande pas.
Si une phrase peut se lire de deux façons, prends le sens le plus raisonnable pour un développeur et dis-le à la fin.
Termine par un bilan de trois lignes au plus : ce que tu as changé, et ce qui reste douteux.`;

// La relecture finale : les tests visibles d'un projet couvrent rarement la nouveauté (mesuré avec le banc d'essai : un
// renommage sans test, des fonctions neuves dont seul l'ancien code est testé). Une question au même modèle rattrape
// les oublis, sans équipe.
const CONSIGNE_RELECTURE_MISSION = `Tu relis le travail d'un développeur : la mission, puis son changement (diff git).
Le changement remplit-il TOUTE la mission ? Vérifie chaque point demandé : fonctions ajoutées ET exportées, renommage
fait partout où le nom était utilisé, cas particuliers cités dans la mission, liste ou objet reçu non modifié si la
mission le demande. Le diff ne montre que les lignes modifiées et leur voisinage : une ligne absente du diff peut exister.
Si une phrase peut se lire de deux façons, prends le sens le plus raisonnable. Refuse seulement un oubli ou une erreur nette.
Réponds UNIQUEMENT avec du JSON : {"ok": true} ou {"ok": false, "remarque": "ce qu'il manque ou ce qui est faux, précisément"}.`;

const horodatage = (d = new Date()) => {
  const z = (n) => String(n).padStart(2, '0');
  return `mission-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
};

async function lancerMission({ projet, demande, modele, envoyer, limites, dossierCopies, nom = horodatage(), essais = ESSAIS_MISSION, relecture = true, signal, ev = {} }) {
  const copie = preparerCopie(projet, dossierCopies, nom);
  const dossier = copie.dossier;
  ev.info?.(`Copie de travail : ${copie.copie} (branche catai/agent-${nom})`);
  const ctx = {
    projet: () => dossier, ouvrirProjet: () => {}, reglages: () => ({}), dossierDocuments: dossier, prof: false,
    liensDonnes: [], documentsJoints: new Set(), signal, maxExtrait: limites ? limites.resultatOutil - 500 : 20000,
    fournisseurLocal: true, nomFournisseur: '',
    // Tout se passe dans la copie, et la mission a été confiée : les écritures et les tests sont acceptés sans fenêtre
    ui: { demander: async () => !signal?.aborted, confirmerEcriture: async () => !signal?.aborted, choisirExecutable: async () => null },
  };
  const tests = aDesTests(dossier);
  const { fichiers } = listeCourte(listFiles(dossier), 3000);
  let messages = [
    { role: 'system', content: CONSIGNE_MISSION },
    { role: 'user', content: `Ta mission :\n${demande}\n\nFichiers du projet :\n${fichiers.join('\n')}${tests ? '\n\nLe projet a des tests : lance-les avec lancer_tests quand tu as fini.' : ''}` },
  ];
  let bilan = '';
  let etatTests = tests ? 'non lancés' : 'aucun test';
  let ok = false;
  let essai = 0;
  let aVerifier = '';
  while (essai < essais && !ok) {
    essai++;
    signal?.throwIfAborted();
    ev.essai?.(essai, essais);
    const { historique } = await discuter({
      messages, modele, envoyer, limites, ctx,
      options: { seulement: OUTILS_MISSION, projet: true, documents: false, arreterSurBoucle: true },
      ev: { outil: (n, a) => ev.outil?.(n, a), action: (a) => ev.info?.(`  ${a}`) },
    });
    signal?.throwIfAborted();
    bilan = String(historique.at(-1)?.content || '').trim();
    // La vérification par programme : un changement, puis les tests du projet
    let remarque = '';
    if (!changementsCopie(copie.copie, copie.base).fichiers.length) {
      remarque = "Tu n'as modifié aucun fichier. Fais maintenant les changements demandés avec remplacer_texte ou ecrire_fichier.";
    } else if (tests) {
      const sortie = await lancerTestsNode(dossier, signal);
      signal?.throwIfAborted();
      etatTests = sortie.startsWith('Tests réussis') ? 'réussis' : 'échec';
      if (etatTests === 'échec') remarque = `Les tests du projet échouent. Corrige le code (pas les tests, sauf s'ils sont faux par rapport à la mission) :\n${sortie.slice(0, 3000)}`;
    }
    // Les programmes ont dit oui : une relecture de la mission entière, par le même modèle
    if (!remarque && relecture) {
      const { patch } = changementsCopie(copie.copie, copie.base, { patch: true });
      let texte = '';
      const { content } = await envoyer([
        { role: 'system', content: CONSIGNE_RELECTURE_MISSION },
        { role: 'user', content: `La mission :\n${demande}\n\nLe changement :\n${String(patch || '').slice(0, 12000)}` },
      ], modele, (t) => { texte += t; }, signal, { seulement: [] });
      signal?.throwIfAborted();
      const avis = avisDepuis(content || texte);
      if (!avis.ok) {
        // Au dernier essai, le travail est gardé et marqué « à vérifier » plutôt que jeté (une tâche de fond)
        if (essai < essais) remarque = `Ta relecture a trouvé un problème. Corrige-le : ${avis.remarque}`;
        else { aVerifier = avis.remarque; ev.info?.(`  gardée, à vérifier : ${avis.remarque.split('\n')[0].slice(0, 140)}`); }
      }
    }
    ev.info?.(remarque ? `  essai ${essai} : ${remarque.split('\n')[0].slice(0, 140)}` : `  essai ${essai} : réussi`);
    if (!remarque) { ok = true; break; }
    messages = [...historique, { role: 'user', content: remarque }];
  }
  const changements = changementsCopie(copie.copie, copie.base);
  if (changements.fichiers.length) {
    execFileSync('git', ['-c', 'user.name=Cat Ai', '-c', 'user.email=chantier@cat-ai.invalid', 'commit', '-q', '--no-verify', '-m', `Mission : ${demande.split('\n')[0].slice(0, 70)}`], { cwd: copie.copie, windowsHide: true, stdio: 'ignore' });
  }
  const statut = ok ? (aVerifier ? 'réussie, à vérifier' : 'réussie') : changements.fichiers.length ? 'en partie' : 'ratée';
  const rapport = [
    `# Mission ${statut}`, '',
    `Essais : ${essai}/${essais} · tests : ${etatTests} · ${changements.fichiers.length} fichier(s) modifié(s) (+${changements.ajouts} −${changements.retraits})`,
    ...changements.fichiers.map((f) => `- ${f.chemin} (+${f.ajouts} −${f.retraits})`),
    ...(aVerifier ? ['', `La relecture doutait : ${aVerifier.slice(0, 600)}`] : []),
    '', bilan ? `Bilan de l'agent :\n${bilan.slice(0, 1500)}` : "L'agent n'a pas écrit de bilan.",
  ].join('\n');
  return { ok, statut, nom, copie: copie.copie, base: copie.base, essais: essai, tests: etatTests, changements, bilan, rapport, ...(aVerifier ? { aVerifier } : {}) };
}

module.exports = { lancerMission, CONSIGNE_MISSION, CONSIGNE_RELECTURE_MISSION, OUTILS_MISSION, ESSAIS_MISSION };
