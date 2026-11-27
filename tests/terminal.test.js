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

test('Linux : un script sh exécutable, ouvert dans le terminal trouvé, sans le mode Node de l app', () => {
  const dossierLanceur = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-terminal-'));
  const appels = [];
  const r = ouvrirTerminal({
    moteur: "/opt/Cat Ai/cat-ai", script: "/home/x/l'app/cli/catai.js", dossier: '/home/x/projet', dossierLanceur, plateforme: 'linux',
    env: { PATH: '', TERMINAL: 'ne-existe-pas', ELECTRON_RUN_AS_NODE: '1' },
    lancer: (...args) => { appels.push(args); return { unref() {}, on() {} }; },
  });
  // Aucun terminal dans un PATH vide : message clair avec le chemin du script, rien n'est lancé
  assert.equal(r.ok, false);
  assert.match(r.erreur, /catai-terminal\.sh/);
  assert.equal(appels.length, 0);
  const script = fs.readFileSync(path.join(dossierLanceur, 'catai-terminal.sh'), 'utf8');
  assert.match(script, /^#!\/bin\/sh\n/);
  assert.match(script, /ELECTRON_RUN_AS_NODE=1 '\/opt\/Cat Ai\/cat-ai' '\/home\/x\/l'\\''app\/cli\/catai\.js' "\$@"\nexec "\$\{SHELL:-\/bin\/sh\}"/);
  fs.rmSync(dossierLanceur, { recursive: true, force: true });
});

test('choisirTerminal : $TERMINAL d abord, sinon le premier terminal connu installé, avec la bonne option', () => {
  const { choisirTerminal } = require('../principal/terminal');
  const installes = (liste) => (nom) => (liste.includes(nom) ? '/usr/bin/' + nom : null);
  assert.deepEqual(choisirTerminal({ TERMINAL: 'kitty' }, installes(['kitty', 'xterm'])), { programme: '/usr/bin/kitty', avant: [] });
  assert.deepEqual(choisirTerminal({}, installes(['xterm', 'gnome-terminal'])), { programme: '/usr/bin/gnome-terminal', avant: ['--'] });
  assert.deepEqual(choisirTerminal({ TERMINAL: 'absent' }, installes(['konsole'])), { programme: '/usr/bin/konsole', avant: ['-e'] });
  assert.equal(choisirTerminal({}, installes([])), null);
});

test('ouvrirTerminal Linux : lance le terminal avec le script, dans le dossier demandé', () => {
  const dossierLanceur = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-terminal-'));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-bin-'));
  fs.writeFileSync(path.join(bin, 'xterm'), '#!/bin/sh\n', { mode: 0o755 });
  const appels = [];
  const r = ouvrirTerminal({
    moteur: '/opt/cat-ai', script: '/opt/cli/catai.js', dossier: '/home/x', dossierLanceur, plateforme: 'linux',
    env: { PATH: bin, ELECTRON_RUN_AS_NODE: '1' }, lancer: (...args) => { appels.push(args); return { unref() {}, on() {} }; },
  });
  assert.equal(r.ok, true);
  const [programme, args, options] = appels[0];
  assert.equal(programme, path.join(bin, 'xterm'));
  assert.deepEqual(args, ['-e', r.lanceur]);
  assert.equal(options.cwd, '/home/x');
  assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined);
  fs.rmSync(dossierLanceur, { recursive: true, force: true });
  fs.rmSync(bin, { recursive: true, force: true });
});

test('ouvrirTerminal : un chemin piégé est refusé sous Windows', () => {
  const r = ouvrirTerminal({ moteur: 'C:\\a"b\\Cat Ai.exe', script: 'C:\\x.js', dossierLanceur: os.tmpdir(), plateforme: 'win32', lancer: () => { throw new Error('ne doit pas lancer'); } });
  assert.equal(r.ok, false);
});
