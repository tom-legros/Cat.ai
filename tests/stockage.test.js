// Stockage des données : écriture atomique, sauvegarde, réparation d'un fichier abîmé.
// Chaque test travaille dans un dossier temporaire neuf : les vraies données ne sont jamais touchées.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { configurerStockage, readJson, writeJson, prendreAlertes } = require('../principal/stockage');

function dossierNeuf(t) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'chatnoir-stockage-'));
  t.after(() => fs.rmSync(dossier, { recursive: true, force: true }));
  configurerStockage({ dossier });
  prendreAlertes(); // pas d'alerte laissée par un autre test
  return dossier;
}
const lire = (dossier, nom) => fs.readFileSync(path.join(dossier, nom), 'utf8');

test('fichier absent : valeur par défaut, sans alerte', (t) => {
  dossierNeuf(t);
  assert.deepEqual(readJson('memory.json', []), []);
  assert.deepEqual(prendreAlertes(), []);
});

test('écriture : la première ne crée pas de sauvegarde, la suivante garde la version d avant', (t) => {
  const dossier = dossierNeuf(t);
  writeJson('a.json', { v: 1 });
  assert.ok(!fs.existsSync(path.join(dossier, 'a.json.sauvegarde')));
  writeJson('a.json', { v: 2 });
  assert.deepEqual(readJson('a.json', null), { v: 2 });
  assert.deepEqual(JSON.parse(lire(dossier, 'a.json.sauvegarde')), { v: 1 });
  assert.ok(!fs.existsSync(path.join(dossier, 'a.json.tmp')));
});

test('écriture par-dessus un fichier abîmé : la bonne sauvegarde n est pas écrasée', (t) => {
  const dossier = dossierNeuf(t);
  writeJson('a.json', { v: 1 });
  writeJson('a.json', { v: 2 });
  fs.writeFileSync(path.join(dossier, 'a.json'), '{"v": 2, "conv');
  writeJson('a.json', { v: 3 });
  assert.deepEqual(JSON.parse(lire(dossier, 'a.json.sauvegarde')), { v: 1 });
});

test('plantage pendant l écriture : le fichier garde sa version précédente', (t) => {
  const dossier = dossierNeuf(t);
  writeJson('a.json', { v: 1 });
  const original = fs.fsyncSync;
  fs.fsyncSync = () => { throw new Error('coupure de courant'); };
  t.after(() => { fs.fsyncSync = original; });
  assert.throws(() => writeJson('a.json', { v: 2 }), /coupure/);
  fs.fsyncSync = original;
  assert.deepEqual(JSON.parse(lire(dossier, 'a.json')), { v: 1 });
  writeJson('a.json', { v: 3 }); // le .tmp laissé par le plantage ne gêne pas
  assert.deepEqual(readJson('a.json', null), { v: 3 });
});

test('fichier abîmé avec sauvegarde : mis de côté, l app repart de la sauvegarde et prévient', (t) => {
  const dossier = dossierNeuf(t);
  writeJson('memory.json', ['a']);
  writeJson('memory.json', ['a', 'b']);
  fs.writeFileSync(path.join(dossier, 'memory.json'), '["a", "b", "c');
  assert.deepEqual(readJson('memory.json', []), ['a']);
  const [alerte, ...autres] = prendreAlertes();
  assert.match(alerte, /la mémoire du chat.*sauvegarde/s);
  assert.deepEqual(autres, []);
  const misDeCote = fs.readdirSync(dossier).find((f) => f.startsWith('memory.json.illisible-'));
  assert.equal(lire(dossier, misDeCote), '["a", "b", "c');
  // La lecture suivante trouve directement la version réparée, sans nouvelle alerte
  assert.deepEqual(readJson('memory.json', []), ['a']);
  assert.deepEqual(prendreAlertes(), []);
});

test('fichier abîmé sans sauvegarde : repart de zéro, mais ne supprime rien', (t) => {
  const dossier = dossierNeuf(t);
  fs.writeFileSync(path.join(dossier, 'fournisseurs.json'), '{"fournisseurs": {"groq": {"cleChiffree": "AQ');
  assert.deepEqual(readJson('fournisseurs.json', {}), {});
  assert.match(prendreAlertes()[0], /fournisseurs et tes clés API.*pas de sauvegarde/s);
  assert.ok(fs.readdirSync(dossier).some((f) => f.startsWith('fournisseurs.json.illisible-')));
});

test('fichier bloqué (EPERM) : erreur claire, le fichier n est ni déplacé ni écrasé', (t) => {
  const dossier = dossierNeuf(t);
  writeJson('settings.json', { projectDir: 'C:\\projet' });
  const original = fs.readFileSync;
  fs.readFileSync = (f, ...reste) => {
    if (String(f).endsWith('settings.json')) throw Object.assign(new Error('bloqué'), { code: 'EPERM' });
    return original(f, ...reste);
  };
  t.after(() => { fs.readFileSync = original; });
  assert.throws(() => readJson('settings.json', {}), /Impossible de lire settings\.json \(EPERM\)/);
  fs.readFileSync = original;
  assert.deepEqual(readJson('settings.json', {}), { projectDir: 'C:\\projet' });
  assert.deepEqual(fs.readdirSync(dossier).filter((f) => f.includes('illisible')), []);
});

test('prevenir est appelée à chaque nouvelle alerte', (t) => {
  const dossier = dossierNeuf(t);
  let appels = 0;
  configurerStockage({ dossier, prevenir: () => appels++ });
  t.after(() => configurerStockage({ dossier, prevenir: () => {} }));
  fs.writeFileSync(path.join(dossier, 'memory.json'), '[');
  readJson('memory.json', []);
  assert.equal(appels, 1);
});
