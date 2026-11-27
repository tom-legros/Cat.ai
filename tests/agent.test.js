// L'agent sans fenêtre : la boucle d'outils et les garde-fous, avec une fausse interface et un faux modèle
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { discuter, executerOutil } = require('../principal/agent');
const { BOUCLE } = require('../principal/outils');

const projetTemporaire = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-agent-'));
  fs.writeFileSync(path.join(d, 'a.js'), 'const a = 1;\n');
  fs.writeFileSync(path.join(d, '.env'), 'CLE=secret\n');
  return d;
};
// Une fausse interface qui note les questions et répond ce qu'on lui dit
function fausseUi({ oui = true, ecrire = true } = {}) {
  const vues = [];
  return {
    vues,
    demander: async (q) => { vues.push(q.titre); return oui; },
    confirmerEcriture: async (e) => { vues.push(`écrire ${path.basename(e.chemin)}`); return ecrire; },
    choisirExecutable: async () => null,
  };
}
const contexte = (projet, ui, plus = {}) => ({ projet: () => projet, ouvrirProjet: () => {}, reglages: () => ({}), ui, fournisseurLocal: true, maxExtrait: 20000, ...plus });
// Un faux modèle : rejoue une liste de réponses, une par étape
function fauxModele(reponses) {
  const recus = [];
  return { recus, envoyer: async (messages, _m, onMorceau) => {
    recus.push(messages);
    const r = reponses[recus.length - 1];
    if (r.texte) onMorceau(r.texte);
    return { content: r.texte || '', toolCalls: r.outils || [] };
  } };
}
const appel = (name, args) => ({ function: { name, arguments: args } });

test('écriture : un contenu identique ne demande pas de confirmation', async () => {
  const d = projetTemporaire();
  const ui = fausseUi();
  const resultat = await executerOutil('ecrire_fichier', { chemin: 'a.js', contenu: 'const a = 1;\n' }, contexte(d, ui));
  assert.match(resultat, /^Aucun changement/);
  assert.deepEqual(ui.vues, []);
});

test('discuter : refuse un appel de modèle à un outil hors de la liste autorisée', async () => {
  const d = projetTemporaire();
  const m = fauxModele([{ outils: [appel('ecrire_fichier', { chemin: 'intrus.js', contenu: 'intrus' })] }, { texte: 'Compris.' }]);
  await discuter({ messages: [], modele: 'test', envoyer: m.envoyer, ctx: contexte(d, fausseUi()), options: { seulement: ['lire_fichier'] } });
  assert.equal(fs.existsSync(path.join(d, 'intrus.js')), false);
  assert.match(m.recus[1].find((message) => message.role === 'tool').content, /pas disponible/);
});

test('discuter : le modèle lit un fichier, reçoit son contenu, puis répond', async () => {
  const d = projetTemporaire();
  const m = fauxModele([{ outils: [appel('lire_fichier', { chemin: 'a.js' })] }, { texte: 'Ton fichier déclare a.' }]);
  const affiche = [];
  const actions = [];
  const { fini, historique } = await discuter({ messages: [{ role: 'user', content: 'lis a.js' }], modele: 'x', envoyer: m.envoyer, ctx: contexte(d, fausseUi()), ev: { morceau: (t) => affiche.push(t), action: (a) => actions.push(a) } });
  assert.equal(fini, true);
  assert.equal(historique.find((x) => x.role === 'tool').content, 'const a = 1;\n');
  assert.equal(affiche.join(''), 'Ton fichier déclare a.');
  assert.deepEqual(actions, ['a lu a.js']);
});

test('executerOutil : écriture seulement après accord, et jamais hors du dossier ouvert', async () => {
  const d = projetTemporaire();
  const refus = fausseUi({ ecrire: false });
  assert.match(await executerOutil('ecrire_fichier', { chemin: 'b.js', contenu: 'x' }, contexte(d, refus)), /refusé/);
  assert.equal(fs.existsSync(path.join(d, 'b.js')), false);
  assert.match(await executerOutil('ecrire_fichier', { chemin: 'b.js', contenu: 'x' }, contexte(d, fausseUi())), /Fichier créé/);
  assert.equal(fs.readFileSync(path.join(d, 'b.js'), 'utf8'), 'x');
  await assert.rejects(executerOutil('ecrire_fichier', { chemin: '../dehors.js', contenu: 'x' }, contexte(d, fausseUi())));
  assert.equal(fs.existsSync(path.join(d, '..', 'dehors.js')), false);
});

test('executerOutil : un fichier sensible n est lu qu avec un accord', async () => {
  const d = projetTemporaire();
  const non = fausseUi({ oui: false });
  assert.doesNotMatch(await executerOutil('lire_fichier', { chemin: '.env' }, contexte(d, non)), /CLE=secret/);
  assert.deepEqual(non.vues, ['Fichier sensible']);
  assert.match(await executerOutil('lire_fichier', { chemin: '.env' }, contexte(d, fausseUi())), /CLE=secret/);
});

test('executerOutil : le mode prof n écrit rien et ne lance rien, sans même demander', async () => {
  const d = projetTemporaire();
  const ui = fausseUi();
  const prof = contexte(d, ui, { prof: true });
  assert.match(await executerOutil('ecrire_fichier', { chemin: 'b.js', contenu: 'x' }, prof), /Mode prof/);
  assert.match(await executerOutil('lancer_tests', {}, prof), /ne permet pas/);
  assert.deepEqual(ui.vues, []);
  assert.equal(fs.existsSync(path.join(d, 'b.js')), false);
});

test('discuter : en mode prof, les blocs de code ne sont ni affichés ni gardés', async () => {
  const m = fauxModele([{ texte: 'Regarde :\n```js\nconst x = 1;\n```\nÀ toi !' }]);
  let affiche = '';
  const { historique } = await discuter({ messages: [{ role: 'user', content: 'donne le code' }], modele: 'x', envoyer: m.envoyer, ctx: contexte(null, fausseUi(), { prof: true }), ev: { morceau: (t) => { affiche += t; } } });
  assert.doesNotMatch(affiche, /const x/);
  assert.doesNotMatch(historique.at(-1).content, /const x/);
});

test('sansPensee : le raisonnement qui a fui avant </think> est retiré, le reste ne bouge pas', () => {
  const { sansPensee } = require('../principal/agent');
  assert.equal(sansPensee('Okay, the user wants a plan.\n</think>\n\nVoici le plan.'), 'Voici le plan.');
  assert.equal(sansPensee('<think>hmm</think>Bonjour'), 'Bonjour');
  assert.equal(sansPensee('<think>jamais refermé'), '');
  assert.equal(sansPensee('Une réponse normale.'), 'Une réponse normale.');
});

test('discuter : un raisonnement affiché puis refermé par </think> est effacé de l écran et de l historique', async () => {
  const { discuter } = require('../principal/agent');
  let ecran = '';
  const envoyer = async (_m, _modele, onMorceau) => { const t = 'Let me think about it.\n</think>\n\nBonjour.'; onMorceau(t); return { content: t, toolCalls: [] }; };
  const r = await discuter({ messages: [{ role: 'user', content: 'salut' }], modele: 'm', envoyer, ctx: { prof: false }, ev: { morceau: (t) => { ecran += t; }, annuler: (n) => { ecran = ecran.slice(0, -n); } } });
  assert.equal(ecran, 'Bonjour.');
  assert.equal(r.historique.at(-1).content, 'Bonjour.');
});

test('sansCloture : un fichier emballé dans un bloc de code est écrit sans l emballage, un vrai bloc reste', () => {
  const { sansCloture } = require('../principal/agent');
  assert.equal(sansCloture('```markdown\n# Plan\n\n1. Faire\n```', 'plan.md'), '# Plan\n\n1. Faire\n');
  assert.equal(sansCloture('```js\nconst a = 1;\n```\n', 'a.js'), 'const a = 1;\n');
  // Un plan en Markdown qui contient lui-même un bloc de code, emballé dans ```markdown
  assert.equal(sansCloture('```markdown\n# Plan\n```bash\nnpm test\n```\nfin\n```', 'plan.md'), '# Plan\n```bash\nnpm test\n```\nfin\n');
  // Un README qui commence et finit par un vrai bloc de code : on n'y touche pas
  const readme = '```bash\nnpm i\n```\nPuis :\n```bash\nnpm start\n```';
  assert.equal(sansCloture(readme, 'README.md'), readme);
  assert.equal(sansCloture('const a = 1;\n', 'a.js'), 'const a = 1;\n');
});

test('sansPensee et sansCloture : un contenu légitime reste entier (relecture croisée)', () => {
  const { sansPensee, sansCloture } = require('../principal/agent');
  assert.equal(sansPensee('La balise fermante est </think>. Voici son usage.'), 'La balise fermante est </think>. Voici son usage.');
  assert.equal(sansPensee('<think>a</think>La fin est </think> aussi.'), 'La fin est </think> aussi.');
  const readme = '```js\nconsole.log(1);\n```';
  assert.equal(sansCloture(readme, 'README.md'), readme);
  assert.equal(sansCloture('```\nun bloc\n```', 'notes.md'), '```\nun bloc\n```');
});

test('discuter : arrêt sur boucle après 3 appels d outil identiques bloqués avec arreterSurBoucle', async () => {
  const d = projetTemporaire();
  const m = fauxModele([
    { outils: [appel('lire_fichier', { chemin: 'a.js' })] },
    { outils: [appel('lire_fichier', { chemin: 'a.js' })] },
    { outils: [appel('lire_fichier', { chemin: 'a.js' })] },
    { outils: [appel('lire_fichier', { chemin: 'a.js' })] },
    { outils: [appel('lire_fichier', { chemin: 'a.js' })] }
  ]);
  const resultat = await discuter({
    messages: [{ role: 'user', content: 'lis encore' }],
    modele: 'test',
    envoyer: m.envoyer,
    ctx: contexte(d, fausseUi()),
    options: { arreterSurBoucle: true }
  });
  assert.equal(resultat.fini, false);
  assert.equal(resultat.raison, 'boucle');
  assert.equal(resultat.historique.at(-1).content, BOUCLE);
});

test('discuter : fonctionnement normal sans interruption intempestive', async () => {
  const d = projetTemporaire();
  const m = fauxModele([
    { outils: [appel('lire_fichier', { chemin: 'a.js' })] },
    { outils: [appel('lire_fichier', { chemin: '.env' })] },
    { texte: 'Terminé.' }
  ]);
  const resultat = await discuter({
    messages: [{ role: 'user', content: 'lis' }],
    modele: 'test',
    envoyer: m.envoyer,
    ctx: contexte(d, fausseUi()),
    options: { arreterSurBoucle: true }
  });
  assert.equal(resultat.fini, true);
  assert.equal(resultat.historique.at(-1).content, 'Terminé.');
});

// Vu par Tom (2026-11-27) : après des outils, le modèle finissait sans rien écrire (« Terminé », réponse vide).
test('discuter : une réponse finale vide après des outils est redemandée une fois ; sans outil, on ne relance pas', async () => {
  const d = projetTemporaire();
  const m = fauxModele([{ outils: [appel('lire_fichier', { chemin: 'a.js' })] }, { texte: '' }, { texte: 'Ton fichier déclare a.' }]);
  const affiche = [];
  const { fini, historique } = await discuter({ messages: [{ role: 'user', content: 'lis a.js' }], modele: 'x', envoyer: m.envoyer, ctx: contexte(d, fausseUi()), ev: { morceau: (t) => affiche.push(t) } });
  assert.equal(fini, true);
  assert.equal(m.recus.length, 3, 'une relance');
  assert.ok(m.recus[2].some((x) => x.role === 'user' && /Réponds maintenant/.test(x.content)), 'la relance demande de répondre');
  assert.ok(!historique.some((x) => x.role === 'assistant' && x.content === '' && !x.tool_calls), 'la réponse vide ne reste pas dans l historique');
  assert.equal(affiche.join('').trim(), 'Ton fichier déclare a.');
  assert.equal(historique.at(-1).content, 'Ton fichier déclare a.');
  // Toujours vide après la relance : on s'arrête (pas de boucle)
  const m2 = fauxModele([{ outils: [appel('lire_fichier', { chemin: 'a.js' })] }, { texte: '' }, { texte: '' }]);
  await discuter({ messages: [{ role: 'user', content: 'lis a.js' }], modele: 'x', envoyer: m2.envoyer, ctx: contexte(d, fausseUi()) });
  assert.equal(m2.recus.length, 3);
  // Vide sans aucun outil (rare, mais possible) : pas de relance
  const m3 = fauxModele([{ texte: '' }, { texte: 'jamais demandé' }]);
  await discuter({ messages: [{ role: 'user', content: 'salut' }], modele: 'x', envoyer: m3.envoyer, ctx: contexte(d, fausseUi()) });
  assert.equal(m3.recus.length, 1);
});
