// Alerte quand un modèle local répond bien plus lentement que d'habitude
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
const debut = source.indexOf('const SEUIL_LENTEUR');
const fin = source.indexOf('\nfunction noterVitesse');
const c = {};
vm.runInNewContext(source.slice(debut, fin) + '\nthis.comparerVitesse = comparerVitesse;', c);

test('comparerVitesse : retient la meilleure vitesse de chaque modèle', () => {
  let r = c.comparerVitesse({}, 'qwen3.5:9b', { debit: 35.3, tokens: 285 });
  assert.equal(r.lent, null);
  assert.equal(r.vitesses['qwen3.5:9b'], 35.3);
  r = c.comparerVitesse(r.vitesses, 'qwen3.5:9b', { debit: 30, tokens: 300 });
  assert.equal(r.lent, null);
  assert.equal(r.vitesses['qwen3.5:9b'], 35.3);
});

test('comparerVitesse : 4 tokens/s au lieu de 35 → signalé, sans baisser la référence', () => {
  const r = c.comparerVitesse({ 'qwen3.5:9b': 35.3 }, 'qwen3.5:9b', { debit: 4.2, tokens: 300 });
  assert.equal(JSON.stringify(r.lent), JSON.stringify({ debit: 4.2, habituelle: 35 }));
  assert.equal(r.vitesses['qwen3.5:9b'], 35.3);
});

test('comparerVitesse : rien de signalé sans référence, sur une réponse trop courte ou pour un autre modèle', () => {
  assert.equal(c.comparerVitesse({}, 'qwen3.5:9b', { debit: 4, tokens: 300 }).lent, null);
  assert.equal(c.comparerVitesse({ 'qwen3.5:9b': 35 }, 'qwen3.5:9b', { debit: 4, tokens: 12 }).lent, null);
  assert.equal(c.comparerVitesse({ 'qwen3.5:9b': 35 }, 'qwen3:14b', { debit: 4, tokens: 300 }).lent, null);
  assert.equal(c.comparerVitesse({ 'lent:1b': 5 }, 'lent:1b', { debit: 1, tokens: 300 }).lent, null);
});

test('renderer : la lenteur est enregistrée sur le message et affichée dans ses statistiques', () => {
  assert.match(source, /const lent = noterVitesse\(flux\.modele, syntheseOllama\(statistiquesOllama\)\);\s*if \(lent\) message\.lenteur = lent;/);
  assert.match(source, /details\.classList\.add\("msg__stats--lent"\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8'), /\.msg \.msg__stats--lent \{ opacity: 1; \}/);
});
