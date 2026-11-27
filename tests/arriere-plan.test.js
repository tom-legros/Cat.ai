// Garder le partage quand Cat Ai est fermé : démarrage avec l'ordinateur, fermer = cacher, icône près de l'horloge
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const A = require('../principal/arriere-plan');
const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('les arguments de démarrage : l app installée n a que le drapeau, « npm start » redonne le dossier', () => {
  assert.deepEqual(A.argumentsDemarrage({ empaquetee: true, cheminApp: 'x' }), ['--arriere-plan']);
  assert.deepEqual(A.argumentsDemarrage({ empaquetee: false, cheminApp: '/home/a/Cat.ai' }), ['/home/a/Cat.ai', '--arriere-plan']);
});

test('Linux : un fichier .desktop dans autostart, chemins avec espaces ou guillemets protégés, retiré proprement', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-autostart-'));
  try {
    const r = A.reglerDemarrage({ actif: true, plateforme: 'linux', executable: '/opt/Cat Ai/cat-ai', args: ['/home/a/mon "app"', '--arriere-plan'], dossierAutostart: dossier });
    assert.equal(r.ok, true);
    const texte = fs.readFileSync(path.join(dossier, A.NOM_AUTOSTART), 'utf8');
    assert.match(texte, /^\[Desktop Entry\]\nType=Application\nName=Cat Ai\n/);
    assert.match(texte, /\nExec="\/opt\/Cat Ai\/cat-ai" "\/home\/a\/mon \\"app\\"" --arriere-plan\n/);
    assert.equal(A.reglerDemarrage({ actif: false, plateforme: 'linux', dossierAutostart: dossier }).ok, true);
    assert.equal(fs.existsSync(path.join(dossier, A.NOM_AUTOSTART)), false);
    // Retirer deux fois : pas d'erreur
    assert.equal(A.reglerDemarrage({ actif: false, plateforme: 'linux', dossierAutostart: dossier }).ok, true);
  } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
});

test('Windows et macOS : la fonction d Electron, cachée au démarrage ; une erreur devient un message', () => {
  const appels = [];
  const app = { setLoginItemSettings: (o) => appels.push(o) };
  assert.equal(A.reglerDemarrage({ actif: true, plateforme: 'win32', app, executable: 'C:\\Cat Ai\\Cat Ai.exe', args: ['--arriere-plan'] }).ok, true);
  assert.deepEqual(appels[0], { openAtLogin: true, openAsHidden: true, path: 'C:\\Cat Ai\\Cat Ai.exe', args: ['--arriere-plan'] });
  A.reglerDemarrage({ actif: false, plateforme: 'win32', app, executable: 'x', args: [] });
  assert.equal(appels[1].openAtLogin, false);
  const casse = A.reglerDemarrage({ actif: true, plateforme: 'win32', app: { setLoginItemSettings: () => { throw new Error('refusé'); } }, executable: 'x', args: [] });
  assert.equal(casse.ok, false);
  assert.match(casse.erreur, /refusé/);
});

test('fermer la fenêtre : cachée seulement si le réglage est actif ET le partage aussi, jamais quand on quitte', () => {
  assert.equal(A.fermerCache({ arrierePlan: true, partageActif: true, quitteVraiment: false }), true);
  assert.equal(A.fermerCache({ arrierePlan: true, partageActif: false, quitteVraiment: false }), false);
  assert.equal(A.fermerCache({ arrierePlan: false, partageActif: true, quitteVraiment: false }), false);
  assert.equal(A.fermerCache({ arrierePlan: true, partageActif: true, quitteVraiment: true }), false);
});

test('app : réglage désactivé par défaut, icône près de l horloge, démarrage caché avec le drapeau', () => {
  const main = lire('main.js');
  assert.ok(main.includes("ipcMain.handle('arriere-plan-regler'"));
  assert.ok(main.includes('new Tray('));
  assert.ok(main.includes('show: !demarreCache'));
  assert.ok(main.includes('fermerCache({ arrierePlan: !!readJson(\'settings.json\', {}).partageArrierePlan, partageActif: !!partage, quitteVraiment })'));
  assert.match(lire('index.html'), /id="partage-arriere-plan"/);
});
