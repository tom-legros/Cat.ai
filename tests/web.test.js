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
