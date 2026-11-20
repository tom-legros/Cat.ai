// Copie de travail du mode Auto (principal/copie-agent.js), sur de vrais dépôts git temporaires
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { preparerCopie, changementsCopie, garderCopie, jeterCopie, trouverCopie, brancheDe } = require('../principal/copie-agent');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function depot(t, { crlf = false } = {}) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-copie-'));
  t.after(() => fs.rmSync(racine, { recursive: true, force: true }));
  const projet = path.join(racine, 'projet');
  fs.mkdirSync(path.join(projet, 'src'), { recursive: true });
  fs.writeFileSync(path.join(projet, 'a.js'), 'un\ndeux\n');
  fs.writeFileSync(path.join(projet, 'src', 'b.js'), 'b\n');
  fs.writeFileSync(path.join(projet, '.gitignore'), 'secret.txt\n');
  git(projet, 'init', '-q'); git(projet, 'config', 'core.autocrlf', crlf ? 'true' : 'false'); git(projet, 'add', '.');
  git(projet, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'base');
  if (crlf) { // comme un vrai projet sous Windows : les fichiers sortis de git sont en CRLF
    for (const f of ['a.js', 'src/b.js', '.gitignore']) fs.rmSync(path.join(projet, f));
    git(projet, 'checkout', '--', '.');
  }
  return { projet, copies: path.join(racine, 'copies') };
}

test('preparerCopie : la copie part de l état exact du projet, changements et nouveaux fichiers compris, sans les ignorés', (t) => {
  const { projet, copies } = depot(t);
  fs.writeFileSync(path.join(projet, 'a.js'), 'un\ndeux modifié\n');
  fs.writeFileSync(path.join(projet, 'nouveau.js'), 'nouveau\n');
  fs.writeFileSync(path.join(projet, 'secret.txt'), 'ne pas copier\n');
  const c = preparerCopie(projet, copies, 'essai');
  assert.equal(fs.readFileSync(path.join(c.copie, 'a.js'), 'utf8'), 'un\ndeux modifié\n');
  assert.equal(fs.readFileSync(path.join(c.copie, 'nouveau.js'), 'utf8'), 'nouveau\n');
  assert.equal(fs.existsSync(path.join(c.copie, 'secret.txt')), false);
  assert.equal(git(c.copie, 'symbolic-ref', '--short', 'HEAD'), brancheDe('essai'));
  assert.equal(c.dossier, c.copie);
  assert.equal(changementsCopie(c.copie, c.base).fichiers.length, 0, 'aucun changement au départ');
  // Le projet n'a pas bougé
  assert.equal(git(projet, 'symbolic-ref', '--short', 'HEAD'), git(projet, 'symbolic-ref', '--short', 'HEAD'));
  assert.equal(fs.readFileSync(path.join(projet, 'a.js'), 'utf8'), 'un\ndeux modifié\n');
});

test('changementsCopie puis garderCopie : les fichiers du projet reçoivent les changements, sans commit, et la copie disparaît', (t) => {
  const { projet, copies } = depot(t);
  const commits = git(projet, 'rev-list', '--count', 'HEAD');
  const c = preparerCopie(projet, copies, 'garder');
  fs.writeFileSync(path.join(c.copie, 'a.js'), 'un\ndeux\ntrois\n');
  fs.writeFileSync(path.join(c.copie, 'src', 'c.js'), 'c\nc\n');
  fs.rmSync(path.join(c.copie, 'src', 'b.js'));
  const ch = changementsCopie(c.copie, c.base, { patch: true });
  assert.deepEqual(ch.fichiers.map((f) => f.chemin).sort(), ['a.js', 'src/b.js', 'src/c.js']);
  assert.equal(ch.ajouts, 3); assert.equal(ch.retraits, 1);
  assert.match(ch.patch, /^\+trois$/m);
  assert.deepEqual(garderCopie(c.copie, c.base, 'garder'), { ok: true });
  assert.equal(fs.readFileSync(path.join(projet, 'a.js'), 'utf8'), 'un\ndeux\ntrois\n');
  assert.equal(fs.readFileSync(path.join(projet, 'src', 'c.js'), 'utf8'), 'c\nc\n');
  assert.equal(fs.existsSync(path.join(projet, 'src', 'b.js')), false);
  assert.equal(git(projet, 'rev-list', '--count', 'HEAD'), commits, 'aucun commit dans le projet');
  assert.equal(trouverCopie(projet, 'garder'), null);
  assert.equal(git(projet, 'branch', '--list', brancheDe('garder')), '');
});

test('garderCopie : si le projet a changé au même endroit, rien n est appliqué et la copie reste', (t) => {
  const { projet, copies } = depot(t);
  const c = preparerCopie(projet, copies, 'conflit');
  fs.writeFileSync(path.join(c.copie, 'a.js'), 'un\nDEUX agent\n');
  fs.writeFileSync(path.join(projet, 'a.js'), 'un\nDEUX utilisateur\n');
  const r = garderCopie(c.copie, c.base, 'conflit');
  assert.equal(r.ok, false); assert.match(r.erreur, /rien n'a été appliqué/);
  assert.equal(fs.readFileSync(path.join(projet, 'a.js'), 'utf8'), 'un\nDEUX utilisateur\n');
  assert.ok(trouverCopie(projet, 'conflit'));
});

test('jeterCopie : la copie et sa branche disparaissent, le projet et ses dépendances restent', (t) => {
  const { projet, copies } = depot(t);
  fs.mkdirSync(path.join(projet, 'node_modules', 'dep'), { recursive: true });
  fs.writeFileSync(path.join(projet, 'node_modules', 'dep', 'index.js'), 'dep\n');
  fs.writeFileSync(path.join(projet, '.gitignore'), 'secret.txt\nnode_modules\n');
  const c = preparerCopie(projet, copies, 'jeter');
  assert.ok(fs.existsSync(path.join(c.copie, 'node_modules', 'dep', 'index.js')), 'lien vers les dépendances');
  fs.writeFileSync(path.join(c.copie, 'a.js'), 'jeté\n');
  assert.deepEqual(jeterCopie(projet, 'jeter'), { ok: true });
  assert.equal(fs.existsSync(c.copie), false);
  assert.equal(git(projet, 'branch', '--list', brancheDe('jeter')), '');
  assert.equal(fs.readFileSync(path.join(projet, 'node_modules', 'dep', 'index.js'), 'utf8'), 'dep\n');
  assert.equal(fs.readFileSync(path.join(projet, 'a.js'), 'utf8'), 'un\ndeux\n');
});

test('sous-dossier du dépôt : l agent travaille dans le même sous-dossier de la copie ; nom invalide refusé', (t) => {
  const { projet, copies } = depot(t);
  const c = preparerCopie(path.join(projet, 'src'), copies, 'sous');
  assert.equal(c.dossier, path.join(c.copie, 'src'));
  assert.throws(() => preparerCopie(projet, copies, '../evasion'), /invalide/);
  assert.throws(() => jeterCopie(projet, 'a b'), /invalide/);
});

test('Windows (autocrlf) : fichiers en CRLF, garder applique bien les changements', (t) => {
  const { projet, copies } = depot(t, { crlf: true });
  assert.equal(fs.readFileSync(path.join(projet, 'a.js'), 'utf8'), 'un\r\ndeux\r\n');
  const c = preparerCopie(projet, copies, 'crlf');
  assert.equal(changementsCopie(c.copie, c.base).fichiers.length, 0);
  fs.writeFileSync(path.join(c.copie, 'a.js'), 'un\r\ndeux\r\ntrois\r\n');
  const ch = changementsCopie(c.copie, c.base);
  assert.equal(ch.ajouts, 1); assert.equal(ch.retraits, 0);
  assert.deepEqual(garderCopie(c.copie, c.base, 'crlf'), { ok: true });
  assert.match(fs.readFileSync(path.join(projet, 'a.js'), 'utf8'), /^un\r?\ndeux\r?\ntrois\r?\n$/);
});

