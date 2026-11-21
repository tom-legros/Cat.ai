// L'écran de catai : la conversation dans le terminal normal, le cadre de saisie juste en dessous
const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { creerEcran, largeurVisible, couper } = require('../cli/ecran');

function fauxTerminal(rows = 12, columns = 40) {
  const t = { rows, columns, isTTY: true, ecrit: '', write(x) { t.ecrit += x; return true; }, on() {}, off() {} };
  return t;
}
const sansCodes = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
// Les lignes réellement écrites à l'écran, codes retirés
const lignesEcrites = (s) => sansCodes(s).replace(/^\r/, '').split('\r\n');

test('ouvrir : écran vidé, collages signalés, cadre dessiné ; fermer retire le cadre et laisse la conversation', () => {
  const t = fauxTerminal();
  const e = creerEcran({ sortie: t, actif: true });
  e.statut('qwen3 · ~/projet');
  e.ouvrir();
  assert.ok(t.ecrit.startsWith('\x1b[2J\x1b[H\x1b[?2004h'));
  assert.match(sansCodes(t.ecrit), /╭─ qwen3 · ~\/projet ─+╮/);
  e.ecrire('Bonjour\nla suite');
  t.ecrit = '';
  e.fermer();
  // On remonte jusqu'à la ligne commencée, on efface le bas, on la réécrit, puis le terminal reprend la main
  assert.match(t.ecrit, /^\r\x1b\[\d+A\x1b\[Jla suite\x1b\[0m\r\n\x1b\[\?2004l$/);
});

test('ecrire : le texte monte au-dessus du cadre, la ligne commencée est réécrite à chaque morceau', () => {
  const t = fauxTerminal();
  const e = creerEcran({ sortie: t, actif: true });
  e.invite('❯ ');
  e.ouvrir();
  t.ecrit = '';
  e.ecrire('Bonj');
  assert.ok(t.ecrit.includes('\x1b[JBonj\x1b[0m\r\n'), JSON.stringify(t.ecrit));
  t.ecrit = '';
  e.ecrire('our\nsuite');
  // La zone vivante est effacée depuis la ligne commencée (1 ligne + le haut du cadre), puis tout est réécrit
  assert.ok(t.ecrit.includes('\r\x1b[2A\x1b[JBonjour\x1b[0m\r\nsuite\x1b[0m\r\n'), JSON.stringify(t.ecrit));
  // Le curseur finit dans le champ, après « ❯ »
  assert.match(t.ecrit, /\x1b\[3G\x1b\[\?2026l$/);
});

test('une ligne plus large que l écran : ses lignes pleines montent, la suite reste commencée', () => {
  const t = fauxTerminal(12, 20);
  const e = creerEcran({ sortie: t, actif: true });
  e.ouvrir();
  t.ecrit = '';
  e.ecrire('a'.repeat(45));
  const lignes = lignesEcrites(t.ecrit);
  assert.equal(lignes[0], 'a'.repeat(20));
  assert.equal(lignes[1], 'a'.repeat(20));
  assert.equal(lignes[2], 'a'.repeat(5));
});

test('une longue saisie passe à la ligne dans le cadre au lieu de déborder', () => {
  const t = fauxTerminal(20, 30);
  const e = creerEcran({ sortie: t, actif: true });
  const rl = { input: new PassThrough(), line: 'x'.repeat(70), cursor: 70 };
  e.attacher(rl);
  e.invite('❯ ');
  e.ouvrir();
  t.ecrit = '';
  e.ecrire('');
  const lignes = lignesEcrites(t.ecrit).filter((l) => l.includes('x'));
  assert.equal(lignes.length, 3);
  for (const l of lignes) assert.ok(largeurVisible(l) <= 29, l);
  assert.equal(lignes.join('').replace(/[❯ ]/g, ''), 'x'.repeat(70));
});

test('largeur : un emoji compte pour deux colonnes, un accent combiné pour zéro', () => {
  assert.equal(largeurVisible('🐱a'), 3);
  assert.equal(largeurVisible('é'), 1);
  assert.equal(largeurVisible('\x1b[33m●\x1b[0m ok'), 4);
  assert.deepEqual(couper('🐱🐱🐱', 4), ['🐱🐱', '🐱']);
});

function avecEntree() {
  const t = fauxTerminal();
  const e = creerEcran({ sortie: t, actif: true });
  const entree = new PassThrough();
  entree.isTTY = true;
  const recu = [];
  entree.on('data', (d) => recu.push(String(d)));
  e.attacher({ input: entree, line: '', cursor: 0 });
  e.ouvrir();
  return { e, entree, recu };
}

test('un collage de plusieurs lignes devient un seul message, déplié à l envoi', () => {
  const { e, entree, recu } = avecEntree();
  entree.emit('data', Buffer.from('\x1b[200~ligne 1\r\nligne 2\r\nligne 3\x1b[201~'));
  assert.deepEqual(recu, ['[texte collé n°1 · 3 lignes]']);
  assert.equal(e.deplier('voici [texte collé n°1 · 3 lignes] merci'), 'voici ligne 1\nligne 2\nligne 3 merci');
  // Un collage d'une seule ligne passe tel quel
  entree.emit('data', Buffer.from('\x1b[200~une ligne\x1b[201~'));
  assert.equal(recu.at(-1), 'une ligne');
  e.fermer();
});

test('sans les marques du terminal, un collage est deviné : un retour à la ligne suivi aussitôt de texte', async () => {
  const { e, entree, recu } = avecEntree();
  entree.emit('data', Buffer.from('a\rb\rc'));
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(recu, ['[texte collé n°1 · 3 lignes]']);
  // Un Entrée seul, lui, part tout seul après un court instant
  entree.emit('data', Buffer.from('\r'));
  assert.equal(recu.length, 1);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(recu.at(-1), '\r');
  e.fermer();
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

test('couper aux mots : une longue phrase passe à la ligne entre deux mots, un chemin sans espace est coupé net', () => {
  assert.deepEqual(couper('Avec ton outil ajoute une fonction', 16, { mots: true }), ['Avec ton outil', 'ajoute une', 'fonction']);
  assert.deepEqual(couper('C:/un/long/chemin', 8, { mots: true }), ['C:/un/lo', 'ng/chemi', 'n']);
  assert.deepEqual(couper('\x1b[1mgras gras gras\x1b[0m', 10, { mots: true }), ['\x1b[1mgras gras\x1b[0m', '\x1b[1mgras\x1b[0m']);
});
