// Mises à jour : au démarrage, l'app regarde sur GitHub (releases de tom-legros/Cat.ai) s'il existe une version
// plus récente. C'est la seule demande qui part sans que l'utilisateur la fasse, et elle ne contient rien de lui.
// Rien n'est téléchargé sans son accord : il voit « Cat Ai x.y.z est sortie », clique, puis redémarre l'app.
//
// Seulement dans l'app installée : l'installateur Windows, ou l'AppImage sur Linux (APPIMAGE est défini quand
// elle tourne). Avec npm start, ou un .deb, il n'y a rien à remplacer. Sans internet, la vérification échoue
// en silence : l'app marche pareil.
const { app, ipcMain } = require('electron');

function configurerMiseAJour(envoyer) {
  if (!app.isPackaged || (process.platform !== 'win32' && !process.env.APPIMAGE)) return;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true; // téléchargée mais pas redémarrée : elle s'installe à la fermeture
  autoUpdater.logger = null;

  // Une erreur pendant la vérification du démarrage ne regarde pas l'utilisateur ; pendant un téléchargement
  // qu'il a demandé, si : on lui dit où la prendre à la main.
  let demandee = false;
  autoUpdater.on('update-available', ({ version }) => envoyer({ etat: 'dispo', version }));
  autoUpdater.on('download-progress', ({ percent }) => envoyer({ etat: 'telechargement', pourcent: Math.floor(percent) }));
  autoUpdater.on('update-downloaded', ({ version }) => envoyer({ etat: 'prete', version }));
  autoUpdater.on('error', () => {
    if (demandee) envoyer({ etat: 'erreur' });
    demandee = false;
  });

  ipcMain.handle('maj-telecharger', () => {
    demandee = true;
    return autoUpdater.downloadUpdate().catch(() => {});
  });
  // Installation silencieuse (pas d'assistant à refaire), puis l'app se relance toute seule
  ipcMain.handle('maj-installer', () => autoUpdater.quitAndInstall(true, true));

  autoUpdater.checkForUpdates().catch(() => {});
}

module.exports = { configurerMiseAJour };
