// Plein écran de catai : écran à part, zone qui défile, état et saisie fixes en bas
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerEcran } = require('../cli/ecran');

function fauxTerminal(rows = 12, columns = 40) {
  const t = { rows, columns, isTTY: true, ecrit: '', write(x) { t.ecrit += x; return true; }, on() {}, off() {} };
  return t;
}

test('ouvrir : écran à part, effacé, zone de défilement au-dessus de l état et de la saisie ; fermer rend l écran d avant', () => {
  const t = fauxTerminal();
  const e = creerEcran({ sortie: t, actif: true });
  e.ouvrir();
  assert.match(t.ecrit, /^\x1b\[\?1049h\x1b\[2J\x1b\[1;8r/);
  e.fermer();
  assert.match(t.ecrit, /\x1b\[r\x1b\[\?1049l$/);
});

test('ecrire : le texte suit la ligne et la colonne, puis le curseur revient dans le champ de saisie', () => {
  const t = fauxTerminal();
  const e = creerEcran({ sortie: t, actif: true });
  e.ouvrir();
  e.invite('❯ ');
  t.ecrit = '';
  e.ecrire('Bonjour');
  assert.ok(t.ecrit.startsWith('\x1b[1;1HBonjour'), JSON.stringify(t.ecrit));
  assert.ok(t.ecrit.endsWith('\x1b[10;3H'), JSON.stringify(t.ecrit)); // la saisie, après « ❯ »
  t.ecrit = '';
  e.ecrire(' toi\nsuite');
  assert.ok(t.ecrit.startsWith('\x1b[1;8H toi\x1b[2;1Hsuite'), JSON.stringify(t.ecrit));
});

test('en bas de la zone, un retour à la ligne fait défiler au lieu de sortir de la zone', () => {
  const t = fauxTerminal(8); // zone : lignes 1 à 6
  const e = creerEcran({ sortie: t, actif: true });
  e.ouvrir();
  e.ecrire('1\n2\n3\n4\n5\n6');
  t.ecrit = '';
  e.ecrire('\n7');
  assert.ok(t.ecrit.startsWith('\x1b[6;2H\n7'), JSON.stringify(t.ecrit));
});

test('hors d un vrai terminal : tout s écrit à la suite, sans aucun code', () => {
  const t = fauxTerminal();
  t.isTTY = false;
  const e = creerEcran({ sortie: t });
  e.ouvrir();
  e.ecrire('texte');
  assert.equal(t.ecrit, 'texte');
  assert.equal(e.ouvert, false);
});
