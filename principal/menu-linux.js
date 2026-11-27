// Linux : une AppImage n'apparaît dans aucun menu, ce n'est qu'un fichier qu'on lance. Au premier lancement,
// l'app propose de s'ajouter au menu des applications (fichier .desktop + icône dans ~/.local/share, sans
// droits administrateur), comme une app installée. Ensuite, à chaque lancement, l'entrée est remise à jour
// en silence : la mise à jour automatique change le nom du fichier (Cat-Ai-1.1.0.AppImage → 1.1.1…).
//
// Tout est injecté (chemins, question, choix enregistré) : ces fonctions se testent sans Electron ni Linux.
const fs = require('fs');
const path = require('path');

const NOM_DESKTOP = 'cat-ai.desktop';
const NOM_ICONE = 'cat-ai';
// Repère notre propre fichier : on ne touche jamais à une entrée faite par l'utilisateur ou un autre outil
const MARQUE = 'X-CatAi-Menu=1';

// Chemin pour la ligne Exec d'un .desktop : entre guillemets, avec " ` $ et \ échappés (spécification freedesktop)
const cheminExec = (chemin) => `"${String(chemin).replace(/([\\"`$])/g, '\\$1')}"`;

function contenuDesktop({ appimage, nomFenetre }) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Cat Ai',
    'Comment=Un chat noir en pixel art qui t\'aide pour tout, 100 % gratuit',
    `Exec=${cheminExec(appimage)} %U`,
    `Icon=${NOM_ICONE}`,
    'Terminal=false',
    'Categories=Utility;Development;',
    'Keywords=IA;assistant;chat;Ollama;',
    `StartupWMClass=${nomFenetre}`,
    MARQUE,
    '',
  ].join('\n');
}

// Résultat : 'ajoute', 'mis-a-jour', 'deja', 'refuse' ou 'autre' (une entrée cat-ai.desktop qui n'est pas la nôtre)
async function integrerMenu({ appimage, dossierDonnees, icone, nomFenetre, choix, demander, enregistrerChoix }) {
  const fichier = path.join(dossierDonnees, 'applications', NOM_DESKTOP);
  const contenu = contenuDesktop({ appimage, nomFenetre });
  const actuel = fs.existsSync(fichier) ? fs.readFileSync(fichier, 'utf8') : null;
  if (actuel !== null && !actuel.includes(MARQUE)) return 'autre';
  if (actuel === contenu) return 'deja';
  // Déjà accepté une fois (l'entrée existe) : on la remet à jour sans redemander
  if (actuel === null) {
    if (choix === 'non') return 'refuse';
    const accepte = await demander();
    enregistrerChoix(accepte ? 'oui' : 'non');
    if (!accepte) return 'refuse';
  }
  const dossierIcone = path.join(dossierDonnees, 'icons', 'hicolor', '256x256', 'apps');
  fs.mkdirSync(dossierIcone, { recursive: true });
  fs.writeFileSync(path.join(dossierIcone, `${NOM_ICONE}.png`), icone);
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  fs.writeFileSync(fichier, contenu, { mode: 0o755 });
  return actuel === null ? 'ajoute' : 'mis-a-jour';
}

module.exports = { MARQUE, cheminExec, contenuDesktop, integrerMenu };
