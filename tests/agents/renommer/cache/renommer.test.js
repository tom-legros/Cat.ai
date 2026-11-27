const test = require('node:test');
const assert = require('node:assert/strict');
const utilisateur = require('../src/utilisateur');
const { messageAccueil } = require('../src/accueil');
const ada = { prenom: 'Ada', nom: 'Lovelace' };

test('nomAffiche met le nom en majuscules', () => { assert.equal(utilisateur.nomAffiche(ada), 'Ada LOVELACE'); });
test('nomComplet n existe plus', () => { assert.equal(utilisateur.nomComplet, undefined); });
test('l accueil utilise nomAffiche', () => { assert.equal(messageAccueil(ada), 'Bonjour Ada LOVELACE !'); });
