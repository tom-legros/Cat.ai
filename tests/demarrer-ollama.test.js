// Démarrer Ollama hors de l'app (catai) : le bon exécutable, Vulkan avec une carte AMD sous Windows
const test = require('node:test');
const assert = require('node:assert/strict');
const { commandeOllama, cartesDepuisPnp, lancerOllama, attendreOllama } = require('../principal/demarrer-ollama');

test('commandeOllama : ollama dans le PATH hors Windows, l exécutable installé sous Windows (ou rien)', () => {
  assert.equal(commandeOllama({ plateforme: 'linux' }), 'ollama');
  assert.match(commandeOllama({ plateforme: 'win32', env: { LOCALAPPDATA: 'L' }, existe: () => true }), /ollama\.exe$/);
  assert.equal(commandeOllama({ plateforme: 'win32', env: { LOCALAPPDATA: 'L' }, existe: () => false }), null);
});

test('cartes : les identifiants PCI de Windows deviennent des fabricants ; une carte AMD seule active Vulkan', () => {
  const cartes = cartesDepuisPnp('PCI\VEN_1002&DEV_73FF&SUBSYS\r\nPCI\VEN_8086&DEV_4680\r\n');
  assert.deepEqual(cartes.map((c) => c.vendorId), [0x1002, 0x8086]);
  const appels = [];
  lancerOllama({ cartes, plateforme: 'linux', env: {}, lancer: (c, a, o) => { appels.push(o); return { on() {}, unref() {} }; } });
  lancerOllama({ cartes, plateforme: 'win32', env: { LOCALAPPDATA: __dirname }, lancer: (c, a, o) => { appels.push(o); return { on() {} }; } });
  assert.equal(appels[0].env.OLLAMA_VULKAN, undefined);
  // Survivre à catai : sous Windows, par PowerShell avec une console cachée (lancé « détaché » lui-même, chaque modèle
  // chargé ouvrait une fenêtre) ; ailleurs, détaché
  const appelsDetaches = [];
  const faux = (c, a, o) => { appelsDetaches.push({ c, a, o }); return { on() {}, unref() {} }; };
  lancerOllama({ detache: true, plateforme: 'win32', env: {}, commande: 'C:\\O\\ollama.exe', lancer: faux });
  lancerOllama({ detache: true, plateforme: 'linux', env: {}, lancer: faux });
  const [win, linux] = appelsDetaches;
  assert.equal(win.c, 'powershell.exe');
  assert.match(win.a.at(-1), /Start-Process -FilePath \$env:CATAI_OLLAMA -ArgumentList 'serve' -WindowStyle Hidden/);
  assert.equal(win.o.env.CATAI_OLLAMA, 'C:\\O\\ollama.exe');
  assert.ok(!win.a.join(' ').includes('C:\\O'));
  assert.equal(linux.c, 'ollama');
  assert.equal(linux.o.detached, true);
  // Lancé par l'app (pas détaché) : directement, caché
  appelsDetaches.length = 0;
  lancerOllama({ plateforme: 'win32', env: {}, commande: 'o.exe', lancer: faux });
  assert.equal(appelsDetaches[0].c, 'o.exe');
  assert.equal(appelsDetaches[0].o.windowsHide, true);
});

test('attendreOllama : vrai dès qu il répond, faux après le délai', async () => {
  let n = 0;
  assert.equal(await attendreOllama(async () => ++n >= 3, { delai: 1000, pas: 5 }), true);
  assert.equal(await attendreOllama(async () => false, { delai: 30, pas: 5 }), false);
});
