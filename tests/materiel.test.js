// Choix du modèle Qwen selon la carte graphique
const test = require('node:test');
const assert = require('node:assert/strict');
const { MODELES_QWEN, modeleConseille, vramDepuisRegistre } = require('../principal/materiel');

test('modeleConseille : le modèle intégré par Cat Ai dès qu’il tient, sinon le plus gros qui tient', () => {
  // qwen3.5:9b est réglé et testé pour Cat Ai : il est conseillé dès que la carte a assez de mémoire
  assert.equal(modeleConseille({ vramGo: 24, ramGo: 32 }).modele, 'qwen3.5:9b');
  assert.equal(modeleConseille({ vramGo: 16, ramGo: 32 }).modele, 'qwen3.5:9b');
  assert.equal(modeleConseille({ vramGo: 8, ramGo: 16 }).modele, 'qwen3.5:9b'); // une carte de 8 Go
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

test('catalogue : rapide dans la carte, lent si ça déborde dans la RAM, trop gros sinon', () => {
  const { catalogue } = require('../principal/materiel');
  const avis = Object.fromEntries(catalogue({ vramGo: 8, ramGo: 16 }).map((m) => [m.modele, m.avis]));
  assert.equal(avis['qwen3:8b'], 'ok');
  assert.equal(avis['qwen3:14b'], 'lent');
  assert.equal(avis['qwen3.6:27b'], 'trop');
  assert.deepEqual(catalogue({ vramGo: 8, ramGo: 16 }).filter((m) => m.conseille).map((m) => m.modele), ['qwen3.5:9b']);
  assert.deepEqual(catalogue({ vramGo: 8, ramGo: 16 }).filter((m) => m.integre).map((m) => m.modele), ['qwen3.5:9b']);
  // Sans carte graphique : seul le plus léger est rapide
  assert.deepEqual(catalogue({ vramGo: null, ramGo: 8 }).filter((m) => m.avis === 'ok').map((m) => m.modele), ['qwen3.5:2b']);
});

test('AUTRES_MODELES : chacun a un usage connu, un nom téléchargeable, et de la marge dans la mémoire demandée', () => {
  const { AUTRES_MODELES } = require('../principal/materiel');
  for (const m of AUTRES_MODELES) {
    assert.match(m.modele, /^[\w.-]+:[\w.-]+$/, m.modele);
    assert.ok(['general', 'code', 'images', 'reflexion'].includes(m.usage), m.modele);
    assert.ok(m.vram > m.taille || m.teste, m.modele); // plus petit que le téléchargement : seulement si on l'a mesuré
    assert.ok(m.raison.length <= 40, m.modele);
  }
  assert.equal(new Set(AUTRES_MODELES.map((m) => m.modele)).size, AUTRES_MODELES.length);
});
