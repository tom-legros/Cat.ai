// Tests ciblés des noms sensibles, sans réseau et avec des secrets entièrement fictifs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { estSensible, contenuJoint, chercherDansProjet } = require('../principal/fichiers');
const { executerOutil } = require('../principal/agent');

function projetTemporaire(t) {
  const projet = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'catai-secret-lien-')));
  t.after(() => fs.rmSync(projet, { recursive: true, force: true }));
  return projet;
}

test('les noms sensibles restent protégés avec une casse différente', (t) => {
  const projet = projetTemporaire(t);
  for (const nom of ['.ENV', '.Env.Local', 'ID_RSA', 'Cle.PEM', 'Secrets.JSON']) {
    assert.equal(estSensible(nom), true, nom);
    fs.writeFileSync(path.join(projet, nom), 'secret-fictif-pour-test');
    assert.doesNotMatch(contenuJoint(projet, nom), /secret-fictif-pour-test/, nom);
  }
});

test('un lien de nom ordinaire vers .env ne doit pas joindre le secret', async (t) => {
  const projet = projetTemporaire(t);
  const cible = path.join(projet, '.env');
  const lien = path.join(projet, 'configuration.txt');
  // Pas de motif de clé dans le contenu : ce test doit dépendre du nom réel.
  fs.writeFileSync(cible, 'secret-fictif-pour-test');
  // La cible reste dans le projet : on vérifie la protection du secret, pas la sortie du dossier.
  // Linux exécute toujours ce scénario en CI. Windows peut exiger le mode développeur.
  try { fs.symlinkSync(cible, lien, 'file'); } catch (err) {
    if (process.platform === 'win32' && err.code === 'EPERM') {
      t.skip('Windows interdit les liens de fichiers ; scénario couvert sur Linux.');
      return;
    }
    throw err;
  }
  assert.equal(fs.lstatSync(lien).isSymbolicLink(), true);
  assert.equal(fs.realpathSync(lien), fs.realpathSync(cible));
  assert.doesNotMatch(contenuJoint(projet, '.env'), /secret-fictif-pour-test/);
  assert.doesNotMatch(contenuJoint(projet, 'configuration.txt'), /secret-fictif-pour-test/);
  assert.doesNotMatch(chercherDansProjet(projet, 'fictif'), /secret-fictif-pour-test/);
  let confirmations = 0;
  const ctx = { projet: () => projet, ui: { demander: async () => { confirmations++; return false; } } };
  assert.doesNotMatch(await executerOutil('lire_fichier', { chemin: 'configuration.txt' }, ctx), /secret-fictif-pour-test/);
  assert.equal(confirmations, 1);
});
