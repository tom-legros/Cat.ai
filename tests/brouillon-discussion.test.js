// Le brouillon (texte tapé et pièces jointes) reste avec sa discussion, et on peut renommer une discussion
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
const entre = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));

function cadreBrouillon() {
  const c = vm.createContext({
    brouillons: new Map(), convDuBrouillon: null, current: null, pieces: [], anciens: 'x',
    input: { value: '', style: {}, scrollHeight: 40 },
    renderPieces() { c.affichees = c.pieces.map((p) => p.nom); }, majEnvoi() {},
  });
  vm.runInContext(entre('function rendreTexte(', '// Une génération par discussion'), c);
  return c;
}

test('les pièces jointes et le texte tapé restent dans leur discussion quand on en change', () => {
  const c = cadreBrouillon();
  const a = { id: 'a' }; const b = { id: 'b' };
  c.current = a; c.changerBrouillon();
  c.input.value = 'Question pour A'; c.pieces = [{ nom: 'notes.txt' }];
  c.current = b; c.changerBrouillon();
  assert.equal(c.input.value, '');
  assert.deepEqual([...c.affichees], []);
  c.current = a; c.changerBrouillon();
  assert.equal(c.input.value, 'Question pour A');
  assert.deepEqual([...c.affichees], ['notes.txt']);
  assert.equal(c.brouillons.size, 0);
});

test('la nouvelle discussion pas encore envoyée garde aussi son brouillon', () => {
  const c = cadreBrouillon();
  const a = { id: 'a' };
  c.pieces = [{ nom: 'image.png' }];
  c.current = a; c.changerBrouillon();
  assert.deepEqual([...c.affichees], []);
  c.current = null; c.changerBrouillon();
  assert.deepEqual([...c.affichees], ['image.png']);
});

test('des pièces qui n’ont pas pu partir reviennent dans leur discussion, même si on est ailleurs', () => {
  const c = cadreBrouillon();
  const a = { id: 'a' }; const b = { id: 'b' };
  c.current = b; c.changerBrouillon();
  c.rendrePiecesA(a, [{ nom: 'rapport.pdf' }]);
  c.rendreTexte('Résume ce rapport', a);
  assert.deepEqual([...c.pieces], []);
  assert.equal(c.input.value, '');
  c.current = a; c.changerBrouillon();
  assert.deepEqual([...c.affichees], ['rapport.pdf']);
  assert.equal(c.input.value, 'Résume ce rapport');
});

function cadreTitre() {
  const champs = [];
  const c = vm.createContext({
    saves: 0, save() { c.saves++; },
    document: { createElement: () => { const el = { setAttribute() {}, value: '' }; champs.push(el); return el; } },
  });
  vm.runInContext(entre('const TITRE_MAX', 'function renommerDiscussion('), c);
  return { c, champs };
}

test('renommer : Entrée garde le nouveau titre, Échap annule, un titre vide ne change rien', () => {
  const { c } = cadreTitre();
  const conv = { title: 'Explique en détail, en au moins 8 paragr' };
  let fini = 0;
  const touche = (champ, key) => champ.onkeydown({ key, preventDefault() {}, stopPropagation() {} });

  let champ = c.champTitre(conv, 'x', () => fini++);
  assert.equal(champ.value, conv.title);
  champ.value = '  Le   Web  expliqué ';
  touche(champ, 'Enter');
  champ.onblur(); // le champ disparaît ensuite : ça ne doit pas compter deux fois
  assert.equal(conv.title, 'Le Web expliqué');
  assert.equal(conv.titreChoisi, true);
  assert.equal(c.saves, 1);
  assert.equal(fini, 1);

  champ = c.champTitre(conv, 'x', () => fini++);
  champ.value = 'Autre chose';
  touche(champ, 'Escape');
  assert.equal(conv.title, 'Le Web expliqué');

  champ = c.champTitre(conv, 'x', () => fini++);
  champ.value = '   ';
  champ.onblur();
  assert.equal(conv.title, 'Le Web expliqué');
  assert.equal(c.saves, 1);
});

test('renommer : le crayon, le double-clic et F2 mènent au même champ', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(html, /id="renommer-conv"[^>]*aria-label="Renommer la discussion"/);
  assert.match(source, /ouvrir\.ondblclick = \(\) => renommerDansListe\(/);
  assert.match(source, /\$\("#titre-conv"\)\.ondblclick = \(\) => renommerDiscussion\(\)/);
  assert.match(source, /e\.key !== "F2"/);
});

test('un tableau large défile au lieu de couper les mots, et les titres des réponses ne sont pas en police pixel', () => {
  const css = fs.readFileSync(path.join(__dirname, '../style.css'), 'utf8');
  assert.match(css, /\.bulle-msg table \{[^}]*overflow-x: auto/);
  assert.match(css, /\.bulle-msg th, \.bulle-msg td \{[^}]*overflow-wrap: normal/);
  assert.match(css, /\.bulle-msg h1, \.bulle-msg h2, \.bulle-msg h3, \.bulle-msg h4 \{[^}]*var\(--police-texte\)/);
});
