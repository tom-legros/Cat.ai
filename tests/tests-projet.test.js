// Tests d'un projet lancés par le chat : arrêt complet à l'annulation
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { lancerTestsNode } = require('../principal/tests-projet');

test('lancerTestsNode : annuler arrête aussi un sous-processus qui garde la sortie ouverte', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-tests-'));
  // Un test qui lance un petit-enfant avec la même sortie, puis attend : avant, 'close' n'arrivait jamais
  fs.writeFileSync(path.join(d, 'bloque.test.js'), `
const { spawn } = require('child_process');
require('node:test')('attend', () => {
  spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'inherit' });
  return new Promise((r) => setTimeout(r, 60000));
});
`);
  const controleur = new AbortController();
  const debut = Date.now();
  setTimeout(() => controleur.abort(), 1500);
  const bilan = await lancerTestsNode(d, controleur.signal);
  assert.match(bilan, /^Tests annulés\./);
  assert.ok(Date.now() - debut < 10000, 'la promesse doit se terminer peu après l annulation');
});
