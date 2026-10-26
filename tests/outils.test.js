// Outils du modèle : règles d'écriture par mode et par rôle, remplacer_texte, appels d'outils écrits en texte
const test = require('node:test');
const assert = require('node:assert/strict');
const { outilsPour, ecritureRefusee, remplacerTexte, parseTextToolCalls, matchingBrace } = require('../principal/outils');

const noms = (mode) => outilsPour(mode).map((t) => t.function.name);

test('outils d écriture proposés en généraliste, débogueur et rédacteur README', () => {
  for (const mode of [{}, { role: 'debogueur' }, { role: 'readme' }]) {
    assert.ok(noms(mode).includes('ecrire_fichier') && noms(mode).includes('remplacer_texte'), JSON.stringify(mode));
  }
});

test('outils d écriture retirés en mode prof et pour le relecteur, lecture et recherche gardées', () => {
  for (const mode of [{ prof: true }, { role: 'relecteur' }, { prof: true, role: 'debogueur' }]) {
    assert.ok(!noms(mode).includes('ecrire_fichier') && !noms(mode).includes('remplacer_texte'), JSON.stringify(mode));
    assert.ok(noms(mode).includes('lire_fichier') && noms(mode).includes('chercher'));
  }
});

test('ecritureRefusee : mode prof prioritaire, relecteur, rédacteur README limité aux .md', () => {
  assert.equal(ecritureRefusee({}, 'main.js'), undefined);
  assert.equal(ecritureRefusee({ role: 'readme' }, 'README.md'), undefined);
  assert.equal(ecritureRefusee({ role: 'readme' }, 'docs/guide.MD'), undefined);
  assert.match(ecritureRefusee({ role: 'readme' }, 'notes.js'), /Markdown/);
  assert.match(ecritureRefusee({ role: 'relecteur' }, 'README.md'), /relecteur/);
  assert.match(ecritureRefusee({ prof: true, role: 'readme' }, 'README.md'), /Mode prof/);
});

test('chaque refus interdit au modèle de prétendre que le fichier a changé', () => {
  for (const [mode, chemin] of [[{ prof: true }, 'a.js'], [{ role: 'relecteur' }, 'a.js'], [{ role: 'readme' }, 'a.js']]) {
    assert.match(ecritureRefusee(mode, chemin), /ne dis pas à l’utilisateur qu'il est modifié/);
  }
});

const code = 'function moyenne(notes) {\n  for (let i = 0; i <= notes.length; i++) total += notes[i];\n}\n';

test('remplacer_texte : 1 occurrence remplacée, le reste intact', () => {
  assert.deepEqual(remplacerTexte(code, 'i <= notes.length', 'i < notes.length'), { contenu: code.replace('<=', '<'), fois: 1 });
});

test('remplacer_texte : 0 occurrence, erreur qui dit de relire le fichier', () => {
  assert.match(remplacerTexte(code, 'i <= note.length', 'x').erreur, /introuvable.*lire_fichier/s);
});

test('remplacer_texte : plusieurs occurrences, erreur avec le nombre et rien de remplacé', () => {
  assert.match(remplacerTexte('a = 1;\nb = 1;\n', ' = 1;', ' = 2;').erreur, /apparaît 2 fois.*remplacer_partout/s);
});

test('remplacer_texte : remplacer partout (renommage), avec le nombre de remplacements', () => {
  const avant = 'function calculer(f) {}\nmodule.exports = { calculer };\n';
  assert.deepEqual(remplacerTexte(avant, 'calculer', 'evaluerFormule', true), {
    contenu: 'function evaluerFormule(f) {}\nmodule.exports = { evaluerFormule };\n',
    fois: 2,
  });
});

test('remplacer_texte : ancien texte vide refusé, nouveau texte vide = suppression', () => {
  assert.match(remplacerTexte(code, '', 'x').erreur, /vide/);
  assert.equal(remplacerTexte('a\nb\n', 'a\nb', '').contenu, '\n');
});

test('remplacer_texte : $1 et $& recopiés tels quels (pas d effet String.replace)', () => {
  assert.equal(remplacerTexte('$x = 1;', '$x = 1;', '$x = $1 . "$&";').contenu, '$x = $1 . "$&";');
  assert.equal(remplacerTexte('$a $a', '$a', '$1', true).contenu, '$1 $1');
});

test('remplacer_texte : fichier Windows (CRLF), passage du modèle en LF', () => {
  const windows = 'ligne 1\r\nligne 2\r\nligne 3\r\n';
  assert.equal(remplacerTexte(windows, 'ligne 2\nligne 3', 'deux\ntrois').contenu, 'ligne 1\r\ndeux\r\ntrois\r\n');
});

test('remplacer_texte : retours à la ligne « échappés deux fois » par qwen3', () => {
  // String.raw garde \n tel quel : deux caractères, comme dans les arguments envoyés par qwen3
  const fichier = 'function calculer(formule) {\n  return eval(formule);\n}\n';
  const envoye = String.raw`function calculer(formule) {\n  return eval(formule);\n}`;
  const resultat = remplacerTexte(fichier, envoye, envoye.replace('calculer', 'evaluer'));
  assert.equal(resultat.contenu, 'function evaluer(formule) {\n  return eval(formule);\n}\n');
});

test('remplacer_texte : un vrai \\n dans une chaîne du code reste trouvé tel quel', () => {
  const fichier = String.raw`console.log("a\nb");` + '\n';
  assert.equal(remplacerTexte(fichier, String.raw`console.log("a\nb");`, 'console.log("c");').contenu, 'console.log("c");\n');
});

test('parseTextToolCalls : appel d outil écrit en JSON dans le texte', () => {
  const texte = 'Je regarde.\n{"name": "lire_fichier", "arguments": {"chemin": "main.js"}}';
  assert.deepEqual(parseTextToolCalls(texte), [{ function: { name: 'lire_fichier', arguments: { chemin: 'main.js' } } }]);
});

test('parseTextToolCalls : arguments en texte JSON, ou sous le nom parameters', () => {
  assert.deepEqual(parseTextToolCalls('{"name":"chercher","arguments":"{\\"texte\\":\\"x\\"}"}')[0].function.arguments, { texte: 'x' });
  assert.deepEqual(parseTextToolCalls('{"name":"lister_fichiers","parameters":{"dossier":"src"}}')[0].function.arguments, { dossier: 'src' });
});

test('parseTextToolCalls : ignore les objets qui ne sont pas des outils, et le JSON cassé', () => {
  assert.deepEqual(parseTextToolCalls('{"name": "supprimer_tout", "arguments": {}}'), []);
  assert.deepEqual(parseTextToolCalls('const x = { a: 1 }; {"name": "lire_fichier", "arguments": {"chemin": "a'), []);
});

test('parseTextToolCalls : plusieurs appels dans la même réponse', () => {
  const texte = '{"name":"lire_fichier","arguments":{"chemin":"a.js"}} puis {"name":"lire_fichier","arguments":{"chemin":"b.js"}}';
  assert.deepEqual(parseTextToolCalls(texte).map((c) => c.function.arguments.chemin), ['a.js', 'b.js']);
});

test('matchingBrace : ignore les accolades dans les chaînes, -1 si pas fermée', () => {
  const s = '{"a": "}{", "b": {"c": 1}} fin';
  assert.equal(matchingBrace(s, 0), s.indexOf(' fin') - 1);
  assert.equal(matchingBrace('{"a": "\\"}"}', 0), 11);
  assert.equal(matchingBrace('{"a": 1', 0), -1);
});
