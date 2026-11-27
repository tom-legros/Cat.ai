// Charge le vrai module CommonJS avec seulement les dépendances indiquées remplacées.
// Pas de modification de require.cache ni d'Electron lancé dans les tests.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire, wrap } = require('node:module');

module.exports = function chargerModule(relatif, doubles = {}, globals = {}) {
  const fichier = path.resolve(__dirname, '../..', relatif);
  const charger = createRequire(fichier);
  const module = { exports: {} };
  const contexte = { Buffer, process, URL, AbortSignal, setTimeout, clearTimeout, console, ...globals };
  const fonction = vm.runInNewContext(wrap(fs.readFileSync(fichier, 'utf8')), contexte, { filename: fichier });
  fonction(module.exports, (nom) => Object.hasOwn(doubles, nom) ? doubles[nom] : charger(nom), module, fichier, path.dirname(fichier));
  return module.exports;
};
