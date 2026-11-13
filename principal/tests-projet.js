// Exécute les tests Node d'un projet après confirmation dans le processus principal.
const { spawn } = require('node:child_process');

const MAX_SORTIE = 12_000;
const DELAI = 90_000;
// Une erreur de Godot, repérée au fil de la sortie (la fin seule ne suffit pas : un import long la repousse)
const ERREUR_GODOT = /^\s*(?:SCRIPT ERROR|ERROR|Parse Error):/i;
const MAX_ERREURS = 20;

function lancerTestsNode(dossier, signal) {
  return executer(process.execPath, ['--test', '--test-isolation=none'], dossier, signal, true);
}

function verifierProjetGodot(executable, dossier, signal) {
  return executer(executable, ['--headless', '--path', dossier, '--import'], dossier, signal, false);
}

function executer(executable, argumentsCommande, dossier, signal, node) {
  const nom = node ? 'Tests' : 'Vérification Godot';
  if (signal?.aborted) return Promise.resolve(nom + ' : annulation avant le lancement.');
  return new Promise((resolve) => {
    const environnement = { FORCE_COLOR: '0' };
    if (node) environnement.ELECTRON_RUN_AS_NODE = '1';
    for (const nom of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'PATH', ...(!node ? ['APPDATA', 'LOCALAPPDATA', 'HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME'] : [])]) {
      if (process.env[nom]) environnement[nom] = process.env[nom];
    }
    // Hors Windows, le processus a son propre groupe : on peut l'arrêter avec tout ce qu'il a lancé
    const enfant = spawn(executable, argumentsCommande, {
      cwd: dossier, env: environnement, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    });
    let sortie = '';
    let arret = '';
    let ligneEnCours = '';
    const erreurs = [];
    const ajouter = (texte) => {
      sortie = (sortie + texte).slice(-MAX_SORTIE);
      if (node) return;
      const lignes = (ligneEnCours + texte).split('\n');
      ligneEnCours = lignes.pop();
      for (const l of lignes) if (ERREUR_GODOT.test(l) && erreurs.length < MAX_ERREURS) erreurs.push(l.trim().slice(0, 300));
    };
    for (const flux of [enfant.stdout, enfant.stderr]) flux.setEncoding('utf8').on('data', ajouter);
    let fini = false;
    const finir = (code) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuteur);
      signal?.removeEventListener('abort', annuler);
      if (!node && ERREUR_GODOT.test(ligneEnCours) && erreurs.length < MAX_ERREURS) erreurs.push(ligneEnCours.trim().slice(0, 300));
      const aucunTest = /^(?:ℹ|#) tests 0\s*$/m.test(sortie);
      let bilan = arret;
      if (!bilan && node) bilan = code !== 0 ? 'Les tests ont échoué (code ' + code + ').' : aucunTest ? 'Aucun test Node trouvé.' : 'Tests réussis.';
      if (!bilan) bilan = code !== 0 || erreurs.length ? 'Godot a signalé des erreurs (code ' + code + ').' : 'Import Godot terminé.';
      const listeErreurs = erreurs.length ? '\nErreurs repérées :\n' + erreurs.join('\n') : '';
      resolve(bilan + listeErreurs + (sortie.trim() ? '\nDernières lignes de la commande :\n' + sortie.trim() : ''));
    };
    // Tuer seulement le processus lancé ne suffit pas : le lanceur console de Godot, ou un test qui lance un
    // sous-processus, laisse un petit-enfant qui garde la sortie ouverte, et 'close' n'arrivait jamais.
    const tuer = () => {
      if (process.platform === 'win32' && enfant.pid) {
        spawn('taskkill', ['/pid', String(enfant.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => enfant.kill('SIGKILL'));
      } else {
        try { process.kill(-enfant.pid, 'SIGKILL'); } catch { enfant.kill('SIGKILL'); }
      }
      setTimeout(() => finir(null), 3000).unref();
    };
    const annuler = () => { arret ||= node ? 'Tests annulés.' : 'Vérification Godot annulée.'; tuer(); };
    const minuteur = setTimeout(() => { arret ||= nom + ' : arrêt après 90 secondes.'; tuer(); }, DELAI);
    signal?.addEventListener('abort', annuler, { once: true });
    if (signal?.aborted) annuler();
    enfant.once('error', (erreur) => { arret ||= nom + ' : lancement impossible (' + erreur.message + ').'; setTimeout(() => finir(null), 1000).unref(); });
    enfant.once('close', finir);
  });
}

module.exports = { lancerTestsNode, verifierProjetGodot };
