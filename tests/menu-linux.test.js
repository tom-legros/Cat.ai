// Linux : ajout de l'AppImage au menu des applications, et mise à jour de l'entrée quand le fichier change de nom
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MARQUE, cheminExec, contenuDesktop, integrerMenu } = require('../principal/menu-linux');

const dossierTemp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'catai-menu-'));
const options = (dossierDonnees, autres = {}) => ({
  appimage: '/home/moi/Applications/Cat-Ai-1.1.0.AppImage',
  dossierDonnees,
  icone: Buffer.from('png'),
  nomFenetre: 'Cat Ai',
  choix: undefined,
  demander: async () => true,
  enregistrerChoix: () => {},
  ...autres,
});
const desktop = (d) => path.join(d, 'applications', 'cat-ai.desktop');

test('cheminExec : guillemets et caractères spéciaux échappés', () => {
  assert.equal(cheminExec('/home/moi/Mes Apps/Cat Ai.AppImage'), '"/home/moi/Mes Apps/Cat Ai.AppImage"');
  assert.equal(cheminExec('/a/b"c$d`e\\f'), '"/a/b\\"c\\$d\\`e\\\\f"');
});

test('contenuDesktop : une entrée de menu complète, marquée comme la nôtre', () => {
  const c = contenuDesktop({ appimage: '/x/Cat.AppImage', nomFenetre: 'Cat Ai' });
  assert.match(c, /^\[Desktop Entry\]\nType=Application\nName=Cat Ai\n/);
  assert.match(c, /\nExec="\/x\/Cat\.AppImage" %U\n/);
  assert.match(c, /\nIcon=cat-ai\n/);
  assert.ok(c.includes(MARQUE));
});

test('integrerMenu : premier lancement accepté, l entrée et l icône sont créées', async () => {
  const d = dossierTemp();
  const choix = [];
  assert.equal(await integrerMenu(options(d, { enregistrerChoix: (c) => choix.push(c) })), 'ajoute');
  assert.deepEqual(choix, ['oui']);
  assert.match(fs.readFileSync(desktop(d), 'utf8'), /Cat-Ai-1\.1\.0\.AppImage/);
  assert.ok(fs.existsSync(path.join(d, 'icons', 'hicolor', '256x256', 'apps', 'cat-ai.png')));
});

test('integrerMenu : refusé une fois, la question n est plus jamais posée', async () => {
  const d = dossierTemp();
  const choix = [];
  assert.equal(await integrerMenu(options(d, { demander: async () => false, enregistrerChoix: (c) => choix.push(c) })), 'refuse');
  assert.deepEqual(choix, ['non']);
  let demande = false;
  assert.equal(await integrerMenu(options(d, { choix: 'non', demander: async () => (demande = true) })), 'refuse');
  assert.equal(demande, false);
  assert.ok(!fs.existsSync(desktop(d)));
});

test('integrerMenu : après une mise à jour, l entrée suit le nouveau fichier sans redemander', async () => {
  const d = dossierTemp();
  await integrerMenu(options(d));
  let demande = false;
  const r = await integrerMenu(options(d, { appimage: '/home/moi/Applications/Cat-Ai-1.1.1.AppImage', choix: 'oui', demander: async () => (demande = true) }));
  assert.equal(r, 'mis-a-jour');
  assert.equal(demande, false);
  assert.match(fs.readFileSync(desktop(d), 'utf8'), /Cat-Ai-1\.1\.1\.AppImage/);
  assert.equal(await integrerMenu(options(d, { appimage: '/home/moi/Applications/Cat-Ai-1.1.1.AppImage' })), 'deja');
});

test('integrerMenu : une entrée cat-ai.desktop faite par quelqu un d autre n est jamais touchée', async () => {
  const d = dossierTemp();
  fs.mkdirSync(path.dirname(desktop(d)), { recursive: true });
  fs.writeFileSync(desktop(d), '[Desktop Entry]\nName=Mon Cat Ai à moi\n');
  assert.equal(await integrerMenu(options(d)), 'autre');
  assert.equal(fs.readFileSync(desktop(d), 'utf8'), '[Desktop Entry]\nName=Mon Cat Ai à moi\n');
});
