const test = require('node:test');
const assert = require('node:assert/strict');
const { somme, moyenne } = require('../src/calcul');

test('somme', () => { assert.equal(somme(2, 3), 5); assert.equal(somme(-1, 1), 0); });
test('moyenne', () => { assert.equal(moyenne([2, 4, 6]), 4); assert.equal(moyenne([5]), 5); });
test('moyenne d un tableau vide', () => { assert.equal(moyenne([]), 0); });
