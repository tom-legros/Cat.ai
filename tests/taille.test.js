// Taille des messages : rester sous la limite d'un fournisseur sans casser la discussion
const test = require('node:test');
const assert = require('node:assert/strict');
const { raccourcir, compacter, limitesTaille, taille, estimerTokens, LIMITES_OLLAMA, MAX_LISTE, listeCourte } = require('../principal/taille');

test('listeCourte : un petit dossier reste entier', () => {
  assert.deepEqual(listeCourte(['a.js', 'b/', 'b/c.js']), { fichiers: ['a.js', 'b/', 'b/c.js'], coupee: false });
});

test('listeCourte : un gros dossier est coupé sous la limite, dans l ordre', () => {
  const gros = Array.from({ length: 300 }, (_, i) => `Documents/un dossier aux noms longs/fichier-${i}.txt`);
  const { fichiers, coupee } = listeCourte(gros);
  assert.ok(coupee);
  assert.ok(fichiers.join('\n').length <= MAX_LISTE);
  assert.deepEqual(fichiers, gros.slice(0, fichiers.length));
});

test('listeCourte : la liste coupée laisse de la place aux consignes dans les 8 192 tokens d Ollama', () => {
  assert.ok(estimerTokens('x'.repeat(MAX_LISTE)) <= 1000);
});

test('raccourcir : texte court intact, texte long coupé avec une note pour le modèle', () => {
  assert.equal(raccourcir('court', 10), 'court');
  const long = raccourcir('x'.repeat(50), 10);
  assert.ok(long.startsWith('x'.repeat(10)) && long.includes('coupé') && long.includes('lire_fichier'));
});

test('raccourcir : la note donne la ligne où reprendre la lecture du fichier', () => {
  const fichier = Array.from({ length: 100 }, (_, i) => `ligne ${i + 1}`).join('\n');
  const coupe = raccourcir(fichier, 30); // « ligne 1 » à « ligne 4 » entières, puis le début de « ligne 5 »
  assert.match(coupe, /la suite commence à la ligne 4 : relis-le avec lire_fichier et ligne = 4/);
});

test('limites d Ollama : assez petites pour tenir dans 8 192 tokens avec la réponse', () => {
  assert.ok(estimerTokens('x'.repeat(LIMITES_OLLAMA.total)) <= 8192 - 2500);
  assert.ok(LIMITES_OLLAMA.resultatOutil < LIMITES_OLLAMA.total);
});

test('compacter avec les limites d Ollama : un gros fichier lu ne fait jamais disparaître la question', () => {
  const liste = [
    { role: 'system', content: 'consignes' },
    { role: 'user', content: 'pourquoi ça plante ?' },
    { role: 'assistant', content: '', tool_calls: [{ id: '1', function: { name: 'lire_fichier', arguments: { chemin: 'gros.js' } } }] },
    { role: 'tool', content: raccourcir('x'.repeat(100000), LIMITES_OLLAMA.resultatOutil), tool_call_id: '1' },
  ];
  const resultat = compacter(liste, LIMITES_OLLAMA.total);
  assert.ok(total(resultat) <= LIMITES_OLLAMA.total);
  assert.equal(resultat.find((m) => m.role === 'user').content, 'pourquoi ça plante ?');
});

test('limitesTaille : seulement pour Groq', () => {
  assert.ok(limitesTaille({ baseUrl: 'https://api.groq.com/openai/v1' }));
  assert.equal(limitesTaille({ baseUrl: 'https://openrouter.ai/api/v1' }), null);
  assert.equal(limitesTaille({ type: 'ollama' }), null);
});

const total = (liste) => liste.reduce((n, m) => n + taille(m), 0);

test('compacter : une discussion qui tient déjà ne change pas', () => {
  const liste = [{ role: 'system', content: 'consignes' }, { role: 'user', content: 'salut' }];
  assert.deepEqual(compacter(liste, 1000), liste);
});

test('compacter : à taille égale, raccourcit d abord le résultat d outil le plus ancien', () => {
  const liste = [
    { role: 'system', content: 'consignes' },
    { role: 'user', content: 'lis a.js et b.js' },
    { role: 'assistant', content: '', tool_calls: [{ id: '1', function: { name: 'lire_fichier', arguments: { chemin: 'a.js' } } }] },
    { role: 'tool', content: 'a'.repeat(3000), tool_call_id: '1' },
    { role: 'tool', content: 'b'.repeat(3000), tool_call_id: '2' },
  ];
  const resultat = compacter(liste, 5000);
  assert.ok(total(resultat) <= 5000);
  assert.ok(resultat[3].content.length < 3000, 'le plus ancien est raccourci');
  assert.equal(resultat.length, liste.length, 'aucun message retiré');
});

test('compacter : retire les vieux échanges mais garde les consignes et le dernier message de l utilisateur', () => {
  const vieux = Array.from({ length: 10 }, (_, i) => [
    { role: 'user', content: `vieille question ${i} ` + 'q'.repeat(500) },
    { role: 'assistant', content: `vieille réponse ${i} ` + 'r'.repeat(500) },
  ]).flat();
  const liste = [{ role: 'system', content: 'consignes' }, ...vieux, { role: 'user', content: 'ma vraie question' }];
  const resultat = compacter(liste, 2000);
  assert.ok(total(resultat) <= 2000);
  assert.equal(resultat[0].content, 'consignes');
  assert.equal(resultat.at(-1).content, 'ma vraie question');
});

test('compacter : ne sépare jamais un appel d outil de son résultat', () => {
  const liste = [
    { role: 'system', content: 'consignes' },
    { role: 'user', content: 'u'.repeat(800) },
    { role: 'assistant', content: '', tool_calls: [{ id: '1', function: { name: 'lire_fichier', arguments: {} } }] },
    { role: 'tool', content: 't'.repeat(700), tool_call_id: '1' },
    { role: 'user', content: 'question' },
  ];
  const resultat = compacter(liste, 400);
  // Si l'appel a été retiré, son résultat aussi
  const appel = resultat.findIndex((m) => m.tool_calls);
  const outil = resultat.findIndex((m) => m.role === 'tool');
  assert.ok((appel === -1) === (outil === -1));
  if (appel !== -1) assert.equal(outil, appel + 1);
  assert.equal(resultat.at(-1).content, 'question');
});

test('compacter : ne modifie pas la liste d origine', () => {
  const liste = [{ role: 'system', content: 'x'.repeat(5000) }, { role: 'user', content: 'q' }];
  compacter(liste, 1000);
  assert.equal(liste[0].content.length, 5000);
});

test('compacter : coupe d abord les plus gros résultats, le résultat de recherche reste entier (cas vu avec Groq)', () => {
  const { LIMITES_TAILLE } = require('../principal/taille');
  const groq = LIMITES_TAILLE['api.groq.com'];
  const appel = (id, name) => ({ role: 'assistant', content: '', tool_calls: [{ id, function: { name, arguments: {} } }] });
  const recherche = Array.from({ length: 19 }, (_, i) => `principal/outils.js:${100 + i}: remplacerTexte(contenu, ancien, nouveau)`).join('\n').padEnd(2452, ' ');
  const liste = [
    { role: 'system', content: 'c'.repeat(6000) }, // consignes + mémoire + liste des fichiers
    { role: 'user', content: 'Où est utilisée la fonction remplacerTexte ?' },
    appel('1', 'chercher'),
    { role: 'tool', content: recherche, tool_call_id: '1' },
    appel('2', 'lire_fichier'),
    { role: 'tool', content: raccourcir('m'.repeat(20000), groq.resultatOutil), tool_call_id: '2' },
  ];
  const resultat = compacter(liste, groq.total);
  assert.ok(total(resultat) <= groq.total);
  assert.equal(resultat[3].content, recherche, 'la recherche est intacte');
  assert.ok(resultat[5].content.length < 4000, 'la lecture de main.js est coupée');
});
