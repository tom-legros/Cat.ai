// QCM cliquables : le bloc ```qcm (la bonne réponse est la première) ou ```choix, le mélange, le bilan, le mode prof
const test = require('node:test');
const assert = require('node:assert/strict');
const { lireQcm, melangerQcm, bilanQcm, indexBonneReponse } = require('../interface/qcm');
const { creerFiltreCode } = require('../principal/prof');

const QUIZ = `Q: Où se fait la photosynthèse ?
A) Dans les chloroplastes
B) Dans les mitochondries
C) Dans le noyau
> Les chloroplastes contiennent la chlorophylle.

Q: Quel gaz la plante rejette-t-elle ?
A) Du dioxygène
B) Du méthane
> Le dioxygène vient de l'eau.`;

test('le format texte : la bonne réponse est la première, « > » donne l explication', () => {
  const q = lireQcm(QUIZ);
  assert.equal(q.quiz, true);
  assert.equal(q.questions.length, 2);
  assert.deepEqual(q.questions[0], { question: 'Où se fait la photosynthèse ?', choix: ['Dans les chloroplastes', 'Dans les mitochondries', 'Dans le noyau'], bonne: 0, explication: 'Les chloroplastes contiennent la chlorophylle.' });
  assert.equal(q.questions[1].bonne, 0);
});

test('SQL : le « * » fait partie de la réponse (SELECT *), il n est ni retiré ni pris pour une marque', () => {
  const q = lireQcm('Q: Comment sélectionner toutes les colonnes ?\nA) SELECT *\nB) SELECT ALL\nC) GET *');
  assert.deepEqual(q.questions[0].choix, ['SELECT *', 'SELECT ALL', 'GET *']);
  assert.equal(q.questions[0].bonne, 0);
});

test('la bonne réponse pas mise en A : l explication qui nomme un seul autre choix la retrouve', () => {
  // Vu avec qwen3.5:4b : INSERT INTO laissé en C, mais l'explication le nomme
  const q = lireQcm('Q: Comment ajoute-t-on une ligne ?\nA) SELECT\nB) UPDATE\nC) INSERT INTO\nD) DELETE FROM\n> La commande INSERT INTO permet d insérer de nouvelles données.');
  assert.equal(q.questions[0].bonne, 2);
  // L'explication cite A : A reste la bonne, même si elle nomme aussi un autre choix
  assert.equal(lireQcm('Q: Filtrer ?\nA) WHERE\nB) ORDER BY\n> WHERE filtre, contrairement à ORDER BY qui trie.').questions[0].bonne, 0);
  // Elle cite deux autres choix : on ne devine pas, A reste
  assert.equal(lireQcm('Q: ?\nA) un\nB) deux\nC) trois\n> Ni deux ni trois.').questions[0].bonne, 0);
  // Pas d'explication : A
  assert.equal(lireQcm('Q: ?\nA) un\nB) deux').questions[0].bonne, 0);
});

test('une marque explicite (✓, « Réponse : B ») est respectée', () => {
  assert.equal(lireQcm('Q: 2+2 ?\nA) 3\nB) 4 ✓').questions[0].bonne, 1);
  const q = lireQcm(`1. Combien font 2 + 2 ?\nA. 3\nB. 4\nC. 5\nRéponse : B\nExplication : deux et deux font quatre.`);
  assert.equal(q.questions[0].question, 'Combien font 2 + 2 ?');
  assert.deepEqual(q.questions[0].choix, ['3', '4', '5']);
  assert.equal(q.questions[0].bonne, 1);
  assert.equal(q.questions[0].explication, 'deux et deux font quatre.');
});

test('un bloc ```choix : une seule question, sans bonne réponse ni mélange', () => {
  const q = lireQcm(`Q: Tu veux quelle fiche ?\nA) Courte\nB) Détaillée`, { choix: true });
  assert.equal(q.quiz, false);
  assert.equal(q.questions[0].bonne, null);
  assert.equal(melangerQcm(q), q);
});

test('le format JSON est accepté (bonne réponse par lettre, numéro à partir de 1 ou texte ; la première sinon)', () => {
  const q = lireQcm('{"questions":[{"question":"1+1 ?","choix":["A) 1","B) 2"],"reponse":"B","explication":"facile"},{"question":"2+2 ?","choix":["4","5"],},]}');
  assert.deepEqual(q.questions.map((x) => x.bonne), [1, 0]);
  assert.deepEqual(q.questions[0].choix, ['1', '2']);
  assert.equal(indexBonneReponse('Rome', ['Milan', 'Rome']), 1);
  assert.equal(indexBonneReponse('2', ['a', 'b']), 1);
  assert.equal(indexBonneReponse('Z', ['a', 'b']), null);
});

test('mélange : la bonne réponse suit son texte, le même QCM garde le même ordre, et elle n est plus toujours en A', () => {
  const q = lireQcm(QUIZ);
  const m = melangerQcm(q);
  m.questions.forEach((x, i) => assert.equal(x.choix[x.bonne], q.questions[i].choix[q.questions[i].bonne]));
  assert.deepEqual(melangerQcm(lireQcm(QUIZ)), m);
  const vingt = lireQcm(Array.from({ length: 20 }, (_, i) => `Q: Question ${i} ?\nA) bon ${i}\nB) faux ${i}\nC) autre ${i}`).join('\n'));
  assert.ok(melangerQcm(vingt).questions.some((x) => x.bonne !== 0));
});

test('une explication qui cite une lettre est corrigée (les choix sont mélangés à l affichage)', () => {
  assert.equal(lireQcm('Q: 1+1 ?\nA) 2\nB) 3\n> La réponse A est juste car 1+1=2.').questions[0].explication, 'La bonne réponse est juste car 1+1=2.');
});

test('un bloc inutilisable donne null (il reste affiché tel quel) ; une question à un seul choix est ignorée', () => {
  assert.equal(lireQcm(''), null);
  assert.equal(lireQcm('{pas du json'), null);
  assert.equal(lireQcm('Q: Seule ?\nA) Oui'), null);
});

test('le bilan : le score, et les erreurs avec la bonne réponse, pour que le chat les explique', () => {
  const q = lireQcm(QUIZ);
  const b = bilanQcm(q, [2, 0]);
  assert.equal(b.bonnes, 1);
  assert.equal(b.total, 2);
  assert.match(b.texte, /^J'ai fait le QCM : 1\/2\./);
  assert.match(b.texte, /« Où se fait la photosynthèse \? » : j'ai répondu « Dans le noyau », la bonne réponse était « Dans les chloroplastes »/);
  assert.match(b.texte, /Explique-moi mes erreurs/);
  assert.match(bilanQcm(q, [0, 0]).texte, /Tout juste/);
});

test('mode prof : les blocs qcm et choix passent tels quels, même coupés ; un bloc de code reste retiré', () => {
  let sortie = '';
  const f = creerFiltreCode((t) => { sortie += t; });
  for (const morceau of ['Teste-toi :\n``', '`q', 'cm\nQ: 1+1 ?\nA) 2\nB) 3\n`', '``\nPuis ```ch', 'oix\nQ: Suite ?\nA) Oui\nB) Non\n```\nEt du code : ```js\nx()\n```\nFin.']) f.morceau(morceau);
  f.fin();
  assert.match(sortie, /```qcm\nQ: 1\+1 \?\nA\) 2\nB\) 3\n```/);
  assert.match(sortie, /```choix\nQ: Suite \?\nA\) Oui\nB\) Non\n```/);
  assert.match(sortie, /Mode prof : bloc de code retiré/);
  assert.doesNotMatch(sortie, /x\(\)/);
  assert.match(sortie, /Fin\./);
});

test('app : les blocs deviennent des cartes, la consigne explique le format, le script est chargé avant renderer.js', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const markdown = lire('interface/markdown.js');
  assert.match(markdown, /if \(langage === "qcm"\) return `<div class="qcm" data-qcm=/);
  assert.match(markdown, /if \(langage === "choix"\) return `<div class="qcm" data-qcm="\$\{escape\(text\)\}" data-choix="1">/);
  assert.match(lire('renderer.js'), /animerQcm\(flux\.el, \{ envoyer: envoyerDepuisQcm\(flux\.conv\)/);
  const html = lire('index.html');
  assert.ok(html.indexOf('interface/qcm.js') > html.indexOf('interface/markdown.js') && html.indexOf('interface/qcm.js') < html.indexOf('renderer.js'));
  const consigne = lire('interface/personnalite.js');
  assert.match(consigne, /la bonne réponse TOUJOURS en A/);
  assert.match(consigne, /A\) Rome\r?\nB\) Milan/); // \r : fins de ligne Windows (copie fraîche sur la CI)
  assert.match(consigne, /un bloc \\`\\`\\`choix avec une seule question/);
});
