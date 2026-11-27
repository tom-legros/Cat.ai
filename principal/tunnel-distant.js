// Côté portable : parler au PC qui partage sa carte graphique (principal/partage-gpu.js).
//
// - appairer : avec le code à 6 chiffres affiché sur l'autre PC, on reçoit une clé propre à cet appareil, et on retient
//   le certificat de l'autre PC (son empreinte). Ensuite, toute connexion avec un autre certificat est refusée avant
//   d'envoyer quoi que ce soit (la clé part dans la connexion chiffrée, jamais en clair).
// - creerTunnel : un petit relais sur 127.0.0.1 (port au hasard) que le reste de l'app utilise comme un Ollama
//   ordinaire. Il demande son propre jeton (une page web ouverte sur ce PC ne peut donc pas s'en servir), ajoute la
//   clé de l'appareil et passe par HTTPS épinglé. Si l'autre PC a changé d'adresse, il le retrouve (par l'identifiant
//   de son certificat) et réessaie, une fois.
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { ROUTES, PORT_PARTAGE, adressePrivee, memeTexte, lireCatai, pcTailscale, rangAdresse } = require('./partage-gpu');

const MAX_CORPS = 25 * 1024 * 1024;
// Les erreurs « l'autre PC n'est pas là » : connexion jamais établie, rien n'a été envoyé, on peut réessayer
const INJOIGNABLE = new Set(['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'EHOSTDOWN', 'ECONNRESET', 'ENOTFOUND']);

// Une requête HTTPS vers l'autre PC, avec son certificat épinglé : un autre certificat → erreur, avant tout envoi
function requeteEpinglee({ adresse, port = PORT_PARTAGE, certificat, empreinte }, { methode = 'GET', chemin, entetes = {}, corps, delai = 6000 } = {}) {
  return new Promise((ok, ko) => {
    if (!adressePrivee(adresse)) return ko(new Error('adresse hors du réseau privé'));
    const req = https.request({
      host: adresse, port, path: chemin, method: methode, agent: false,
      ca: certificat,
      // L'adresse change (box, Tailscale) : on ne vérifie pas le nom, seulement que c'est exactement ce certificat
      checkServerIdentity: (_hote, cert) => {
        const vue = String(cert.fingerprint256 || '').replace(/:/g, '').toLowerCase();
        return memeTexte(vue, empreinte) ? undefined : new Error('certificat inattendu : ce n’est pas le PC ajouté');
      },
      headers: { ...entetes, ...(corps ? { 'Content-Length': Buffer.byteLength(corps) } : {}) },
    }, ok);
    // Délai pour se connecter seulement : une réponse longue (le modèle écrit) n'est pas coupée
    const minuterie = setTimeout(() => req.destroy(Object.assign(new Error('pas de réponse'), { code: 'ETIMEDOUT' })), delai);
    req.on('socket', (s) => s.once('secureConnect', () => clearTimeout(minuterie)));
    req.on('response', () => clearTimeout(minuterie));
    req.on('error', (e) => { clearTimeout(minuterie); ko(e); });
    req.end(corps);
  });
}

async function lireJson(res) {
  let texte = '';
  for await (const m of res) { texte += m; if (texte.length > 1_000_000) break; }
  return JSON.parse(texte || '{}');
}

// Ajouter cet appareil sur l'autre PC avec son code. Renvoie ce qu'il faut retenir (la clé est à chiffrer).
async function appairer({ adresse, port = PORT_PARTAGE, code, nom, lire = lireCatai }) {
  const info = await lire(adresse, { port, delai: 3000 });
  const res = await requeteEpinglee(info, {
    methode: 'POST', chemin: '/catai/appairer',
    entetes: { 'Content-Type': 'application/json' },
    corps: JSON.stringify({ code: String(code || ''), nom: String(nom || '').slice(0, 40) }),
  });
  const r = await lireJson(res).catch(() => ({}));
  if (res.statusCode !== 200) {
    const e = new Error(r?.error?.message || `L'autre PC a répondu ${res.statusCode}.`);
    e.statut = res.statusCode;
    throw e;
  }
  if (r.id !== info.id || typeof r.cle !== 'string' || r.cle.length < 32) throw new Error("Réponse inattendue de l'autre PC.");
  return { adresse, port, id: info.id, empreinte: info.empreinte, certificat: info.certificat, cle: r.cle, nom: String(r.nom || 'PC').slice(0, 40) };
}

// Les adresses de l'autre PC (maison et Tailscale), demandées avec la clé de l'appareil : on les retient pour le
// retrouver loin de chez toi, sans rien taper
// Avec elles, de quoi le réveiller (Wake-on-LAN : sa MAC et l'adresse de diffusion de la maison), s'il le donne.
async function lireInfosDistantes(cible) {
  const res = await requeteEpinglee(cible, { chemin: '/catai/adresses', entetes: { Authorization: `Bearer ${cible.cle}` }, delai: 4000 });
  if (res.statusCode !== 200) { res.resume(); throw new Error(`L'autre PC a répondu ${res.statusCode}.`); }
  const r = await lireJson(res);
  const adresses = [...new Set([...(r.tailscale || []), ...(r.maison || [])])].filter((a) => typeof a === 'string' && adressePrivee(a)).slice(0, 8);
  const { normaliserMac } = require('./reveil');
  const mac = normaliserMac(r.reveil?.mac);
  const diffusion = typeof r.reveil?.diffusion === 'string' && adressePrivee(r.reveil.diffusion) ? r.reveil.diffusion : null;
  return { adresses, reveil: mac && diffusion ? { mac, diffusion } : null };
}
const lireAdresses = async (cible) => (await lireInfosDistantes(cible)).adresses;

// Retrouver l'autre PC quand il ne répond plus à son adresse. JAMAIS de sonde du réseau local : loin de chez toi
// (école, café), ce réseau n'est pas le tien. Seulement les adresses déjà connues de ce PC et les appareils de ton
// Tailscale ; il doit avoir le même certificat. La plus proche d'abord (la maison avant Tailscale).
async function retrouverPC({ id, empreinte, connues = [], sauf, tailscale = pcTailscale, lire = lireCatai, delai = 2500 }) {
  const candidats = [...new Set([...connues, ...(await tailscale().catch(() => []))])].filter((a) => a && a !== sauf && adressePrivee(a));
  const vus = await Promise.all(candidats.map((adresse) => lire(adresse, { delai })
    .then((r) => (r.id === id && r.empreinte === empreinte ? adresse : null)).catch(() => null)));
  return vus.filter(Boolean).sort((a, b) => rangAdresse(a) - rangAdresse(b))[0] || null;
}

// cible() : { adresse, port, certificat, empreinte, cle } de l'autre PC ; retrouver() : cherche l'autre PC par son
// identifiant et met son adresse à jour (true si trouvé). Renvoie { serveur, jeton, pret } (pret : l'adresse du relais).
function creerTunnel({ cible, retrouver = async () => false }) {
  const jeton = crypto.randomBytes(24).toString('base64url');
  const serveur = http.createServer((req, res) => {
    const erreur = (code, message) => {
      if (res.headersSent) { res.end(); return; }
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { message, type: 'catai_tunnel' } }));
    };
    // Seulement l'app (elle a le jeton) ; une page web ne peut pas envoyer cet en-tête sans demande préalable (refusée)
    const donne = (/^Bearer\s+(.+)$/i.exec(req.headers.authorization || '') || [])[1];
    if (!memeTexte(donne, jeton)) return erreur(401, 'Relais réservé à Cat Ai.');
    const chemin = (req.url || '').split('?')[0];
    if (!ROUTES.has(`${req.method} ${chemin}`)) return erreur(404, "Cette fonction d'Ollama n'est pas partagée.");
    const morceaux = [];
    let taille = 0;
    req.on('data', (m) => {
      taille += m.length;
      if (taille > MAX_CORPS) { erreur(413, 'Demande trop grosse.'); req.destroy(); return; }
      morceaux.push(m);
    });
    req.on('end', async () => {
      if (res.writableEnded) return;
      const corps = morceaux.length ? Buffer.concat(morceaux) : undefined;
      let amont;
      const envoyer = () => {
        const c = cible();
        if (!c) throw Object.assign(new Error("Aucun autre PC ajouté : Réglages › Cerveau › Autre PC."), { pasDeCible: true });
        return requeteEpinglee(c, { methode: req.method, chemin, corps, delai: 3500, entetes: { Authorization: `Bearer ${c.cle}`, 'Content-Type': 'application/json' } })
          .then((r) => { amont = r; return r; });
      };
      res.on('close', () => { if (!res.writableFinished) amont?.destroy(); });
      try {
        let reponse;
        try {
          reponse = await envoyer();
        } catch (e) {
          // L'autre PC n'est plus à son adresse (box, Wi-Fi), ou il dort : on le cherche (et on le réveille seulement
          // pour un message, jamais pour les vérifications de fond), puis on réessaie une fois
          if (!INJOIGNABLE.has(e.code) || !(await retrouver({ reveiller: /chat/.test(chemin) }))) throw e;
          reponse = await envoyer();
        }
        res.writeHead(reponse.statusCode || 502, { 'Content-Type': reponse.headers['content-type'] || 'application/json' });
        reponse.pipe(res);
      } catch (e) {
        if (e.pasDeCible) return erreur(503, e.message);
        if (/certificat inattendu/.test(e.message)) return erreur(502, "Un autre appareil répond à l'adresse de ton PC : connexion refusée. Si tu as réinstallé Cat Ai sur l'autre PC, ajoute à nouveau cet appareil.");
        erreur(502, "Ton autre PC ne répond pas. Il doit être allumé, avec Cat Ai ouvert et le partage activé. Loin de chez toi, il faut Tailscale sur les deux PC.");
      }
    });
  });
  const pret = new Promise((ok, ko) => {
    serveur.once('error', ko);
    serveur.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${serveur.address().port}`));
  });
  return { serveur, jeton, pret };
}

module.exports = { requeteEpinglee, appairer, lireAdresses, lireInfosDistantes, retrouverPC, creerTunnel, INJOIGNABLE };
