// Ouvrir catai (le CLI) dans une vraie fenêtre de terminal, depuis l'app.
// Le moteur est celui de l'app (Electron lancé en mode Node) : pas besoin d'installer Node.
// Sous Windows, on écrit un petit lanceur .cmd (les chemins avec des espaces y sont simples à citer),
// puis « start » ouvre une nouvelle fenêtre de console qui l'exécute. Sous Linux, un petit script sh, ouvert
// dans le terminal installé (celui de $TERMINAL d'abord, puis les plus courants). Rien de ce que tape
// l'utilisateur ne passe dans la ligne de commande : le dossier de travail est donné à part (cwd).
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

// Un chemin entre apostrophes pour sh : une apostrophe dedans devient '\''
const citerSh = (texte) => `'${String(texte).replace(/'/g, "'\\''")}'`;

// Le script sh : catai avec le moteur de l'app, puis un shell pour que la fenêtre reste ouverte
function contenuLanceurSh({ moteur, script, garder = true }) {
  return [
    '#!/bin/sh',
    "# Lanceur de catai écrit par Cat Ai : le moteur de l'app, en mode Node",
    `ELECTRON_RUN_AS_NODE=1 ${citerSh(moteur)} ${citerSh(script)} "$@"`,
    ...(garder ? ['exec "${SHELL:-/bin/sh}"'] : []),
    '',
  ].join('\n');
}

// Les terminaux connus et comment leur faire exécuter un programme
const TERMINAUX = [
  ['x-terminal-emulator', ['-e']], ['gnome-terminal', ['--']], ['ptyxis', ['--']], ['kgx', ['-e']], ['konsole', ['-e']],
  ['xfce4-terminal', ['-x']], ['mate-terminal', ['-x']], ['tilix', ['-e']], ['terminator', ['-x']], ['kitty', []],
  ['alacritty', ['-e']], ['wezterm', ['start', '--']], ['foot', []], ['lxterminal', ['-e']], ['xterm', ['-e']],
];

function trouverDansPath(nom, env = process.env) {
  if (nom.includes('/')) return fs.existsSync(nom) ? nom : null;
  for (const dossier of String(env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const chemin = path.join(dossier, nom);
    try { fs.accessSync(chemin, fs.constants.X_OK); if (fs.statSync(chemin).isFile()) return chemin; } catch { /* pas ici */ }
  }
  return null;
}

// Le terminal à utiliser : $TERMINAL (s'il existe), sinon le premier terminal connu installé
function choisirTerminal(env = process.env, trouver = (nom) => trouverDansPath(nom, env)) {
  const prefere = env.TERMINAL && trouver(env.TERMINAL.trim());
  if (prefere) {
    const connu = TERMINAUX.find(([nom]) => nom === path.basename(prefere));
    return { programme: prefere, avant: connu ? connu[1] : ['-e'] };
  }
  for (const [nom, avant] of TERMINAUX) {
    const programme = trouver(nom);
    if (programme) return { programme, avant };
  }
  return null;
}

function ouvrirTerminalUnix({ moteur, script, dossier, dossierLanceur, garder, plateforme, lancer, env }) {
  fs.mkdirSync(dossierLanceur, { recursive: true });
  const lanceur = path.join(dossierLanceur, plateforme === 'darwin' ? 'catai-terminal.command' : 'catai-terminal.sh');
  fs.writeFileSync(lanceur, contenuLanceurSh({ moteur, script, garder }), { mode: 0o755 });
  fs.chmodSync(lanceur, 0o755);
  const terminal = plateforme === 'darwin' ? { programme: 'open', avant: ['-a', 'Terminal'] } : choisirTerminal(env);
  if (!terminal) return { ok: false, erreur: 'Aucun terminal trouvé sur ce PC. Lance ce fichier dans le tien : ' + lanceur };
  // Le terminal ne doit pas hériter du mode Node de l'app
  const environnement = { ...env };
  delete environnement.ELECTRON_RUN_AS_NODE;
  const enfant = lancer(terminal.programme, [...terminal.avant, lanceur], { cwd: dossier, detached: true, stdio: 'ignore', env: environnement });
  enfant.on?.('error', () => {});
  enfant.unref?.();
  return { ok: true, lanceur, terminal: terminal.programme };
}

function ouvrirTerminal({ moteur, script, dossier, dossierLanceur, garder = true, plateforme = process.platform, lancer = spawn, env = process.env }) {
  if (plateforme !== 'win32') return ouvrirTerminalUnix({ moteur, script, dossier, dossierLanceur, garder, plateforme, lancer, env });
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

module.exports = { ouvrirTerminal, contenuLanceur, contenuLanceurSh, choisirTerminal, TERMINAUX };
