// Accueil (phrase selon l'heure), logos des fournisseurs, statistiques lisibles, et le reste du tour de l'app
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const source = lire('renderer.js');
const entre = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));

test('accueil : une phrase selon l’heure, avec le prénom, et jamais deux fois différente dans le même moment', () => {
  const c = vm.createContext({ Math });
  vm.runInContext(entre('const SALUTATIONS', 'function renderSalutation('), c);
  assert.match(c.salutation(7, 'Alex', () => 0), /^C'est l'heure du café, Alex$/);
  assert.match(c.salutation(7, '', () => 0), /^C'est l'heure du café$/);
  assert.match(c.salutation(2, 'Alex', () => 0), /^Encore debout, Alex \?$/); // 2 h du matin : la nuit
  assert.match(c.salutation(23, '', () => 0.99), /^Une idée de minuit \?$/);
  for (let h = 0; h < 24; h++) assert.ok(c.salutation(h, 'Alex').length > 5, String(h));
  // Rangée une fois par moment : le rafraîchissement toutes les 10 s ne la fait pas changer
  assert.match(source, /if \(salutationRetenue\?\.cle !== cle\) salutationRetenue = \{ cle, texte: salutation\(heure, prenom\) \};/);
  // Le sous-titre n'apparaît que pour un fournisseur en ligne (confidentialité)
  assert.match(source, /texte\.hidden = fournisseurLocal\(f\);/);
});

test('logos officiels (Simple Icons, CC0) pour Ollama, Gemini et OpenRouter ; un g pour Groq', () => {
  const { LOGOS, icone } = require('../interface/icones');
  for (const nom of ['logoOllama', 'logoGemini', 'logoOpenRouter']) {
    assert.match(LOGOS[nom], /^M[\d.\s,a-zA-Z-]+$/, nom); // un seul tracé, sans script ni balise
    assert.match(icone(nom), /class="icone icone-px icone-logo"/);
  }
  assert.match(icone('logoGroq'), /<circle[^>]*\/><text[^>]*>g<\/text>/);
  const modeles = lire('interface/modeles.js');
  for (const id of ['Ollama', 'Gemini', 'Groq', 'OpenRouter']) assert.match(modeles, new RegExp(`icone: "logo${id}"`));
});

test('statistiques : la synthèse additionne les appels, sans NaN ni Infinity quand Ollama ne dit rien', () => {
  const c = vm.createContext({});
  vm.runInContext(entre('function syntheseOllama(', '// Les statistiques sous une réponse'), c);
  const s = c.syntheseOllama([
    { termine: true, eval_count: 70, eval_duration: 2e9, prompt_eval_duration: 1e9, prompt_eval_count: 900, load_duration: 3e9, premierFragmentMs: 1600 },
    { termine: true, eval_count: 30, eval_duration: 1e9, prompt_eval_duration: 5e8 },
  ]);
  assert.equal(Math.round(s.debit), 33); // 100 tokens en 3 s
  assert.equal(s.premierMot, 1.6);
  assert.equal(s.lecture, 1.5);
  assert.equal(s.tokens, 100);
  assert.equal(s.chargement, 3);
  assert.equal(s.appels, 2);
  const vide = c.syntheseOllama([{ termine: false }]);
  assert.equal(vide.debit, null);
  assert.equal(vide.premierMot, null);
  assert.equal(vide.incomplet, true);
  assert.doesNotMatch(JSON.stringify(vide), /NaN|Infinity/);
});

test('historique : un crayon pour renommer sur chaque ligne ; menu des modèles sans nombres ni défilement de côté', () => {
  assert.match(source, /renommer\.className = "conv__renommer";/); // pas « suppr » : le code cherche .suppr pour supprimer
  assert.match(source, /li\.append\(ouvrir, renommer, suppr\);/);
  assert.doesNotMatch(source, /entete\.dataset\.nombre/);
  assert.match(lire('style.css'), /\.menu-modeles__liste \{ overflow-x: hidden; \}/);
});

test('menu des modèles : les récents (3 au plus, sans doublon), retenus aussi à l’envoi', () => {
  const stockage = new Map();
  const c = vm.createContext({ localStorage: { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => stockage.set(k, v) }, JSON });
  vm.runInContext(entre('const MAX_RECENTS', '// Sélecteur unique, sobre'), c);
  c.retenirRecent('ollama', 'qwen3.5:9b');
  c.retenirRecent('gemini', 'gemini-flash');
  c.retenirRecent('ollama', 'qwen3.5:9b'); // revient en tête, sans doublon
  c.retenirRecent('ollama', 'qwen3.5:4b');
  c.retenirRecent('groq', 'llama');
  assert.deepEqual(JSON.parse(JSON.stringify(c.lireRecents())), [{ f: 'groq', m: 'llama' }, { f: 'ollama', m: 'qwen3.5:4b' }, { f: 'ollama', m: 'qwen3.5:9b' }]);
  assert.match(source, /if \(configuration\.choix\?\.model\) retenirRecent\(configuration\.choix\.fournisseurId, configuration\.choix\.model\);/);
});

test('accueil centré, recherche de l’historique repliable, logo = le vrai petit chat', () => {
  assert.match(source, /\$\("\.principal"\)\.classList\.toggle\("is-accueil", !welcomeEl\.hidden\);/);
  const css = lire('style.css');
  assert.match(css, /\.principal\.is-accueil #messages \{ flex: 0 0 auto; margin-top: auto;/);
  assert.match(css, /\.principal\.is-accueil #composer \{ margin-bottom: auto;/);
  const html = lire('index.html');
  assert.match(html, /id="conv-recherche-ouvrir"[^>]*aria-expanded="false"[^>]*aria-controls="conv-recherche"/);
  assert.match(html, /<div class="discussions__recherche" hidden>/);
  assert.match(source, /localStorage\.setItem\("rechercheHistorique", oui \? "1" : "0"\)/);
  assert.match(source, /toile\.className = "logo__chat";[\s\S]*?new ChatNoir\(toile\);/);
});
