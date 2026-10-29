// Lecture de pages internet : adresses autorisées, liens donnés par l'utilisateur, et HTML transformé en texte
const test = require('node:test');
const assert = require('node:assert/strict');
const { urlsDans, memePage, ipInterdite, verifierUrl, texteDepuisHtml, presenterPage } = require('../principal/web');

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
