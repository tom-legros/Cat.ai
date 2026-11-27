// La commande catai installée depuis les Réglages : le bon lanceur, le PATH de l'utilisateur, rien d'écrasé
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { contenuCommande, emplacement, dansLePath, etatCommande, installerCommande, desinstallerCommande, SCRIPT_PATH } = require('../principal/installer-catai');

const dossierTemp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'catai-installer-'));

test('le lanceur : moteur de l app en mode Node, ou l AppImage relancée avec --catai', () => {
  const win = contenuCommande({ plateforme: 'win32', moteur: 'C:\\Cat Ai\\Cat Ai.exe', script: 'C:\\Cat Ai\\cli\\catai.js' });
  assert.ok(win.includes('set ELECTRON_RUN_AS_NODE=1\r\n"C:\\Cat Ai\\Cat Ai.exe" "C:\\Cat Ai\\cli\\catai.js" %*'), win);
  assert.ok(contenuCommande({ plateforme: 'linux', appimage: "/home/a/Cat Ai's.AppImage" }).includes(`exec '/home/a/Cat Ai'\\''s.AppImage' --catai "$@"`));
  assert.ok(contenuCommande({ plateforme: 'linux', moteur: '/opt/cat/electron', script: '/opt/cat/cli/catai.js' }).includes(`ELECTRON_RUN_AS_NODE=1 exec '/opt/cat/electron' '/opt/cat/cli/catai.js' "$@"`));
});

test('emplacement : resources/bin pour l app installée sous Windows, ~/.local/bin sous Linux', () => {
  assert.equal(emplacement({ plateforme: 'win32', empaquetee: true, ressources: 'C:\\App\\resources' }).dossier, path.join('C:\\App\\resources', 'bin'));
  assert.equal(emplacement({ plateforme: 'win32', empaquetee: false, donnees: 'D' }).fourni, false);
  assert.equal(emplacement({ plateforme: 'linux', maison: '/home/a' }).fichier, path.join('/home/a', '.local', 'bin', 'catai'));
  assert.equal(dansLePath('C:\\App\\bin', 'C:\\Windows;c:\\app\\bin\\', 'win32'), true);
  assert.equal(dansLePath('/home/a/.local/bin', '/usr/bin:/bin', 'linux'), false);
});

test('Windows : le PATH passe par PowerShell, le dossier par une variable (jamais dans le script)', async () => {
  const donnees = dossierTemp();
  const appels = [];
  const executerPowerShell = async (script, env) => { appels.push({ script, env }); return 'ok'; };
  try {
    const r = await installerCommande({ plateforme: 'win32', empaquetee: false, donnees, moteur: 'm.exe', script: 's.js', executerPowerShell });
    assert.equal(r.ok, true);
    assert.equal(appels[0].script, SCRIPT_PATH);
    assert.deepEqual(appels[0].env, { CATAI_DOSSIER: path.join(donnees, 'bin'), CATAI_ACTION: 'ajouter' });
    assert.ok(!SCRIPT_PATH.includes(donnees));
    assert.match(SCRIPT_PATH, /PropertyType ExpandString/);
    assert.equal(etatCommande({ plateforme: 'win32', empaquetee: false, donnees, pathUtilisateur: `C:\\x;${path.join(donnees, 'bin')}` }).installee, true);
    await desinstallerCommande({ plateforme: 'win32', empaquetee: false, donnees, executerPowerShell });
    assert.equal(appels[1].env.CATAI_ACTION, 'retirer');
    assert.equal(fs.existsSync(path.join(donnees, 'bin', 'catai.cmd')), false);
  } finally { fs.rmSync(donnees, { recursive: true, force: true }); }
});

test('Linux : un script dans ~/.local/bin ; un autre « catai » déjà là n est ni écrasé ni supprimé', async () => {
  const maison = dossierTemp();
  try {
    const r = await installerCommande({ plateforme: 'linux', maison, appimage: '/a/Cat.AppImage' });
    assert.equal(r.ok, true);
    const fichier = path.join(maison, '.local', 'bin', 'catai');
    assert.match(fs.readFileSync(fichier, 'utf8'), /--catai/);
    assert.equal(etatCommande({ plateforme: 'linux', maison }).installee, true);
    fs.writeFileSync(fichier, '#!/bin/sh\necho autre programme\n');
    assert.equal((await installerCommande({ plateforme: 'linux', maison, appimage: '/a' })).ok, false);
    assert.equal((await desinstallerCommande({ plateforme: 'linux', maison })).ok, false);
    assert.ok(fs.existsSync(fichier));
  } finally { fs.rmSync(maison, { recursive: true, force: true }); }
});
