// Choix du modèle Qwen selon la carte graphique
const test = require('node:test');
const assert = require('node:assert/strict');
const { MODELES_QWEN, modeleConseille, vramDepuisRegistre } = require('../principal/materiel');

test('modeleConseille : le plus gros modèle qui tient dans la carte graphique', () => {
  assert.equal(modeleConseille({ vramGo: 24, ramGo: 32 }).modele, 'qwen3.6:27b');
  assert.equal(modeleConseille({ vramGo: 16, ramGo: 32 }).modele, 'qwen3:14b');
  assert.equal(modeleConseille({ vramGo: 8, ramGo: 16 }).modele, 'qwen3:8b'); // une RX 6600 ou une RTX 3060 Ti
  assert.equal(modeleConseille({ vramGo: 6, ramGo: 16 }).modele, 'qwen3.5:4b');
  assert.equal(modeleConseille({ vramGo: null, ramGo: 8 }).modele, 'qwen3.5:2b');
});

test('modeleConseille : sans vraie carte graphique et avec peu de RAM, Gemini est conseillé à côté', () => {
  assert.equal(modeleConseille({ vramGo: 2, ramGo: 8 }).geminiMieux, true);
  assert.equal(modeleConseille({ vramGo: 8, ramGo: 16 }).geminiMieux, false);
});

test('MODELES_QWEN : chaque modèle tient dans la mémoire demandée, du plus gros au plus petit', () => {
  for (const m of MODELES_QWEN.slice(0, -1)) assert.ok(m.vram > m.taille, m.modele);
  const memoires = MODELES_QWEN.map((m) => m.vram);
  assert.deepEqual(memoires, [...memoires].sort((a, b) => b - a));
});

test('vramDepuisRegistre : lit la plus grosse carte dans la sortie de reg.exe', () => {
  const sortie = `
HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000
    HardwareInformation.qwMemorySize    REG_QWORD    0x200000000

HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0001
    HardwareInformation.qwMemorySize    REG_QWORD    0x80000000
`;
  assert.equal(vramDepuisRegistre(sortie), 8);
  assert.equal(vramDepuisRegistre('rien'), null);
});
