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

test('un fichier de test qui plante au chargement fait échouer les tests (il n est plus ignoré en silence)', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { lancerTestsNode } = require('../principal/tests-projet');
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-chargement-'));
  try {
    fs.writeFileSync(path.join(dossier, 'bon.test.js'), "require('node:test')('ok', () => {});\n");
    fs.writeFileSync(path.join(dossier, 'casse.test.js'), "const test = require('node:test');\ndescribe('x', () => test('y', () => {}));\n");
    const bilan = await lancerTestsNode(dossier);
    assert.match(bilan, /^Les tests ont échoué/);
  } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
});

// ---------- Les tests Python et la vérification de syntaxe (onglet Tâches : un travail « fait » est vérifié) ----------
const { aDesTests, lancerTestsProjet, verifierSyntaxe, commandePython } = require('../principal/tests-projet');
const { execFileSync } = require('child_process');
const pythonPresent = (() => { try { execFileSync(commandePython(), ['--version'], { stdio: 'ignore', windowsHide: true }); return true; } catch { return false; } })();
const dossierAvec = (fichiers) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-tests-py-'));
  for (const [nom, contenu] of Object.entries(fichiers)) { fs.mkdirSync(path.dirname(path.join(d, nom)), { recursive: true }); fs.writeFileSync(path.join(d, nom), contenu); }
  return d;
};

test('aDesTests : les tests Node et Python sont reconnus', () => {
  assert.equal(aDesTests(['a.js', 'README.md']), false);
  assert.equal(aDesTests(['calcul.test.js']), true);
  assert.equal(aDesTests(['tests/outil.js']), true);
  assert.equal(aDesTests(['backend.py', 'test_backend.py']), true);
  assert.equal(aDesTests(['backend_test.py']), true);
  assert.equal(aDesTests(['tests/test_x.py']), true);
  assert.equal(aDesTests(['backend.py', 'testeur.py']), false);
});

test('lancerTestsProjet : des tests Python (unittest) qui passent, qui échouent, ou aucun', { skip: !pythonPresent && 'Python absent' }, async () => {
  const bon = dossierAvec({ 'calcul.py': 'def somme(a, b):\n    return a + b\n', 'test_calcul.py': 'import unittest\nfrom calcul import somme\nclass T(unittest.TestCase):\n    def test_somme(self):\n        self.assertEqual(somme(2, 3), 5)\n' });
  assert.match(await lancerTestsProjet(bon), /^Tests réussis/);
  assert.equal(fs.existsSync(path.join(bon, '__pycache__')), false, 'pas de __pycache__ laissé dans la copie');
  const faux = dossierAvec({ 'calcul.py': 'def somme(a, b):\n    return a - b\n', 'test_calcul.py': fs.readFileSync(path.join(bon, 'test_calcul.py'), 'utf8') });
  assert.match(await lancerTestsProjet(faux), /^Les tests ont échoué/);
  assert.match(await lancerTestsProjet(dossierAvec({ 'calcul.py': 'x = 1\n' })), /^Aucun test/);
  // Des fonctions test_ sans classe (style pytest) sont lancées aussi, même sans pytest installé
  const style = dossierAvec({ 'test_libre.py': 'def test_ok():\n    assert 1 + 1 == 2\n\ndef test_ko():\n    assert 1 + 1 == 3\n' });
  assert.match(await lancerTestsProjet(style), /^Les tests ont échoué/);
});

test('verifierSyntaxe : un fichier Python ou JavaScript cassé est signalé, un fichier juste non', { skip: !pythonPresent && 'Python absent' }, async () => {
  const d = dossierAvec({ 'ok.py': 'print(1)\n', 'casse.py': 'def f(:\n    pass\n', 'ok.js': 'const a = 1;\n', 'casse.js': 'const = ;\n', 'notes.md': '# rien\n' });
  assert.equal(await verifierSyntaxe(d, ['ok.py', 'ok.js', 'notes.md']), '');
  assert.match(await verifierSyntaxe(d, ['ok.py', 'casse.py']), /casse\.py/);
  assert.match(await verifierSyntaxe(d, ['casse.js']), /casse\.js/);
  assert.equal(await verifierSyntaxe(d, ['absent.py']), '', 'un fichier supprimé n est pas vérifié');
  assert.equal(fs.existsSync(path.join(d, '__pycache__')), false);
});

test('lancerTestsNode suit le script test du package.json (node --test « tests/*.test.js ») : les exemples qui échouent exprès ailleurs ne comptent pas', async () => {
  const d = dossierAvec({
    'package.json': JSON.stringify({ scripts: { test: 'node --test "tests/*.test.js"' } }),
    'tests/ok.test.js': "require('node:test')('ok', () => {});\n",
    'exemples/casse/faux.test.js': "require('node:test')('ko', () => { throw new Error('exprès'); });\n",
  });
  assert.match(await lancerTestsNode(d), /^Tests réussis/);
  // Sans script, tout le dossier est lancé, comme avant
  const sans = dossierAvec({ 'tests/ok.test.js': "require('node:test')('ok', () => {});\n", 'exemples/faux.test.js': "require('node:test')('ko', () => { throw new Error('x'); });\n" });
  assert.match(await lancerTestsNode(sans), /^Les tests ont échoué/);
  // Un script qui n'est pas node --test (jest, npm run…) n'est pas exécuté : on garde node --test
  const autre = dossierAvec({ 'package.json': JSON.stringify({ scripts: { test: 'rm -rf / && jest' } }), 'tests/ok.test.js': "require('node:test')('ok', () => {});\n" });
  assert.match(await lancerTestsNode(autre), /^Tests réussis/);
});

test('executableNode : le Node installé sur le PC lance les tests d un projet (Electron seulement en secours)', () => {
  const { executableNode } = require('../principal/tests-projet');
  let present = true;
  try { execFileSync('node', ['--version'], { stdio: 'ignore', windowsHide: true }); } catch { present = false; }
  assert.equal(executableNode(), present ? 'node' : process.execPath);
});
