// Les chats des agents : une grille propre par rôle, et les variantes qui changent seulement le collier
const test = require('node:test');
const assert = require('node:assert/strict');
const { ROLES_SPRITE, VARIANTES, grilleAgent, spriteAgent } = require('../interface/sprites');

test('grilleAgent : chaque rôle a une grille de 18 × 18, avec les yeux et son accessoire', () => {
  assert.deepEqual(ROLES_SPRITE, ['chef', 'codeur', 'auteur', 'testeur', 'logs', 'relecteur']);
  const vus = new Set();
  for (const role of ROLES_SPRITE) {
    const g = grilleAgent(role);
    assert.equal(g.length, 18, role);
    assert.ok(g.every((l) => l.length === 18), role);
    assert.ok(g.join('').includes('e'), `${role} : les yeux`);
    assert.ok(g.join('').includes('r'), `${role} : le collier`);
    vus.add(g.join('\n'));
  }
  assert.equal(vus.size, ROLES_SPRITE.length, 'deux rôles ont le même dessin');
});

test('spriteAgent : un SVG décoratif, la variante ne change que la classe du collier, un rôle inconnu reste dessiné', () => {
  const svg = spriteAgent('chef', 1);
  assert.match(svg, /aria-hidden="true"/);
  assert.match(svg, /sprite--v1/);
  assert.equal(spriteAgent('chef', 0).replace('sprite--v0', ''), svg.replace('sprite--v1', ''));
  assert.match(spriteAgent('chef', VARIANTES + 2), /sprite--v2/);
  assert.match(spriteAgent('inconnu'), /<rect/);
});
