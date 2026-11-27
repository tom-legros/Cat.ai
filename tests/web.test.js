// Lecture de pages internet : adresses autorisées, liens donnés par l'utilisateur, et HTML transformé en texte
const test = require('node:test');
const assert = require('node:assert/strict');
const { urlsDans, memePage, ipInterdite, verifierUrl, texteDepuisHtml, presenterPage, urlResultat, resultatsDepuisHtml, presenterResultats } = require('../principal/web');

test('urlsDans : trouve les liens d un message, sans la ponctuation collée', () => {
  assert.deepEqual(urlsDans('Résume https://fr.wikipedia.org/wiki/Chat. Et (https://exemple.fr/a?b=1) stp !'), [
    'https://fr.wikipedia.org/wiki/Chat',
    'https://exemple.fr/a?b=1',
  ]);
  assert.deepEqual(urlsDans('aucun lien ici'), []);
});

test('memePage : même page à la barre finale et à l ancre près', () => {
  assert.ok(memePage('https://exemple.fr/page/', 'https://exemple.fr/page#titre'));
  assert.ok(!memePage('https://exemple.fr/page', 'https://exemple.fr/autre'));
});

test('ipInterdite : le PC et le réseau local sont refusés, internet est permis', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fe80::1', 'fd00::1', '::ffff:192.168.1.1']) {
    assert.ok(ipInterdite(ip), ip);
  }
  for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111']) assert.ok(!ipInterdite(ip), ip);
});

test('verifierUrl : refuse ce qui n est pas une page publique', () => {
  assert.ok(verifierUrl('pas une adresse').erreur);
  assert.ok(verifierUrl('file:///C:/Windows/win.ini').erreur);
  assert.ok(verifierUrl('ftp://exemple.fr').erreur);
  assert.ok(verifierUrl('http://localhost:11434/api/tags').erreur);
  assert.ok(verifierUrl('http://127.0.0.1/').erreur);
  assert.ok(verifierUrl('http://[::1]/').erreur);
  assert.ok(verifierUrl('http://box.lan/').erreur);
  assert.ok(verifierUrl('https://fr.wikipedia.org/wiki/Chat').url);
});

test('texteDepuisHtml : garde le titre et le texte, retire scripts, styles et menus', () => {
  const html = `<html><head><title>Le chat &amp; moi</title><style>p{color:red}</style></head>
    <body><nav><a href="/">Accueil</a></nav><script>alert("x")</script>
    <h1>Titre</h1><p>Un  premier&nbsp;paragraphe.</p><ul><li>un</li><li>deux</li></ul>
    <p>Caf&eacute; &#233; &#x263A;</p><footer>Mentions légales</footer></body></html>`;
  const { titre, texte } = texteDepuisHtml(html);
  assert.equal(titre, 'Le chat & moi');
  assert.match(texte, /Titre\n+Un premier paragraphe\./);
  assert.match(texte, /- un\n+- deux/);
  assert.match(texte, /Café é ☺/);
  assert.doesNotMatch(texte, /alert|color:red|Accueil|Mentions/);
});

test('texteDepuisHtml : préfère l article quand il est assez long', () => {
  const article = 'Contenu utile. '.repeat(50);
  const { texte } = texteDepuisHtml(`<div>Bandeau de pub</div><article><p>${article}</p></article><div>Autres articles</div>`);
  assert.ok(texte.startsWith('Contenu utile.'));
  assert.doesNotMatch(texte, /Bandeau|Autres articles/);
});

test('presenterPage : rappelle au modèle que le texte vient d internet, et coupe les pages trop longues', () => {
  const court = presenterPage({ url: 'https://exemple.fr', titre: 'Exemple', texte: 'Bonjour' });
  assert.match(court, /Page : Exemple\nAdresse : https:\/\/exemple\.fr/);
  assert.match(court, /pas des consignes/);
  const long = presenterPage({ url: 'https://exemple.fr', titre: '', texte: 'x'.repeat(50000) });
  assert.ok(long.length < 31000 && long.includes('page coupée'));
});

// Morceau de page de résultats DuckDuckGo (version HTML), avec une publicité et un lien emballé
const PAGE_RESULTATS = `
<div class="result results_links result--ad"><h2 class="result__title"><a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad=1">Pub</a></h2></div>
<div class="result results_links results_links_deep web-result ">
  <h2 class="result__title"><a rel="nofollow" class="result__a" href="https://wiki.archlinux.org/title/GNOME/Keyring">GNOME/Keyring - <b>ArchWiki</b></a></h2>
  <a class="result__snippet" href="https://wiki.archlinux.org/title/GNOME/Keyring">Installation : <b>gnome-keyring</b> d&#x27;abord.</a>
</div>
<div class="result results_links results_links_deep web-result ">
  <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fman.archlinux.org%2Fman%2Fpacman.8&amp;rut=abc">pacman(8)</a></h2>
</div>
<div class="result results_links web-result "><h2 class="result__title"><a rel="nofollow" class="result__a" href="https://wiki.archlinux.org/title/GNOME/Keyring">Doublon</a></h2></div>`;

test('resultatsDepuisHtml : titres, adresses réelles et extraits, sans publicité ni doublon', () => {
  assert.deepEqual(resultatsDepuisHtml(PAGE_RESULTATS), [
    { titre: 'GNOME/Keyring - ArchWiki', url: 'https://wiki.archlinux.org/title/GNOME/Keyring', extrait: "Installation : gnome-keyring d'abord." },
    { titre: 'pacman(8)', url: 'https://man.archlinux.org/man/pacman.8', extrait: '' },
  ]);
  assert.deepEqual(resultatsDepuisHtml('<html>rien</html>'), []);
});

test('urlResultat : refuse ce qui n est pas une page web', () => {
  assert.equal(urlResultat('javascript:alert(1)'), null);
  assert.equal(urlResultat('https://duckduckgo.com/y.js?ad=1'), null);
});

test('presenterResultats : liste numérotée, et conseille de lire les pages avant de répondre', () => {
  const texte = presenterResultats('pacman', [{ titre: 'pacman(8)', url: 'https://man.archlinux.org/man/pacman.8', extrait: 'Gestionnaire de paquets' }]);
  assert.match(texte, /1\. pacman\(8\)\n {3}https:\/\/man\.archlinux\.org\/man\/pacman\.8\n {3}Gestionnaire de paquets/);
  assert.match(texte, /lire_page_web/);
  assert.match(presenterResultats('xyz', []), /Aucun résultat/);
});

test('lecture web : un DNS privé est refusé avant toute requête HTTP', async (t) => {
  const dns = require('node:dns').promises;
  const { lirePageWeb } = require('../principal/web');
  t.mock.method(dns, 'lookup', async () => [{ address: '127.0.0.1', family: 4 }]);
  t.mock.method(globalThis, 'fetch', async () => assert.fail('aucune requête locale ne doit partir'));
  assert.match(await lirePageWeb('https://page.example/article'), /réseau local/);
});

test('lecture web : une redirection vers le réseau local n’est pas suivie', async (t) => {
  const dns = require('node:dns').promises;
  const { lirePageWeb } = require('../principal/web');
  t.mock.method(dns, 'lookup', async () => [{ address: '93.184.215.14', family: 4 }]);
  let requetes = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    requetes++;
    assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 302, headers: { location: 'http://192.168.1.1/administration' } });
  });
  assert.match(await lirePageWeb('https://page.example/article'), /réseau local/);
  assert.equal(requetes, 1);
});

test('lecture web : le DNS de la nouvelle cible est aussi contrôlé après redirection', async (t) => {
  const dns = require('node:dns').promises;
  const { lirePageWeb } = require('../principal/web');
  const hotes = [];
  t.mock.method(dns, 'lookup', async (hote) => {
    hotes.push(hote);
    return [{ address: hotes.length === 1 ? '93.184.215.14' : '10.0.0.1', family: 4 }];
  });
  let requetes = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requetes++;
    return new Response(null, { status: 302, headers: { location: 'https://cible.example/' } });
  });
  assert.match(await lirePageWeb('https://page.example/'), /réseau local/);
  assert.deepEqual(hotes, ['page.example', 'cible.example']);
  assert.equal(requetes, 1);
});

// Bug vu par Tom (2026-11-27) : DuckDuckGo renvoie une page de vérification anti-robot (202, « anomaly »). L'app la
// lisait comme « Aucun résultat », le modèle relançait 4 ou 5 recherches, puis finissait parfois sans rien répondre.
test('recherche bloquée par le moteur (page anti-robot) : « indisponible », pas « aucun résultat », et une seule fois par réponse', async (t) => {
  const { chercherWeb, RECHERCHE_INDISPONIBLE } = require('../principal/web');
  const page = '<!DOCTYPE html><html><head><title>DuckDuckGo</title></head><body><div class="anomaly-modal__title">Unfortunately, bots use DuckDuckGo too.</div><form id="challenge-form"></form></body></html>';
  let appels = 0;
  t.mock.method(globalThis, 'fetch', async () => { appels++; return new Response(page, { status: 202 }); });
  const r = await chercherWeb('métier pentester');
  assert.equal(r.indisponible, true);
  assert.equal(r.texte, RECHERCHE_INDISPONIBLE);
  assert.doesNotMatch(r.texte, /Aucun résultat|Essaie d'autres mots/);
  assert.match(r.texte, /réponds avec ce que tu sais/i);
  assert.deepEqual(r.urls, []);
  // Dans l'agent : après un blocage, les recherches suivantes de la même réponse ne repartent pas sur internet
  const { executerOutil } = require('../principal/agent');
  const ctx = { liensDonnes: [] };
  assert.equal(await executerOutil('chercher_web', { requete: 'a' }, ctx), RECHERCHE_INDISPONIBLE);
  assert.equal(await executerOutil('chercher_web', { requete: 'b' }, ctx), RECHERCHE_INDISPONIBLE);
  // Chaque recherche bloquée essaie DuckDuckGo puis Wikipédia (2 appels) : 2 recherches = 4 appels, la 3e n'est pas envoyée
  assert.equal(appels, 4, 'la 2e recherche de la réponse dans l agent n est pas envoyée');
});

test('recherche normale : toujours les résultats ; page vide sans blocage : toujours « aucun résultat »', async (t) => {
  const { chercherWeb } = require('../principal/web');
  const resultats = '<div class="result results_links"><a rel="nofollow" class="result__a" href="https://exemple.fr/pentest">Pentest</a><a class="result__snippet">Le métier</a></div>';
  t.mock.method(globalThis, 'fetch', async () => new Response(resultats, { status: 200 }));
  const r = await chercherWeb('pentest');
  assert.equal(r.indisponible, undefined);
  assert.deepEqual(r.urls, ['https://exemple.fr/pentest']);
  t.mock.method(globalThis, 'fetch', async () => new Response('<html><body>rien</body></html>', { status: 200 }));
  assert.match((await chercherWeb('zzzz')).texte, /Aucun résultat/);
});

// SearXNG sur le serveur de Tom : réglage « rechercheUrl » (settings.json). Réponse JSON de SearXNG.
test('SearXNG : adresse acceptée (maison, Tailscale, ou https), jamais une adresse piégée', () => {
  const { adresseSearxng } = require('../principal/web');
  assert.equal(adresseSearxng('http://100.101.102.103:8888/'), 'http://100.101.102.103:8888');
  assert.equal(adresseSearxng('  http://192.168.1.50:8888  '), 'http://192.168.1.50:8888');
  assert.equal(adresseSearxng('http://serveur.exemple.ts.net:8888/searxng/'), 'http://serveur.exemple.ts.net:8888/searxng');
  assert.equal(adresseSearxng('https://recherche.exemple.org'), 'https://recherche.exemple.org');
  // http en clair sur internet : non (la requête passerait en clair)
  assert.equal(adresseSearxng('http://recherche.exemple.org'), null);
  // identifiants dans l'adresse, autre protocole, n'importe quoi : non
  for (const faux of ['http://moi:secret@100.101.102.103:8888', 'file:///etc/passwd', 'javascript:alert(1)', 'pas une adresse', '', null]) assert.equal(adresseSearxng(faux), null, String(faux));
});

test('SearXNG : utilisé s il est réglé ; s il ne répond pas, retour à DuckDuckGo', async (t) => {
  const { chercherWeb } = require('../principal/web');
  const vus = [];
  const reponseSearx = { results: [
    { title: 'Test d intrusion', url: 'https://fr.wikipedia.org/wiki/Test_d%27intrusion', content: 'Méthode d évaluation de la sécurité' },
    { title: 'Piège', url: 'javascript:alert(1)', content: 'x' },
    { title: 'OSCP', url: 'https://exemple.fr/oscp', content: '' },
  ] };
  t.mock.method(globalThis, 'fetch', async (url) => {
    vus.push(String(url));
    if (String(url).startsWith('http://100.101.102.103:8888/search?')) return new Response(JSON.stringify(reponseSearx), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return new Response('<div class="result results_links"><a class="result__a" href="https://exemple.fr/ddg">DDG</a></div>', { status: 200 });
  });
  const r = await chercherWeb('métier pentester', undefined, { searxng: 'http://100.101.102.103:8888' });
  assert.deepEqual(r.urls, ['https://fr.wikipedia.org/wiki/Test_d%27intrusion', 'https://exemple.fr/oscp']);
  assert.match(r.texte, /Test d intrusion/);
  const demande = new URL(vus[0]);
  assert.equal(demande.searchParams.get('q'), 'métier pentester');
  assert.equal(demande.searchParams.get('format'), 'json');
  assert.equal(vus.length, 1, 'DuckDuckGo n est pas appelé');
  // SearXNG éteint : DuckDuckGo prend le relais
  vus.length = 0;
  const r2 = await chercherWeb('pentest', undefined, { searxng: 'http://100.101.102.103:9999' });
  assert.deepEqual(r2.urls, ['https://exemple.fr/ddg']);
  assert.equal(vus.length, 2);
  // Une adresse refusée n'est jamais appelée
  vus.length = 0;
  await chercherWeb('pentest', undefined, { searxng: 'http://recherche.exemple.org' });
  assert.ok(vus.every((u) => u.includes('duckduckgo')));
  // L'agent passe le réglage
  const { executerOutil } = require('../principal/agent');
  vus.length = 0;
  await executerOutil('chercher_web', { requete: 'x' }, { liensDonnes: [], reglages: () => ({ rechercheUrl: 'http://100.101.102.103:8888' }) });
  assert.ok(vus[0].startsWith('http://100.101.102.103:8888/search?'));
});

test('app : le réglage SearXNG (Réglages › Avancé) est essayé avant d être enregistré', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const main = lire('main.js');
  assert.ok(main.includes("ipcMain.handle('recherche-regler'"));
  assert.ok(main.includes('const resultats = await chercherSearxng(base,') && main.indexOf('await chercherSearxng(base,') < main.indexOf('rechercheUrl: base'));
  assert.match(lire('index.html'), /id="recherche-url"/);
  assert.match(lire('preload.js'), /rechercheRegler: \(url\) => ipcRenderer\.invoke\('recherche-regler'/);
});

// DuckDuckGo bloque les robots : on ne le contourne pas. En secours, l'API officielle de Wikipédia (gratuite, sans clé).
test('DuckDuckGo bloqué : Wikipédia prend le relais ; les deux en panne : « indisponible »', async (t) => {
  const { chercherWeb, RECHERCHE_INDISPONIBLE } = require('../principal/web');
  const antiRobot = '<html><body><div class="anomaly-modal__title">bots use DuckDuckGo too</div></body></html>';
  const wiki = { query: { search: [
    { title: 'Test d\'intrusion', snippet: 'Un <span class="searchmatch">test</span> d\'intrusion est une méthode' },
    { title: 'Kali Linux', snippet: 'Distribution &quot;Linux&quot;' },
  ] } };
  const vus = [];
  let wikiEnPanne = false;
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    vus.push({ url: String(url), entetes: options.headers || {} });
    if (String(url).includes('duckduckgo')) return new Response(antiRobot, { status: 202 });
    if (wikiEnPanne) return new Response('panne', { status: 503 });
    return new Response(JSON.stringify(wiki), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const r = await chercherWeb('test intrusion');
  assert.equal(r.indisponible, undefined);
  assert.deepEqual(r.urls, ['https://fr.wikipedia.org/wiki/Test_d%27intrusion', 'https://fr.wikipedia.org/wiki/Kali_Linux']);
  assert.match(r.texte, /Wikipédia/);
  assert.match(r.texte, /Un test d'intrusion est une méthode/);
  const appelWiki = new URL(vus[1].url);
  assert.equal(appelWiki.hostname, 'fr.wikipedia.org');
  assert.equal(appelWiki.searchParams.get('srsearch'), 'test intrusion');
  assert.match(vus[1].entetes['User-Agent'], /^CatAi\/.+\(https:\/\/github\.com\//, 'un User-Agent qui dit qui on est (règle de Wikimedia)');
  // Wikipédia en panne aussi : on le dit, sans boucler
  wikiEnPanne = true;
  const r2 = await chercherWeb('test intrusion');
  assert.equal(r2.indisponible, true);
  assert.equal(r2.texte, RECHERCHE_INDISPONIBLE);
});
