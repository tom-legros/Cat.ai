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
});

test('attendreOllama : vrai dès qu il répond, faux après le délai', async () => {
  let n = 0;
  assert.equal(await attendreOllama(async () => ++n >= 3, { delai: 1000, pas: 5 }), true);
  assert.equal(await attendreOllama(async () => false, { delai: 30, pas: 5 }), false);
});
