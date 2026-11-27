// « Garder le partage quand Cat Ai est fermé » : Cat Ai démarre avec l'ordinateur, sans fenêtre, et fermer la fenêtre
// la cache seulement (une icône près de l'horloge permet de la rouvrir ou de vraiment quitter). Le partage de la carte
// graphique et Ollama continuent : le portable peut s'en servir même si personne n'a rouvert Cat Ai sur ce PC.
// Choix de l'utilisateur, désactivé par défaut (démarrer avec l'ordinateur ne se fait pas sans qu'on le demande).
// Ce fichier : ce qui se teste sans Electron. main.js s'occupe de la fenêtre et de l'icône.
const fs = require('fs');
const path = require('path');

const DRAPEAU = '--arriere-plan';
const NOM_AUTOSTART = 'cat-ai.desktop';

// Les arguments pour relancer Cat Ai au démarrage : l'app installée n'en a pas besoin ; « npm start » (Electron
// lancé sur le dossier) doit redonner le dossier de l'app
const argumentsDemarrage = ({ empaquetee, cheminApp }) => (empaquetee ? [DRAPEAU] : [cheminApp, DRAPEAU]);

// Linux : un fichier .desktop dans ~/.config/autostart (la norme XDG que suivent KDE, GNOME…)
function guillemets(arg) {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `"${String(arg).replace(/(["`$\\])/g, '\\$1')}"`;
}
function fichierAutostart({ executable, args }) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Cat Ai',
    'Comment=Partage la carte graphique de ce PC (Cat Ai, en arrière-plan)',
    `Exec=${[executable, ...args].map(guillemets).join(' ')}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

// Active ou retire le démarrage avec l'ordinateur. app : l'objet app d'Electron (Windows, macOS) ;
// dossierAutostart : ~/.config/autostart (Linux). Renvoie { ok } ou { ok: false, erreur }.
function reglerDemarrage({ actif, plateforme = process.platform, app, executable, args, dossierAutostart }) {
  try {
    if (plateforme === 'linux') {
      const fichier = path.join(dossierAutostart, NOM_AUTOSTART);
      if (actif) {
        fs.mkdirSync(dossierAutostart, { recursive: true });
        fs.writeFileSync(fichier, fichierAutostart({ executable, args }), { mode: 0o644 });
      } else fs.rmSync(fichier, { force: true });
      return { ok: true };
    }
    app.setLoginItemSettings({ openAtLogin: !!actif, openAsHidden: !!actif, path: executable, args });
    return { ok: true };
  } catch (err) {
    return { ok: false, erreur: `Impossible de régler le démarrage avec l'ordinateur : ${err.message}` };
  }
}

// Fermer la fenêtre : la cacher (partage gardé) ou quitter
const fermerCache = ({ arrierePlan, partageActif, quitteVraiment }) => !!(arrierePlan && partageActif && !quitteVraiment);

module.exports = { DRAPEAU, NOM_AUTOSTART, argumentsDemarrage, fichierAutostart, reglerDemarrage, fermerCache };
