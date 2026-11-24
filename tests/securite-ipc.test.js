// Comme les tests IPC existants, exécute les vrais handlers avec Electron simulé.
// Aucun démarrage de fenêtre, aucun trousseau personnel et aucun appel réseau.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const fichiers = require('../principal/fichiers');
const documents = require('../principal/documents');
const { ecrireAvecAccord } = require('../principal/agent');
const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8').replace(/\r\n/g, '\n');

function handler(nom, globals) {
  const debut = source.indexOf(`ipcMain.handle('${nom}',`);
  const fin = source.indexOf('\n});', debut);
  assert.ok(debut >= 0 && fin > debut, `handler ${nom} trouvé`);
  let fonction;
  vm.runInNewContext(source.slice(debut, fin + 4), { ...globals, ipcMain: { handle: (_, fn) => { fonction = fn; } } });
  return fonction;
}

test('enregistrement d’une clé : aucun chiffrement ni stockage si le coffre est refusé', async () => {
  const enregistrer = handler('fournisseurs-enregistrer', {
    FOURNISSEURS_DE_BASE: [{ id: 'groq', type: 'openai' }],
    etatChiffrement: async () => ({ dispo: false, raison: 'coffre refusé' }),
    chiffrer: () => assert.fail('ne doit pas chiffrer'),
    lireReglagesFournisseurs: () => assert.fail('ne doit pas lire les réglages'),
    writeJson: () => assert.fail('ne doit pas enregistrer'),
  });
  const resultat = await enregistrer(null, { id: 'groq', cle: 'cle-fictive' });
  assert.equal(resultat.ok, false);
  assert.match(resultat.erreur, /coffre refusé/);
});

test('pièce jointe : un secret renommé est refusé sans être renvoyé à l’interface', async (t) => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-ipc-'));
  t.after(() => fs.rmSync(dossier, { recursive: true, force: true }));
  const fichier = path.join(dossier, 'configuration.txt');
  fs.writeFileSync(fichier, 'CLE_API=secret-fictif');
  const lire = handler('read-dropped', { fs, path, ...fichiers, ...documents, IMAGES: /\.(png|jpe?g)$/i });
  const resultat = await lire(null, fichier);
  assert.match(resultat.erreur, /sensible/);
  assert.equal(JSON.stringify(resultat).includes('secret-fictif'), false);
  fs.writeFileSync(fichier, 'Texte ordinaire');
  assert.equal((await lire(null, fichier)).contenu, 'Texte ordinaire');
});

test('bouton Enregistrer : un changement de projet pendant l’accord annule l’écriture', async (t) => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-bouton-'));
  t.after(() => fs.rmSync(racine, { recursive: true, force: true }));
  const premier = path.join(racine, 'premier');
  const second = path.join(racine, 'second');
  fs.mkdirSync(premier); fs.mkdirSync(second);
  const contexte = { projectDir: premier, ecrireAvecAccord };
  contexte.demanderConfirmation = async () => { contexte.projectDir = second; return true; };
  const debut = source.indexOf('async function writeWithConfirm(');
  const fin = source.indexOf('// Bouton "Enregistrer"', debut);
  assert.ok(debut >= 0 && fin > debut);
  vm.runInNewContext(source.slice(debut, fin), contexte);
  assert.match(await contexte.writeWithConfirm('note.txt', 'test'), /Écriture annulée/);
  assert.equal(fs.existsSync(path.join(premier, 'note.txt')), false);
  assert.equal(fs.existsSync(path.join(second, 'note.txt')), false);
});
