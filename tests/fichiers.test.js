// Fichiers du projet : le modèle reste dans le dossier ouvert, les secrets ne partent pas tout seuls.
// Les tests construisent un « projet piégé » dans un dossier temporaire : un .env, des clés, un fichier
// binaire, un lien qui mène dehors et un lien cassé.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cheminSur, estSensible, listFiles, chercherDansProjet, fichiersCites, contenuJoint } = require('../principal/fichiers');

const racine = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chatnoir-piege-')));
const projet = path.join(racine, 'projet');
const dehors = path.join(racine, 'dehors');
const ecrire = (chemin, texte) => {
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  fs.writeFileSync(chemin, texte);
};
ecrire(path.join(dehors, 'secret.txt'), 'MOT_DE_PASSE=dehors');
ecrire(path.join(projet, '.env'), 'CLE_API=sk-secret');
ecrire(path.join(projet, '.env.example'), 'CLE_API=a-remplir');
ecrire(path.join(projet, 'cle.pem'), 'PRIVATE');
ecrire(path.join(projet, 'id_rsa'), 'PRIVATE');
ecrire(path.join(projet, 'id_rsa.pub'), 'ssh-rsa PUBLIC');
ecrire(path.join(projet, 'notes.js'), 'console.log(1)');
ecrire(path.join(projet, 'a'), 'a');
ecrire(path.join(projet, 'test'), 'test');
ecrire(path.join(projet, 'Makefile'), 'all:');
ecrire(path.join(projet, 'src', 'app.js'), 'app');
ecrire(path.join(projet, 'src', 'utils.js'), 'utils');
fs.writeFileSync(path.join(projet, 'image.png'), Buffer.from([137, 80, 78, 71, 0, 0, 0, 1]));
// « junction » : une jonction sur Windows (pas besoin d'être administrateur), un lien de dossier ailleurs
fs.symlinkSync(dehors, path.join(projet, 'sortie'), 'junction');
const disparu = path.join(racine, 'disparu');
fs.mkdirSync(disparu);
fs.symlinkSync(disparu, path.join(projet, 'casse'), 'junction');
fs.rmdirSync(disparu);
test.after(() => fs.rmSync(racine, { recursive: true, force: true }));

const refuse = (rel, motif = /en dehors du projet/) => assert.throws(() => cheminSur(projet, rel), motif);

test('cheminSur : fichier du projet, et fichier pas encore créé', () => {
  assert.equal(cheminSur(projet, 'notes.js'), path.join(projet, 'notes.js'));
  assert.equal(cheminSur(projet, 'src/nouveau/fichier.js'), path.join(projet, 'src', 'nouveau', 'fichier.js'));
});

test('cheminSur : .., chemin absolu, dossier voisin qui commence pareil', () => {
  refuse('../dehors/secret.txt');
  refuse(path.join(racine, 'dehors', 'secret.txt'));
  refuse('../projet-copie/a.js');
});

test('cheminSur : un lien (jonction) qui mène dehors est refusé, même pour créer un fichier dedans', () => {
  refuse('sortie/secret.txt');
  refuse('sortie');
  refuse('sortie/nouveau.txt');
});

test('cheminSur : un lien cassé est refusé', () => {
  refuse('casse', /destination n'existe pas/);
  refuse('casse/a.txt', /destination n'existe pas|en dehors/);
});

test('cheminSur : sans dossier ouvert, erreur claire', () => {
  assert.throws(() => cheminSur(null, 'a.js'), /Aucun dossier projet ouvert/);
});

test('listFiles : ne descend pas dans un lien, ignore node_modules', () => {
  ecrire(path.join(projet, 'node_modules', 'x', 'index.js'), 'x');
  const liste = listFiles(projet);
  assert.ok(liste.includes('sortie') && !liste.some((f) => f.startsWith('sortie/')));
  assert.ok(!liste.some((f) => f.startsWith('node_modules')));
  assert.ok(liste.includes('src/') && liste.includes('src/app.js'));
});

test('estSensible : .env, clés et jetons repérés ; modèles, clés publiques et fichiers ordinaires laissés', () => {
  for (const nom of ['.env', '.env.local', '.env.production', 'cle.pem', 'id_rsa', 'server.key', '.npmrc', 'secrets.json', 'config/.env']) {
    assert.ok(estSensible(nom), nom);
  }
  for (const nom of ['.env.example', '.env.sample', 'id_rsa.pub', 'notes.js', 'environment.ts', 'keys.js', 'README.md']) {
    assert.equal(estSensible(nom), false, nom);
  }
});

const cites = (message) => fichiersCites(message, listFiles(projet));

test('fichiers cités : les noms courts sans extension ne sont plus cités par hasard', () => {
  assert.deepEqual(cites('fais un test avec a, puis une api'), []);
});

test('fichiers cités : nom entier seulement, fin de phrase comprise', () => {
  assert.deepEqual(cites('regarde notes.js stp'), ['notes.js']);
  assert.deepEqual(cites('tu peux lire notes.js.'), ['notes.js']);
  assert.deepEqual(cites('le Makefile plante'), ['Makefile']);
  assert.deepEqual(cites('dans notes.js.bak ou mynotes.js, rien'), []);
});

test('fichiers cités : chemin complet (même écrit avec \\) avant les simples noms', () => {
  assert.deepEqual(cites('compare app.js et src\\utils.js'), ['src/utils.js', 'src/app.js']);
});

test('contenu joint : .env jamais, .env.example oui, binaire et lien refusés', () => {
  assert.match(contenuJoint(projet, '.env'), /sensible, pas joint/);
  assert.equal(contenuJoint(projet, '.env.example'), 'CLE_API=a-remplir');
  assert.match(contenuJoint(projet, 'image.png'), /binaire/);
  assert.match(contenuJoint(projet, 'sortie/secret.txt'), /en dehors du projet/);
  assert.equal(contenuJoint(projet, 'notes.js'), 'console.log(1)');
});

const chercher = (texte, options) => chercherDansProjet(projet, texte, options);
const premiere = (resultat) => resultat.split('\n')[0];

test('chercher : fichier:ligne: extrait, majuscules et minuscules confondues', () => {
  assert.equal(premiere(chercher('console')), 'notes.js:1: console.log(1)');
  assert.equal(premiere(chercher('CONSOLE.LOG')), 'notes.js:1: console.log(1)');
});

test('chercher : .env et clés jamais fouillés, et le modèle sait combien ont été sautés', () => {
  const resultat = chercher('CLE_API');
  assert.ok(resultat.includes('.env.example:1: CLE_API=a-remplir'));
  assert.ok(!resultat.includes('sk-secret'));
  assert.match(resultat, /3 fichiers sensibles, comme \.env, non fouillés/);
});

test('chercher : le lien qui mène dehors et le fichier binaire ne sont pas fouillés', () => {
  assert.match(chercher('MOT_DE_PASSE'), /^Aucun résultat/);
  assert.match(chercher('PNG'), /^Aucun résultat/);
});

test('chercher : expressions régulières, et erreur claire si elle est invalide', () => {
  assert.match(chercher('app|utils', { regex: true }), /src\/app\.js:1: app\nsrc\/utils\.js:1: utils/);
  assert.match(chercher('(', { regex: true }), /Expression régulière invalide/);
  assert.match(chercher('x'.repeat(201), { regex: true }), /trop longue/);
});

test('chercher : sous-dossier (même avec \\), refusé s il sort du projet', () => {
  assert.equal(chercher('app', { dossier: 'src\\' }), 'src/app.js:1: app');
  assert.throws(() => chercher('x', { dossier: '../dehors' }), /en dehors du projet/);
  assert.throws(() => chercher('x', { dossier: 'sortie' }), /en dehors du projet/);
  assert.match(chercher('x', { dossier: 'notes.js' }), /n'est pas un dossier/);
});

test('chercher : plus de 50 résultats, coupé à 50 avec une consigne pour préciser', () => {
  ecrire(path.join(projet, 'src', 'beaucoup.txt'), Array.from({ length: 60 }, (_, i) => `ligne trouvee ${i}`).join('\n'));
  const resultat = chercher('ligne trouvee');
  assert.equal(resultat.split('\n').filter((l) => l.startsWith('src/beaucoup.txt:')).length, 50);
  assert.match(resultat, /et d'autres résultats : précise ta recherche/);
});
