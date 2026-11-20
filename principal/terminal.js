// Ouvrir catai (le CLI) dans une vraie fenêtre de terminal, depuis l'app.
// Le moteur est celui de l'app (Electron lancé en mode Node) : pas besoin d'installer Node.
// Sous Windows, on écrit un petit lanceur .cmd (les chemins avec des espaces y sont simples à citer),
// puis « start » ouvre une nouvelle fenêtre de console qui l'exécute. Rien de ce que tape l'utilisateur
// ne passe dans la ligne de commande : le dossier de travail est donné à part (cwd).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function contenuLanceur({ moteur, script }) {
  return [
    '@echo off',
    'rem Lanceur de catai écrit par Cat Ai : le moteur de l\'app, en mode Node',
    'title Cat Ai',
    'set ELECTRON_RUN_AS_NODE=1',
    `"${moteur}" "${script}" %*`,
    '',
  ].join('\r\n');
}

function ouvrirTerminal({ moteur, script, dossier, dossierLanceur, garder = true, plateforme = process.platform, lancer = spawn }) {
  if (plateforme !== 'win32') {
    return { ok: false, erreur: 'Ouvre un terminal et tape « catai » (après « npm link » dans le dossier de Cat Ai).' };
  }
  if (/["%]/.test(moteur + script)) return { ok: false, erreur: 'Le chemin de Cat Ai contient un caractère qui empêche de lancer le terminal.' };
  fs.mkdirSync(dossierLanceur, { recursive: true });
  const lanceur = path.join(dossierLanceur, 'catai-terminal.cmd');
  fs.writeFileSync(lanceur, contenuLanceur({ moteur, script }));
  // /k garde la fenêtre ouverte après catai (on peut relire) ; /c la ferme (utilisé par les tests)
  const enfant = lancer('cmd.exe', ['/d', '/c', `start "Cat Ai" cmd /d ${garder ? '/k' : '/c'} "${lanceur}"`], {
    cwd: dossier,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    windowsVerbatimArguments: true,
  });
  enfant.unref?.();
  return { ok: true, lanceur };
}

module.exports = { ouvrirTerminal, contenuLanceur };
