// Reproduction ciblée : aucune vraie clé ni aucun fichier personnel n'est utilisé.
// Ce test exprime la protection attendue et doit échouer si le renommage la contourne.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { contenuJoint, chercherDansProjet, contenuSensible } = require('../principal/fichiers');
const { executerOutil } = require('../principal/agent');
const { lireTexteDocument } = require('../principal/documents');

test('un secret dans un .env renommé ne doit pas être joint automatiquement', async (t) => {
  const projet = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-secret-renomme-'));
  t.after(() => fs.rmSync(projet, { recursive: true, force: true }));
  const secretFictif = 'CLE_API=secret-fictif-pour-test';
  fs.writeFileSync(path.join(projet, '.env'), secretFictif);

  // Témoin : le nom habituel est effectivement protégé.
  assert.doesNotMatch(contenuJoint(projet, '.env'), /secret-fictif-pour-test/);

  // Le contenu reste identique ; seul le nom change.
  fs.renameSync(path.join(projet, '.env'), path.join(projet, 'configuration.txt'));
  assert.doesNotMatch(contenuJoint(projet, 'configuration.txt'), /secret-fictif-pour-test/);
  assert.doesNotMatch(chercherDansProjet(projet, 'CLE_API'), /secret-fictif-pour-test/);
  const doc = await lireTexteDocument(path.join(projet, 'configuration.txt'), path.join(projet, 'documents'));
  assert.match(doc.erreur, /sensible/);
  assert.equal(fs.existsSync(path.join(projet, 'documents')), false);
  let question;
  const ctx = { projet: () => projet, nomFournisseur: 'Fournisseur test', fournisseurLocal: false,
    ui: { demander: async (q) => { question = q; return false; } } };
  const resultat = await executerOutil('lire_fichier', { chemin: 'configuration.txt' }, ctx);
  assert.doesNotMatch(resultat, /secret-fictif-pour-test/);
  assert.match(question.detail, /Fournisseur test/);
  assert.equal(question.attention, true);
});

test('les secrets reconnaissables sont distingués des modèles vides et du texte ordinaire', () => {
  for (const texte of ['API_KEY=valeur-fictive', '{"password":"valeur-fictive"}', 'export GITHUB_TOKEN=valeur-fictive',
    '-----BEGIN OPENSSH PRIVATE KEY-----\nexemple-fictif', 'cle_api = "valeur-fictive"']) {
    assert.equal(contenuSensible(texte), true, texte);
  }
  for (const texte of ['const a = 1;', 'API_KEY=', 'API_KEY=""', 'CLE_API=a-remplir', 'API_KEY=${API_KEY}',
    'const token = process.env.TOKEN;', 'Le mot secret fait partie du cours.']) {
    assert.equal(contenuSensible(texte), false, texte);
  }
});

test('la lecture confirmée renvoie le contenu présenté, pas un fichier remplacé pendant l’attente', async (t) => {
  const projet = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-lecture-'));
  t.after(() => fs.rmSync(projet, { recursive: true, force: true }));
  const fichier = path.join(projet, '.env');
  fs.writeFileSync(fichier, 'CLE_API=secret-autorise');
  const ctx = { projet: () => projet, fournisseurLocal: true, ui: { demander: async () => {
    fs.writeFileSync(fichier, 'CLE_API=autre-secret-non-autorise');
    return true;
  } } };
  const resultat = await executerOutil('lire_fichier', { chemin: '.env' }, ctx);
  assert.equal(resultat, 'CLE_API=secret-autorise');
});
