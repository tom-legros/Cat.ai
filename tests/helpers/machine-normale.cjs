// Ces tests de transport décrivent le mode normal, pas le mode petite machine.
// Le runner isole chaque fichier dans son propre processus : ce double ne touche
// ni l'application ni machine-legere.test.js, qui vérifie les deux modes.
const { mock, after } = require('node:test');
const machine = require('../../principal/machine-legere');
const detection = mock.method(machine, 'machineLegere', () => false);
after(() => detection.mock.restore());
