// Partager ma carte graphique : HTTPS avec certificat épinglé, un code à 6 chiffres pour ajouter un appareil, une clé
// par appareil (seule son empreinte est gardée), réseau privé seulement, essais limités, options bornées, et le relais
// du portable qui retrouve l'autre PC quand son adresse change
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../principal/partage-gpu');
const { creerCertificat, empreinteDe } = require('../principal/certificat');
const T = require('../principal/tunnel-distant');

const lireSource = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
// Un certificat pour toute la série (la création prend quelques millisecondes)
const CERT = creerCertificat();

test('le certificat : autosigné, lisible, valable 20 ans, empreinte SHA-256 du DER', () => {
  const crypto = require('node:crypto');
  const x = new crypto.X509Certificate(CERT.certificat);
  assert.equal(x.subject, 'CN=Cat Ai');
  assert.ok(x.verify(x.publicKey));
  assert.equal(x.fingerprint256.replace(/:/g, '').toLowerCase(), CERT.empreinte);
  assert.equal(empreinteDe(CERT.certificat), CERT.empreinte);
  assert.ok(new Date(x.validTo).getFullYear() - new Date().getFullYear() >= 19);
  assert.notEqual(creerCertificat().empreinte, CERT.empreinte);
});

test('adresses privées : maison, Tailscale, ce PC ; jamais internet', () => {
  for (const ip of ['192.168.1.20', '10.0.0.5', '172.16.0.1', '172.31.255.1', '100.64.0.1', '100.127.255.254', '127.0.0.1', '::1', '::ffff:192.168.1.2', 'fd7a:115c:a1e0::1']) assert.equal(P.adressePrivee(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '1.1.1.1', '2001:4860::8888', '', 'n importe quoi']) assert.equal(P.adressePrivee(ip), false, ip);
  assert.equal(P.estTailscale('100.101.102.103'), true);
  assert.equal(P.estTailscale('192.168.1.1'), false);
});

test('les adresses montrées : la maison d abord, Tailscale à part, sans les cartes virtuelles ni les VPN', () => {
  const v4 = (address) => ({ address, family: 'IPv4', internal: false, netmask: '255.255.255.0' });
  const r = P.adressesDuPC({
    'vEthernet (WSL (Hyper-V firewall))': [v4('172.17.240.1')], 'OpenVPN Data Channel Offload': [v4('10.8.0.2')],
    Tailscale: [v4('100.101.102.103')], Ethernet: [v4('10.0.0.8'), v4('192.168.1.20')], 'Loopback Pseudo-Interface 1': [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  });
  assert.deepEqual(r, { maison: ['192.168.1.20', '10.0.0.8'], tailscale: ['100.101.102.103'] });
});

// Une gestion des appareils en mémoire, avec une horloge réglable
function gestionEnMemoire() {
  let liste = [];
  let t = 1_000_000;
  const g = P.creerGestionAppareils({ lire: () => liste, ecrire: (l) => { liste = l; }, maintenant: () => t });
  return { g, liste: () => liste, avancer: (ms) => { t += ms; } };
}

test('ajouter un appareil : code à 6 chiffres, 2 minutes, un seul usage, 5 essais ; seule l empreinte de la clé est gardée', () => {
  const { g, liste, avancer } = gestionEnMemoire();
  assert.deepEqual(g.appairer('123456', 'x'), { ok: false, raison: 'aucun' });
  const { code } = g.ouvrirAjout();
  assert.match(code, /^\d{6}$/);
  const r = g.appairer(`${code.slice(0, 3)} ${code.slice(3)}`, 'Portable <script>');
  assert.equal(r.ok, true);
  assert.ok(r.cle.length >= 40);
  assert.equal(liste()[0].nom, 'Portable script');
  assert.equal(liste()[0].cle, P.empreinteCle(r.cle));
  assert.ok(!JSON.stringify(liste()).includes(r.cle), 'la clé en clair n est jamais enregistrée');
  assert.deepEqual(g.appairer(code, 'encore'), { ok: false, raison: 'aucun' }, 'un code ne sert qu une fois');
  assert.deepEqual(g.verifier(r.cle), { id: r.id, nom: 'Portable script' });
  assert.equal(g.verifier('mauvaise'), null);
  assert.equal(g.verifier(''), null);
  // 5 mauvais codes : l'ajout est annulé
  const second = g.ouvrirAjout().code;
  const faux = second === '000000' ? '111111' : '000000';
  for (let i = 0; i < 4; i++) assert.equal(g.appairer(faux, 'x').raison, 'mauvais');
  assert.equal(g.appairer(faux, 'x').raison, 'ferme');
  assert.equal(g.appairer(second, 'x').raison, 'aucun');
  // Le code expire au bout de 2 minutes
  const troisieme = g.ouvrirAjout().code;
  avancer(P.DUREE_CODE + 1);
  assert.equal(g.ajoutEnCours(), null);
  assert.equal(g.appairer(troisieme, 'x').raison, 'aucun');
  // Retirer : la clé ne marche plus
  g.retirer(r.id);
  assert.equal(g.verifier(r.cle), null);
  assert.deepEqual(g.appareils(), []);
});

test('ce qu un appareil demande à Ollama est borné : contexte, durée de chargement', () => {
  assert.equal(P.borner({ options: { num_ctx: 1_000_000 } }).options.num_ctx, P.MAX_CONTEXTE);
  assert.equal(P.borner({ options: { num_ctx: 8192 } }).options.num_ctx, 8192);
  for (const garde of [-1, '-1', '24h', 999999, 'n importe quoi']) assert.equal(P.borner({ keep_alive: garde }).keep_alive, '30m', String(garde));
  for (const garde of ['5m', '30m', 0, 300, '90s']) assert.equal(P.borner({ keep_alive: garde }).keep_alive, garde, String(garde));
});

// Un faux Ollama qui garde ce qu'il reçoit et répond, et le vrai serveur de partage en HTTPS devant lui
async function avecServeurs(travail, { lent = false } = {}) {
  const recus = [];
  const ollama = http.createServer((req, res) => {
    let corps = '';
    req.on('data', (m) => { corps += m; });
    req.on('end', () => {
      recus.push({ chemin: req.url, corps: corps ? JSON.parse(corps) : null });
      if (req.url === '/api/chat') {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.write('{"message":{"content":"Miaou"},"done":false}\n');
        if (lent) { setTimeout(() => res.end('{"done":true,"eval_count":3,"eval_duration":1000}\n'), 300); return; }
        res.end('{"done":true,"eval_count":3,"eval_duration":1000}\n');
        return;
      }
      if (req.url === '/api/show') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ capabilities: ['completion', 'thinking'], details: { family: 'qwen' }, model_info: { 'qwen.ssm.x': 1 }, modelfile: 'FROM C:\Users\Quelqu un\.ollama\blob', license: 'long texte', template: '{{ .Prompt }}' })); return; }
      if (req.url === '/v1/models') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'qwen3.5:9b' }] })); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"Salut"}}]}\n\n');
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise((ok) => ollama.listen(0, '127.0.0.1', ok));
  const { g } = gestionEnMemoire();
  const partage = P.creerServeurPartage({ certificat: CERT, gestion: g, ollama: `http://127.0.0.1:${ollama.address().port}`, nom: 'PC-fixe', adresses: () => ({ maison: ['192.168.1.50'], tailscale: ['100.101.102.103'] }) });
  await new Promise((ok) => partage.listen(0, '127.0.0.1', ok));
  const port = partage.address().port;
  const cible = { adresse: '127.0.0.1', port, certificat: CERT.certificat, empreinte: CERT.empreinte };
  // Une requête vers le partage, certificat épinglé
  const demander = async (methode, chemin, { cle, corps } = {}) => {
    const res = await T.requeteEpinglee(cible, { methode, chemin, corps: corps && JSON.stringify(corps), entetes: { 'Content-Type': 'application/json', ...(cle ? { Authorization: `Bearer ${cle}` } : {}) } });
    let texte = '';
    for await (const m of res) texte += m;
    return { statut: res.statusCode, texte, json: () => JSON.parse(texte) };
  };
  try { await travail({ g, port, cible, recus, demander }); } finally { partage.close(); partage.closeAllConnections?.(); ollama.close(); ollama.closeAllConnections?.(); }
}

test('le serveur : HTTPS, /catai sans nom, ajout par code, clé par appareil, seulement discuter et lister', async () => {
  await avecServeurs(async ({ g, port, recus, demander }) => {
    // /catai : sans clé, seulement l'identifiant du certificat (ni nom de PC ni de personne)
    const info = await P.lireCatai('127.0.0.1', { port });
    assert.equal(info.id, P.idDuCertificat(CERT.certificat));
    assert.equal(info.empreinte, CERT.empreinte);
    assert.deepEqual((await demander('GET', '/catai')).json(), { catai: 2, id: info.id });
    // Sans clé ni code
    assert.equal((await demander('GET', '/v1/models')).statut, 401);
    assert.equal((await demander('POST', '/catai/appairer', { corps: { code: '123456' } })).statut, 409);
    // L'ajout par code, avec le vrai client
    const { code } = g.ouvrirAjout();
    const ajoute = await T.appairer({ adresse: '127.0.0.1', port, code, nom: 'Portable' });
    assert.equal(ajoute.empreinte, CERT.empreinte);
    assert.equal(ajoute.id, info.id);
    assert.equal(ajoute.nom, 'PC-fixe');
    const cle = ajoute.cle;
    assert.deepEqual((await demander('GET', '/v1/models', { cle })).json().data.map((m) => m.id), ['qwen3.5:9b']);
    for (const [methode, chemin] of [['POST', '/api/pull'], ['DELETE', '/api/delete'], ['POST', '/api/create'], ['POST', '/api/generate'], ['POST', '/api/copy'], ['GET', '/']]) {
      assert.equal((await demander(methode, chemin, { cle })).statut, 404, chemin);
    }
    // /v1 : pas de réflexion silencieuse par défaut ; options bornées
    const v1 = await demander('POST', '/v1/chat/completions', { cle, corps: { model: 'qwen3.5:9b', messages: [], stream: true, options: { num_ctx: 999999 }, keep_alive: -1 } });
    assert.match(v1.texte, /Salut[\s\S]*\[DONE\]/);
    assert.equal(recus.at(-1).corps.reasoning_effort, 'none');
    assert.equal(recus.at(-1).corps.options.num_ctx, P.MAX_CONTEXTE);
    assert.equal(recus.at(-1).corps.keep_alive, '30m');
    // /api/chat (Ollama natif) : rien n'est ajouté ; un modèle est obligatoire
    const natif = await demander('POST', '/api/chat', { cle, corps: { model: 'qwen3.5:9b', messages: [], think: true } });
    assert.match(natif.texte, /Miaou[\s\S]*eval_count/);
    assert.deepEqual(recus.at(-1).corps, { model: 'qwen3.5:9b', messages: [], think: true });
    assert.equal((await demander('POST', '/api/chat', { cle, corps: { messages: [] } })).statut, 400);
    assert.ok(recus.every((x) => x.chemin.startsWith('/v1/') || x.chemin === '/api/chat'), 'rien d autre n arrive à Ollama');
    // Retiré : la clé ne marche plus
    g.retirer(ajoute.id === info.id ? g.appareils()[0].id : '');
    assert.equal((await demander('GET', '/v1/models', { cle })).statut, 401);
  });
});

test('un autre certificat est refusé avant d envoyer la clé (faux PC sur le Wi-Fi)', async () => {
  await avecServeurs(async ({ port }) => {
    const autre = creerCertificat();
    await assert.rejects(T.requeteEpinglee({ adresse: '127.0.0.1', port, certificat: autre.certificat, empreinte: autre.empreinte }, { chemin: '/v1/models' }));
    // Même avec le bon certificat comme autorité, une autre empreinte attendue est refusée
    await assert.rejects(T.requeteEpinglee({ adresse: '127.0.0.1', port, certificat: CERT.certificat, empreinte: autre.empreinte }, { chemin: '/v1/models' }), /certificat inattendu/);
    // Et jamais hors du réseau privé
    await assert.rejects(T.requeteEpinglee({ adresse: '8.8.8.8', port, certificat: CERT.certificat, empreinte: CERT.empreinte }, { chemin: '/' }), /réseau privé/);
  });
});

test('mauvais code ou mauvaise clé : 10 ratés et cette adresse est refusée un moment', async () => {
  await avecServeurs(async ({ g, demander }) => {
    for (let i = 0; i < 10; i++) assert.equal((await demander('GET', '/v1/models', { cle: 'ZZZZ' })).statut, 401);
    const { code } = g.ouvrirAjout();
    assert.equal((await demander('POST', '/catai/appairer', { corps: { code } })).statut, 429, 'même avec le bon code');
    assert.equal((await demander('GET', '/catai')).statut, 200, 'la recherche reste possible');
  });
});

test('4 réponses à la fois au plus : la 5e attend son tour (503)', async () => {
  await avecServeurs(async ({ g, demander }) => {
    const { code } = g.ouvrirAjout();
    const { cle } = g.appairer(code, 'Portable');
    const corps = { model: 'm', messages: [] };
    const enCours = Array.from({ length: P.MAX_EN_COURS }, () => demander('POST', '/api/chat', { cle, corps }));
    await new Promise((ok) => setTimeout(ok, 100));
    assert.equal((await demander('POST', '/api/chat', { cle, corps })).statut, 503);
    for (const r of await Promise.all(enCours)) assert.equal(r.statut, 200);
    assert.equal((await demander('POST', '/api/chat', { cle, corps })).statut, 200, 'libéré après les réponses');
  }, { lent: true });
});

test('le relais du portable : jeton obligatoire, clé ajoutée, réponse en flux ; l autre PC retrouvé quand son adresse change', async () => {
  await avecServeurs(async ({ g, port, cible }) => {
    const { code } = g.ouvrirAjout();
    const { cle } = g.appairer(code, 'Portable');
    // L'adresse retenue ne répond plus (le PC a changé d'adresse) : le relais le cherche, puis réessaie
    let actuelle = { ...cible, port: 1, cle };
    let recherches = 0;
    const raisons = [];
    const tunnel = T.creerTunnel({ cible: () => actuelle, retrouver: async (o) => { recherches++; raisons.push(o); actuelle = { ...cible, cle }; return true; } });
    const base = await tunnel.pret;
    try {
      assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.equal((await fetch(`${base}/v1/models`)).status, 401, 'sans le jeton du relais');
      assert.equal((await fetch(`${base}/v1/models`, { headers: { Authorization: 'Bearer autre' } })).status, 401);
      const avec = { Authorization: `Bearer ${tunnel.jeton}`, 'Content-Type': 'application/json' };
      assert.equal((await fetch(`${base}/api/pull`, { method: 'POST', headers: avec, body: '{}' })).status, 404);
      const r = await fetch(`${base}/v1/models`, { headers: avec });
      assert.equal(r.status, 200);
      assert.deepEqual((await r.json()).data.map((m) => m.id), ['qwen3.5:9b']);
      assert.equal(recherches, 1);
      // Une vérification de fond (liste des modèles) ne réveille jamais l autre PC
      assert.deepEqual(raisons, [{ reveiller: false }]);
      // Le chat comme sur un Ollama local : réponse, statistiques, réflexion transmise
      const { envoyerOllama } = require('../principal/envoi');
      const mesures = [];
      const rep = await envoyerOllama([{ role: 'user', content: 'Salut' }], 'qwen3.5:9b', () => {}, undefined, { reflexion: true, onStatistiques: (m) => mesures.push(m), ollama: { adresse: base, cle: tunnel.jeton } });
      assert.equal(rep.content, 'Miaou');
      assert.equal(mesures[0].eval_count, 3);
      // Introuvable : un message clair, sans boucle
      actuelle = { ...cible, port: 1, cle };
      const tunnel2 = T.creerTunnel({ cible: () => actuelle, retrouver: async () => false });
      const base2 = await tunnel2.pret;
      const ko = await fetch(`${base2}/v1/models`, { headers: { Authorization: `Bearer ${tunnel2.jeton}` } });
      assert.equal(ko.status, 502);
      assert.match((await ko.json()).error.message, /ne répond pas/);
      tunnel2.serveur.close();
    } finally { tunnel.serveur.close(); tunnel.serveur.closeAllConnections?.(); }
  });
});

test('la recherche sur le Wi-Fi (UDP) : le PC qui partage répond avec son identifiant, jamais son nom', async () => {
  const portRecherche = 31000 + Math.floor(Math.random() * 2000);
  const id = P.idDuCertificat(CERT.certificat);
  const reponse = P.creerReponseRecherche({ id, port: 11435, portRecherche });
  await new Promise((ok) => reponse.once('listening', ok));
  try {
    const trouves = await P.chercherPartages({ duree: 400, cibles: ['127.0.0.1'], portRecherche });
    assert.deepEqual(trouves, [{ id, adresse: '127.0.0.1', port: 11435 }]);
  } finally { reponse.close(); }
});

test('la recherche partout : voisins du Wi-Fi et PC de Tailscale, un résultat par identifiant, ce PC exclu', async () => {
  const v4 = (address) => ({ address, family: 'IPv4', internal: false, netmask: '255.255.255.0' });
  const liste = P.voisins({ Wifi: [v4('192.168.1.20')] });
  assert.equal(liste.length, 253);
  assert.ok(!liste.includes('192.168.1.20') && liste.includes('192.168.1.1') && liste.includes('192.168.1.254'));
  // Sonder : seul un Cat Ai qui répond compte ; jamais une adresse d'internet
  const vues = [];
  const lire = async (adresse) => {
    vues.push(adresse);
    if (adresse === '192.168.1.50') return { id: 'abcdef0123456789', adresse };
    throw new Error('rien');
  };
  assert.deepEqual(await P.sonder(['192.168.1.49', '192.168.1.50', '8.8.8.8'], { lire }), [{ id: 'abcdef0123456789', adresse: '192.168.1.50', port: 11435 }]);
  assert.ok(!vues.includes('8.8.8.8'));
  const sortie = JSON.stringify({ Peer: { a: { Online: true, TailscaleIPs: ['100.101.102.103', 'fd7a:115c:a1e0::1'] }, b: { Online: false, TailscaleIPs: ['100.90.1.2'] } } });
  assert.deepEqual(await P.pcTailscale({ executer: (_c, _a, _o, cb) => cb(null, sortie) }), ['100.101.102.103']);
  assert.deepEqual(await P.pcTailscale({ executer: (_c, _a, _o, cb) => cb(new Error('absent')) }), []);
  const tous = await P.chercherPartout({
    exclure: new Set(['192.168.1.20']),
    chercherUdp: async () => [{ id: 'moi0000000000000', adresse: '192.168.1.20', port: 11435 }],
    listeVoisins: () => ['192.168.1.50'],
    tailscale: async () => ['100.101.102.103'],
    sonde: async (adresses) => adresses.map((adresse) => ({ id: 'abcdef0123456789', adresse, port: 11435 })),
  });
  assert.deepEqual(tous, [{ id: 'abcdef0123456789', adresse: '192.168.1.50', port: 11435 }]);
  // Un PC qui annonce un identifiant qui n'est pas celui de son certificat est ignoré (lireCatai le vérifie)
  assert.match(lireSource('principal/partage-gpu.js'), /if \(empreinte\.slice\(0, 16\) !== r\.id\) return ko\(/);
});

test('app : le fournisseur passe par le relais, le préchargement, les canaux, l interface', () => {
  const { FOURNISSEURS_DE_BASE } = require('../principal/fournisseurs');
  assert.ok(FOURNISSEURS_DE_BASE.some((f) => f.id === 'distant' && f.distant && f.type === 'openai'));
  const { limitesTaille, LIMITES_OLLAMA } = require('../principal/taille');
  assert.deepEqual(limitesTaille({ baseUrl: 'http://127.0.0.1:53000/v1' }), LIMITES_OLLAMA);
  const fournisseurs = lireSource('principal/fournisseurs.js');
  assert.ok(fournisseurs.includes('if (infos.distant) return { ...infos, cle: relaisDistant?.jeton || \'\', cleIllisible: false };'));
  const main = lireSource('main.js');
  for (const canal of ['partage-etat', 'partage-activer', 'partage-ajouter', 'partage-annuler-ajout', 'partage-retirer', 'distant-chercher', 'distant-connecter', 'distant-oublier']) assert.ok(main.includes(`ipcMain.handle('${canal}'`), canal);
  assert.ok(!main.includes("'partage-nouvelle-cle'"));
  assert.match(main, /serveur\.listen\(PORT_PARTAGE, '0\.0\.0\.0'/);
  assert.ok(main.includes('if (config.distant) return (messages, modele, onMorceau, signal, options = {}) => envoyerOllama('));
  assert.ok(main.includes("...((config.type === 'ollama' || config.distant) && reflexion === true ? { reflexion: true } : {})"));
  assert.ok(main.includes('demarrerRelais().catch(() => {});'));
  const html = lireSource('index.html');
  for (const id of ['partage-interrupteur', 'partage-ajouter', 'partage-appareils', 'distant-code', 'distant-connecter']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.doesNotMatch(html, /id="partage-cle"|id="distant-cle"/);
  assert.match(html, /tailscale\.com\/download/);
  const renderer = lireSource('renderer.js');
  assert.match(renderer, /reglages\.fournisseurs\.filter\(\(f\) => f\.type !== "ollama" && !f\.distant\)/);
  assert.ok(renderer.includes('if ((f.type !== "ollama" && !f.distant) || !modelSel.value)'));
  assert.ok(lireSource('principal/fournisseurs.js').includes("baseUrl: f.baseUrl, ...(f.distant ? { distant: true } : {})"));
});

test('pentest : les adresses Tailscale (100.64-127) ne sont acceptées que si la connexion arrive par Tailscale', () => {
  // Arrivée par l'adresse Tailscale de ce PC : oui
  assert.equal(P.origineAcceptee('100.101.102.103', '100.110.1.2'), true);
  // Même adresse source, mais arrivée par la carte de la maison : un voisin chez un fournisseur en CGNAT, refusé
  assert.equal(P.origineAcceptee('100.101.102.103', '192.168.1.50'), false);
  assert.equal(P.origineAcceptee('::ffff:100.101.102.103', '::ffff:192.168.1.50'), false);
  // La maison et ce PC : oui ; internet : jamais
  assert.equal(P.origineAcceptee('192.168.1.20', '192.168.1.50'), true);
  assert.equal(P.origineAcceptee('127.0.0.1', '127.0.0.1'), true);
  assert.equal(P.origineAcceptee('8.8.8.8', '100.110.1.2'), false);
});

test('pentest : la fiche d un modèle est réduite (ni modelfile ni licence), les adresses ne vont qu aux appareils ajoutés', async () => {
  assert.deepEqual(Object.keys(P.champsFiche({ capabilities: [], details: {}, model_info: {}, modelfile: 'x', license: 'y' })), ['capabilities', 'details', 'model_info']);
  await avecServeurs(async ({ g, cible, demander }) => {
    assert.equal((await demander('GET', '/catai/adresses')).statut, 401, 'sans clé');
    const { code } = g.ouvrirAjout();
    const { cle } = g.appairer(code, 'Portable');
    const fiche = (await demander('POST', '/api/show', { cle, corps: { model: 'qwen3.5:9b' } })).json();
    assert.deepEqual(Object.keys(fiche).sort(), ['capabilities', 'details', 'model_info']);
    assert.deepEqual(fiche.capabilities, ['completion', 'thinking']);
    assert.deepEqual(await T.lireAdresses({ ...cible, cle }), ['100.101.102.103', '192.168.1.50']);
  });
});

test('loin de chez toi : l autre PC est retrouvé par ses adresses connues et Tailscale, JAMAIS par une sonde du réseau local', async () => {
  const lus = [];
  const bon = { id: 'abcdef0123456789', empreinte: 'e'.repeat(64) };
  const lire = async (adresse) => {
    lus.push(adresse);
    if (adresse === '100.110.1.2') return bon;
    if (adresse === '100.90.9.9') return { id: bon.id, empreinte: 'f'.repeat(64) }; // même identifiant, autre certificat : imposteur
    throw new Error('rien');
  };
  const trouve = await T.retrouverPC({ ...bon, connues: ['192.168.1.50', '100.110.1.2'], sauf: '192.168.1.50', tailscale: async () => ['100.90.9.9', '100.110.1.2'], lire });
  assert.equal(trouve, '100.110.1.2');
  assert.deepEqual(lus.sort(), ['100.110.1.2', '100.90.9.9'], 'seulement les adresses connues (sauf celle qui ne répond plus) et Tailscale');
  // À la maison, les deux répondent : la maison d'abord
  const lireTout = async () => bon;
  assert.equal(await T.retrouverPC({ ...bon, connues: ['100.110.1.2', '192.168.1.50'], tailscale: async () => [], lire: lireTout }), '192.168.1.50');
  // Rien : null, sans erreur ; jamais une adresse d'internet
  assert.equal(await T.retrouverPC({ ...bon, connues: ['8.8.8.8'], tailscale: async () => { throw new Error('pas de Tailscale'); }, lire: async () => bon }), null);
  // main.js : la recherche automatique passe par retrouverPC, pas par chercherAutresPC (qui sonde le Wi-Fi)
  const main = lireSource('main.js');
  const corps = main.slice(main.indexOf('function retrouverAutrePC('), main.indexOf('function retenirAdresseDistante'));
  assert.ok(corps.includes('retrouverPC({') && !corps.includes('chercherAutresPC'));
});
