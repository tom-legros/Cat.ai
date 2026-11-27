// Les QCM dans catai : posés question par question, juste/raté avec la bonne réponse, score, bilan ; Ctrl+C ou une
// réponse vide arrêtent le QCM ; un bloc pas fermé est quand même posé
const test = require('node:test');
const assert = require('node:assert/strict');
const { poserQcm, blocQcm } = require('../cli/catai');
const { creerRenduMarkdown } = require('../cli/markdown');

// Ce que catai écrit pendant le QCM (sans couleurs : la sortie des tests n'est pas un terminal)
async function avecSortie(travail) {
  const ecrire = process.stdout.write;
  let texte = '';
  process.stdout.write = (t) => { texte += t; return true; };
  try { return { resultat: await travail(), texte }; } finally { process.stdout.write = ecrire; }
}
// Des réponses tapées à l'avance ; les questions posées sont gardées
const reponses = (...liste) => { const vues = []; const lire = async (q) => { vues.push(q); return liste.length ? liste.shift() : null; }; lire.vues = vues; return lire; };

const REPONSE = 'Allez :\n```qcm\nQ: Quel mot-clé lit des données ?\nA) SELECT\nB) INSERT\nC) DELETE\n> SELECT lit les données.\n\nQ: Comment trier ?\nA) ORDER BY\nB) GROUP BY\n```\nBonne chance';

test('blocQcm : le bloc qcm ou choix, même si le modèle ne l a pas fermé', () => {
  assert.deepEqual(blocQcm('x\n```qcm\nQ: a ?\nA) 1\nB) 2\n```\nfin'), { choix: false, contenu: 'Q: a ?\nA) 1\nB) 2\n' });
  assert.equal(blocQcm('```choix\nQ: a ?\nA) 1\nB) 2').choix, true);
  assert.equal(blocQcm('pas de bloc'), null);
});

test('un quiz : chaque question, juste ou raté avec la bonne réponse écrite, le score, puis le bilan si on accepte', async () => {
  // On trouve la lettre de la bonne réponse dans ce qui est affiché (les choix sont mélangés)
  let affiche = '';
  const lettreDe = (texte) => /([A-D]) {2}SELECT\b/.exec(affiche)?.[1];
  const ecrire = process.stdout.write;
  const vues = [];
  const lire = async (q) => {
    vues.push(q);
    if (vues.length === 1) return lettreDe(affiche); // juste
    if (vues.length === 2) return /([A-D]) {2}GROUP BY/.exec(affiche)[1]; // raté
    return 'o';
  };
  let bilan;
  process.stdout.write = (t) => { affiche += t; return true; };
  try { bilan = await poserQcm(REPONSE, lire); } finally { process.stdout.write = ecrire; }
  assert.match(affiche, /Question 1\/2/);
  assert.match(affiche, /✓ Bonne réponse\s!/);
  assert.match(affiche, /SELECT lit les données\./);
  assert.match(affiche, /✗ Raté\s: c'était [AB], ORDER BY\./);
  assert.match(affiche, /Score : 1\/2/);
  assert.match(bilan, /^J'ai fait le QCM : 1\/2\./);
  assert.match(bilan, /la bonne réponse était « ORDER BY »/);
});

test('une réponse vide ou Ctrl+C (null) arrête le QCM ; une lettre hors des choix est redemandée', async () => {
  const vide = await avecSortie(() => poserQcm(REPONSE, reponses('Z', '')));
  assert.equal(vide.resultat, null);
  assert.match(vide.texte, /Tape une des lettres proposées/);
  assert.match(vide.texte, /\(QCM arrêté\)/);
  const ctrlC = await avecSortie(() => poserQcm(REPONSE, reponses(null)));
  assert.equal(ctrlC.resultat, null);
  assert.match(ctrlC.texte, /\(QCM arrêté\)/);
});

test('un bloc choix : la lettre tapée envoie le texte du choix ; un bloc illisible est montré tel quel', async () => {
  const r = await avecSortie(() => poserQcm('```choix\nQ: Quelle fiche ?\nA) Courte\nB) Détaillée\n```', reponses('b')));
  assert.equal(r.resultat, 'Détaillée');
  const illisible = await avecSortie(() => poserQcm('```qcm\nrien de lisible ici\n```', reponses()));
  assert.equal(illisible.resultat, null);
  assert.match(illisible.texte, /rien de lisible ici/);
});

test('l affichage cache le bloc et annonce les questions, même si le modèle ne l a pas fermé', () => {
  let sortie = '';
  const md = creerRenduMarkdown((t) => { sortie += t; }, { couleurs: false });
  md.texte('Allez :\n```qcm\nQ: a ?\nA) 1\nB) 2');
  md.fin();
  assert.doesNotMatch(sortie, /Q: a/);
  assert.match(sortie, /les questions arrivent juste en dessous/);
});
