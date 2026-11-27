// Historique des discussions : recherche sans accents, suppression confirmée, ordre et sauvegarde fiable.
// Les comportements câblés dans les sources sont vérifiés par lecture, comme les autres tests de câblage ;
// les fonctions pures sont exécutées dans un vm.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Les assertions sur le source doivent être indépendantes du checkout CRLF de Windows.
const lire = (nom) => fs.readFileSync(path.join(__dirname, '..', nom), 'utf8').replace(/\r\n/g, '\n');
const html = lire('index.html');
const renderer = lire('renderer.js');
const style = lire('style.css');

test('historique : champ de recherche, statut et alerte de sauvegarde', () => {
  assert.match(html, /id="conv-recherche"[^>]*type="search"/);
  assert.match(html, /aria-controls="conv-list"/);
  assert.match(html, /id="conv-statut"[^>]*role="status"/);
  assert.match(html, /id="historique-alerte"[^>]*role="alert"[^>]*hidden/);
  assert.match(html, /data-icone="loupe"/);
  assert.match(renderer, /function conversationsAffichees/);
  assert.match(renderer, /mots\.every\(\(mot\) => texte\.includes\(mot\)\)/);
  assert.match(renderer, /#conv-recherche[^]*?addEventListener\("input", renderList\)/);
  assert.match(renderer, /e\.key === "Escape" && e\.target\.value/);
  assert.match(renderer, /function demanderSuppressionDiscussion/);
  assert.match(renderer, /function supprimerDiscussion/);
  assert.match(renderer, /function sauvegarderHistorique/);
  assert.match(style, /\.discussions__recherche/);
  assert.match(style, /\.conv__confirmation/);
});

test('recherche : sans accents, plusieurs mots, titre et messages', () => {
  const bloc = renderer.slice(renderer.indexOf('const sansAccents ='), renderer.indexOf('function renderList()'));
  const champ = { value: 'python' };
  const contexte = {
    convs: [
      { id: 'a', title: 'Boucles Python', messages: [{ role: 'user', content: 'Comment écrire une boucle ?' }] },
      { id: 'b', title: 'Cuisine', messages: [{ role: 'user', content: 'Une recette de crêpes au sucre' }] },
      { id: 'c', title: 'Déploiement', messages: [{ role: 'assistant', content: 'Utilise pip et python3' }] }
    ],
    indexRecherche: null,
    $: () => champ
  };
  vm.createContext(contexte);
  vm.runInContext(`${bloc}\nthis.f = { sansAccents, conversationsAffichees, texteIndexConversation };`, contexte);
  assert.equal(contexte.f.conversationsAffichees().map((c) => c.id).join(','), 'a,c');
  champ.value = 'crêpes';
  assert.equal(contexte.f.conversationsAffichees().map((c) => c.id).join(','), 'b');
  champ.value = 'python boucle';
  assert.equal(contexte.f.conversationsAffichees().map((c) => c.id).join(','), 'a');
  champ.value = '   ';
  assert.equal(contexte.f.conversationsAffichees().length, 3);
  assert.equal(contexte.f.sansAccents('RÉFLEXION'), 'reflexion');
});

test('supprimer une discussion passe par une confirmation, jamais un clic seul', () => {
  assert.match(renderer, /function demanderSuppressionDiscussion/);
  assert.match(renderer, /textContent = "Garder"/);
  assert.match(renderer, /textContent = "Supprimer"/);
  assert.match(renderer, /garder\.focus\(\); \/\/ le choix sûr reçoit le focus/);
  assert.match(renderer, /if \(reponseVivante\(c\)\) \{ annuler\(\); return; \}/);
  assert.match(renderer, /function supprimerDiscussion/);
  assert.match(renderer, /boutons\[Math\.min\(place, boutons\.length - 1\)\] \|\| \$\("#new-chat"\)/);
  assert.match(renderer, /if \(e\.key !== "Escape"\) return;/);
  assert.match(style, /\.conv__confirmation/);
});

test('ordre : une discussion qui reçoit un message remonte en tête', () => {
  assert.match(renderer, /if \(destination\) \{\n            const place = Array\.isArray\(convs\) \? convs\.indexOf\(conv\) : -1;/);
  assert.match(renderer, /if \(place > 0\) \{ convs\.splice\(place, 1\); convs\.unshift\(conv\); \}/);
});

test('sauvegarde : échec signalé, images retirées, reprise réussie', async () => {
  const bloc = renderer.slice(renderer.indexOf('function sauvegarderHistorique('), renderer.indexOf('const save = () =>'));
  const alerte = { hidden: true, textContent: '' };
  const donneesRecues = [];
  const contexte = {
    convs: [{ id: 'x', messages: [{ role: 'user', content: 'salut', images: ['abc'] }] }],
    indexRecherche: new Map(),
    sauvegardeEnEchec: false,
    $: (sel) => (sel === '#historique-alerte' ? alerte : null),
    window: { api: { saveConvs: async () => { throw new Error('disque plein'); } } }
  };
  vm.createContext(contexte);
  vm.runInContext(`${bloc}\nthis.sauvegarder = sauvegarderHistorique;`, contexte);
  await contexte.sauvegarder();
  assert.equal(alerte.hidden, false);
  assert.match(alerte.textContent, /Impossible d'enregistrer l'historique/);
  contexte.window.api.saveConvs = async (d) => { donneesRecues.push(d); return { ok: true }; };
  await contexte.sauvegarder();
  assert.equal(alerte.hidden, true);
  assert.equal(donneesRecues.length, 1);
  assert.equal(donneesRecues[0][0].messages[0].images, undefined);
});
