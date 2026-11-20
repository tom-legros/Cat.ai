// Bouton Terminal : catai dans une console, avec le moteur de l'app, sans passer la saisie de l'utilisateur à la ligne de commande
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ouvrirTerminal, contenuLanceur } = require('../principal/terminal');

test('le lanceur met Electron en mode Node et cite les chemins (même avec des espaces)', () => {
  const texte = contenuLanceur({ moteur: 'C:\\Program Files\\Cat Ai\\Cat Ai.exe', script: 'C:\\Program Files\\Cat Ai\\resources\\app.asar\\cli\\catai.js' });
  assert.match(texte, /set ELECTRON_RUN_AS_NODE=1/);
  assert.match(texte, /"C:\\Program Files\\Cat Ai\\Cat Ai\.exe" "C:\\Program Files\\Cat Ai\\resources\\app\.asar\\cli\\catai\.js" %\*/);
});

test('ouvrirTerminal : une nouvelle console via start, dans le dossier demandé, sans rien d’autre dans la commande', () => {
  const dossierLanceur = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-terminal-'));
  const appels = [];
  const r = ouvrirTerminal({
    moteur: 'C:\\Cat Ai\\Cat Ai.exe', script: 'C:\\Cat Ai\\cli\\catai.js', dossier: 'C:\\Projet', dossierLanceur,
    plateforme: 'win32', lancer: (...args) => { appels.push(args); return { unref() {} }; },
  });
  assert.equal(r.ok, true);
  assert.ok(fs.existsSync(r.lanceur));
  const [programme, args, options] = appels[0];
  assert.equal(programme, 'cmd.exe');
  assert.deepEqual(args.slice(0, 2), ['/d', '/c']);
  assert.equal(args[2], `start "Cat Ai" cmd /d /k "${r.lanceur}"`);
  assert.equal(options.cwd, 'C:\\Projet');
  assert.equal(options.windowsVerbatimArguments, true);
  assert.equal(options.detached, true);
  fs.rmSync(dossierLanceur, { recursive: true, force: true });
});

test('ouvrirTerminal : ailleurs que sous Windows, il explique quoi faire ; un chemin piégé est refusé', () => {
  assert.equal(ouvrirTerminal({ moteur: '/usr/bin/x', script: '/a/catai.js', plateforme: 'linux' }).ok, false);
  const r = ouvrirTerminal({ moteur: 'C:\\a"b\\Cat Ai.exe', script: 'C:\\x.js', dossierLanceur: os.tmpdir(), plateforme: 'win32', lancer: () => { throw new Error('ne doit pas lancer'); } });
  assert.equal(r.ok, false);
});
