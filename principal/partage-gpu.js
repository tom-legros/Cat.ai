// « Partager ma carte graphique » : le PC fixe prête son Ollama à un autre PC de la maison (ou du même réseau
// Tailscale). Le portable garde tout chez lui (fichiers, discussions, interface) ; seules les questions au modèle
// partent vers le PC fixe.
//
// Un petit serveur HTTPS devant Ollama (qui, lui, reste fermé sur 127.0.0.1) :
// - HTTPS avec le certificat de ce PC (principal/certificat.js) : le portable l'a retenu en s'ajoutant, un faux PC
//   ne peut pas se faire passer pour celui-ci, et personne sur le Wi-Fi ne lit les messages ;
// - seulement depuis un réseau privé : la maison (192.168…, 10…, 172.16-31…) ou Tailscale (100.64-127…) ;
// - une clé par appareil, donnée à l'ajout (code à 6 chiffres affiché ici, valable 2 minutes, 5 essais) ; ce PC
//   n'en garde que l'empreinte, et chaque appareil peut être retiré seul ; 10 mauvaises clés ou codes en 10 minutes,
//   et cette adresse est refusée un moment ;
// - seulement discuter, lister les modèles et lire leur fiche (/api/chat, /api/tags, /api/show, et l'interface
//   compatible OpenAI /v1) : jamais télécharger, supprimer ou créer un modèle ; contexte et durée de chargement
//   bornés, 4 réponses à la fois au plus, pour que la carte graphique reste utilisable ici ;
// - par /v1, sans demande contraire, Qwen répond sans phase de réflexion (reasoning_effort « none ») : sinon il
//   réfléchit en silence, 100 s pour dire bonjour (mesuré).
// Le portable trouve ce PC tout seul : un message à tout le réseau (UDP), et, parce que beaucoup de box et de
// pare-feu le bloquent, un essai sur chaque adresse du réseau et de Tailscale (GET /catai, sans clé). La réponse ne
// donne ni le nom du PC ni celui de la personne : seulement un identifiant tiré du certificat.
const https = require('https');
const dgram = require('dgram');
const os = require('os');
const crypto = require('crypto');
const { empreinteDe, enPem } = require('./certificat');

const PORT_PARTAGE = 11435;
const PORT_RECHERCHE = 11436;
const QUESTION_RECHERCHE = 'CATAI-CHERCHE-2';
const ROUTES = new Set(['GET /v1/models', 'POST /v1/chat/completions', 'POST /api/chat', 'GET /api/tags', 'POST /api/show']);
const MAX_CORPS = 25 * 1024 * 1024; // une image jointe, en base64, tient dedans
const ESSAIS_MAX = 10;
const DUREE_ESSAIS = 10 * 60 * 1000;
const MAX_EN_COURS = 4;
const MAX_CONTEXTE = 32768;
const MAX_GARDE_MS = 30 * 60 * 1000;
const DUREE_CODE = 2 * 60 * 1000;
const ESSAIS_CODE = 5;

// ---------- Les adresses ----------
const sansPrefixe = (ip) => String(ip || '').replace(/^::ffff:/i, '');
function ipv4(ip) {
  const p = sansPrefixe(ip).split('.').map(Number);
  return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? p : null;
}
// Un réseau privé : la maison, Tailscale, ou le PC lui-même
function adressePrivee(ip) {
  const brute = sansPrefixe(ip).toLowerCase();
  if (brute === '::1' || brute === 'localhost') return true;
  const p = ipv4(brute);
  if (p) {
    return p[0] === 10 || p[0] === 127 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168)
      || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || (p[0] === 169 && p[1] === 254);
  }
  // IPv6 privées (fd00::/8, celles de Tailscale aussi) et locales au lien
  return /^f[cd][0-9a-f]{2}:/.test(brute) || /^fe80:/.test(brute);
}
const estTailscale = (ip) => { const p = ipv4(ip); return !!p && p[0] === 100 && p[1] >= 64 && p[1] <= 127; };
// D'où vient une connexion, et par où elle est arrivée. Les adresses 100.64-127… sont celles de Tailscale, mais
// certains fournisseurs d'accès s'en servent aussi (CGNAT) : on ne les accepte que si la connexion est arrivée par
// l'adresse Tailscale de ce PC.
const origineAcceptee = (distante, locale) => adressePrivee(distante) && (!estTailscale(distante) || estTailscale(locale));

// Les cartes réseau « virtuelles » (WSL, Hyper-V, Docker, machines virtuelles, VPN) : leurs adresses ne mènent pas au PC
// depuis un autre appareil de la maison
const VIRTUELLE = /vEthernet|WSL|Hyper-V|docker|veth|br-|virbr|VirtualBox|VMware|vmnet|Loopback|OpenVPN|TAP-|WireGuard|Teredo/i;
// La plus probable d'abord : le Wi-Fi ou le câble de la box (192.168…), puis 10…, puis 172.16-31…
const rangAdresse = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : estTailscale(ip) ? 3 : 2);

// Les adresses de ce PC à donner au portable : celles de la maison, et celle de Tailscale s'il y en a une
function adressesDuPC(interfaces = os.networkInterfaces()) {
  const maison = [];
  const tailscale = [];
  for (const [nom, liste] of Object.entries(interfaces)) {
    if (VIRTUELLE.test(nom) && !/tailscale/i.test(nom)) continue;
    for (const a of liste || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      if (estTailscale(a.address)) tailscale.push(a.address);
      else if (adressePrivee(a.address) && !a.address.startsWith('169.254.')) maison.push(a.address);
    }
  }
  maison.sort((a, b) => rangAdresse(a) - rangAdresse(b));
  return { maison, tailscale };
}

// ---------- Les clés des appareils ----------
// Une clé longue (256 bits) par appareil, donnée une seule fois à l'ajout ; ce PC n'en garde que l'empreinte
const nouvelleCleAppareil = (aleatoire = crypto.randomBytes) => aleatoire(32).toString('base64url');
const empreinteCle = (cle) => crypto.createHash('sha256').update(String(cle || '')).digest('hex');
function memeTexte(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
// Le code d'ajout : 6 chiffres, sans biais
const nouveauCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
const normaliserCode = (code) => String(code || '').replace(/\D/g, '');
// Le nom donné par l'appareil : du texte simple, court
const nomPropre = (nom, defaut) => String(nom || '').replace(/[^\p{L}\p{N} ._'-]/gu, '').trim().slice(0, 40) || defaut;

// Les appareils autorisés et l'ajout en cours. lire / ecrire : la liste enregistrée [{ id, nom, cle (empreinte),
// ajoute, vu }] ; ce module ne voit jamais de clé en clair, sauf au moment de la créer pour la donner.
function creerGestionAppareils({ lire, ecrire, maintenant = Date.now } = {}) {
  let ajout = null; // { code, fin, essais }
  const vusRecents = new Map();
  const liste = () => (Array.isArray(lire()) ? lire() : []);
  const enCours = () => {
    if (ajout && maintenant() > ajout.fin) ajout = null;
    return ajout;
  };
  return {
    appareils: () => liste().map(({ id, nom, ajoute, vu }) => ({ id, nom, ajoute, vu })),
    verifier(cle) {
      if (!cle) return null;
      const e = empreinteCle(cle);
      let trouve = null;
      for (const a of liste()) if (memeTexte(e, a.cle)) trouve = a; // toutes comparées, en temps constant
      if (!trouve) return null;
      // « Vu » enregistré au plus une fois toutes les 10 minutes
      if (maintenant() - (vusRecents.get(trouve.id) || 0) > 10 * 60 * 1000) {
        vusRecents.set(trouve.id, maintenant());
        ecrire(liste().map((a) => (a.id === trouve.id ? { ...a, vu: maintenant() } : a)));
      }
      return { id: trouve.id, nom: trouve.nom };
    },
    ouvrirAjout() {
      ajout = { code: nouveauCode(), fin: maintenant() + DUREE_CODE, essais: 0 };
      return { code: ajout.code, fin: ajout.fin };
    },
    ajoutEnCours: () => (enCours() ? { code: ajout.code, fin: ajout.fin } : null),
    fermerAjout() { ajout = null; },
    // L'appareil donne le code : une clé neuve, ou un refus (« aucun » ajout en cours, « mauvais » code, « ferme » :
    // trop d'essais, l'ajout est annulé)
    appairer(code, nom) {
      if (!enCours()) return { ok: false, raison: 'aucun' };
      if (!memeTexte(normaliserCode(code), ajout.code)) {
        ajout.essais++;
        if (ajout.essais >= ESSAIS_CODE) { ajout = null; return { ok: false, raison: 'ferme' }; }
        return { ok: false, raison: 'mauvais' };
      }
      ajout = null; // un code ne sert qu'une fois
      const cle = nouvelleCleAppareil();
      const appareil = { id: crypto.randomUUID(), nom: nomPropre(nom, 'Appareil'), cle: empreinteCle(cle), ajoute: maintenant(), vu: maintenant() };
      ecrire([...liste(), appareil]);
      return { ok: true, cle, id: appareil.id };
    },
    retirer(id) { ecrire(liste().filter((a) => a.id !== id)); },
  };
}

// ---------- Le serveur ----------
// Ce qu'un appareil peut demander à Ollama, borné : contexte et durée de chargement
function borner(json) {
  if (json.options && typeof json.options === 'object') {
    const ctx = Number(json.options.num_ctx);
    if (Number.isFinite(ctx) && ctx > MAX_CONTEXTE) json.options.num_ctx = MAX_CONTEXTE;
  }
  if (json.keep_alive !== undefined && !dureeAcceptable(json.keep_alive)) json.keep_alive = '30m';
  return json;
}
// keep_alive : un nombre de secondes, ou « 5m », « 30s », « 1h »… ; jamais négatif (= pour toujours) ni plus de 30 min
function dureeAcceptable(v) {
  if (typeof v === 'number') return v >= 0 && v * 1000 <= MAX_GARDE_MS;
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(String(v).trim());
  if (!m) return false;
  const facteur = { ms: 1, s: 1000, m: 60000, h: 3600000 }[m[2] || 's'];
  return Number(m[1]) * facteur <= MAX_GARDE_MS;
}

// idPartage : tiré du certificat, il permet au portable de retrouver ce PC quand son adresse change
const idDuCertificat = (certificat) => empreinteDe(certificat).slice(0, 16);

// certificat : { cle, certificat } (PEM) ; gestion : creerGestionAppareils ; ollama : l'adresse d'Ollama sur ce PC
// La fiche d'un modèle (/api/show) réduite à ce que l'app utilise : ses capacités, ses détails, son architecture
const champsFiche = (fiche) => ({ capabilities: fiche.capabilities, details: fiche.details, model_info: fiche.model_info });

function creerServeurPartage({ certificat, gestion, ollama = 'http://127.0.0.1:11434', nom = os.hostname(), adresses = () => adressesDuPC(), maintenant = Date.now } = {}) {
  const http = require('http');
  const essais = new Map(); // adresse -> [dates des mauvaises clés ou mauvais codes]
  const recents = (ip) => (essais.get(ip) || []).filter((t) => maintenant() - t < DUREE_ESSAIS);
  const bloquee = (ip) => recents(ip).length >= ESSAIS_MAX;
  const rater = (ip) => {
    essais.set(ip, [...recents(ip), maintenant()]);
    // La liste ne grossit pas sans fin : les adresses sans essai récent sont oubliées
    if (essais.size > 200) for (const [a] of essais) if (!recents(a).length) essais.delete(a);
  };
  let enCours = 0;
  const idPartage = idDuCertificat(certificat.certificat);
  const repondre = (res, code, objet) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(objet));
  };
  const erreur = (res, code, message) => repondre(res, code, { error: { message, type: 'catai_partage' } });
  const lireCorps = (req, res, suite) => {
    const morceaux = [];
    let taille = 0;
    req.on('data', (m) => {
      taille += m.length;
      if (taille > MAX_CORPS) { erreur(res, 413, 'Demande trop grosse.'); req.destroy(); return; }
      morceaux.push(m);
    });
    req.on('end', () => { if (!res.writableEnded) suite(Buffer.concat(morceaux)); });
  };

  const serveur = https.createServer({ key: certificat.cle, cert: certificat.certificat, minVersion: 'TLSv1.2' }, (req, res) => {
    const ip = sansPrefixe(req.socket.remoteAddress);
    if (!origineAcceptee(ip, req.socket.localAddress)) return erreur(res, 403, "Cat Ai ne partage sa carte graphique qu'avec le réseau de la maison ou Tailscale.");
    const chemin = (req.url || '').split('?')[0];
    // « Es-tu un Cat Ai qui partage ? » : sans clé, pour la recherche ; ni nom de PC ni nom de personne
    if (req.method === 'GET' && chemin === '/catai') return repondre(res, 200, { catai: 2, id: idPartage });
    if (bloquee(ip)) return erreur(res, 429, 'Trop d’essais ratés : réessaie dans quelques minutes.');

    // Ajout d'un appareil avec le code à 6 chiffres affiché sur ce PC
    if (req.method === 'POST' && chemin === '/catai/appairer') {
      return lireCorps(req, res, (corps) => {
        let demande;
        try { demande = JSON.parse(corps.toString('utf8') || '{}'); } catch { return erreur(res, 400, 'Demande illisible.'); }
        const r = gestion.appairer(demande.code, demande.nom);
        if (r.ok) return repondre(res, 200, { cle: r.cle, id: idPartage, nom: nomPropre(nom, 'PC') });
        if (r.raison === 'aucun') return erreur(res, 409, "Ce PC n'attend pas d'appareil : clique sur « Ajouter un appareil » sur lui.");
        rater(ip);
        return erreur(res, 403, r.raison === 'ferme' ? 'Trop de mauvais codes : relance « Ajouter un appareil » sur l’autre PC.' : 'Code refusé : vérifie le code affiché sur l’autre PC.');
      });
    }

    const cle = (/^Bearer\s+(.+)$/i.exec(req.headers.authorization || '') || [])[1];
    const appareil = gestion.verifier(cle);
    if (!appareil) {
      rater(ip);
      return erreur(res, 401, 'Cet appareil n’est plus autorisé : ajoute-le à nouveau avec un code.');
    }
    essais.delete(ip);
    // Les adresses de ce PC (maison, Tailscale), pour un appareil ajouté : il le retrouvera loin de chez toi
    if (req.method === 'GET' && chemin === '/catai/adresses') return repondre(res, 200, adresses());
    if (!ROUTES.has(`${req.method} ${chemin}`)) return erreur(res, 404, "Cette fonction d'Ollama n'est pas partagée.");
    if (enCours >= MAX_EN_COURS) return erreur(res, 503, 'Le PC qui partage est déjà occupé par plusieurs réponses : réessaie dans un instant.');
    enCours++;
    let fini = false;
    const liberer = () => { if (!fini) { fini = true; enCours--; } };
    res.on('close', liberer);

    lireCorps(req, res, (brut) => {
      let corps = brut;
      if (req.method === 'POST') {
        let json;
        try { json = JSON.parse(corps.toString('utf8') || '{}'); } catch { return erreur(res, 400, 'Demande illisible.'); }
        if (typeof json.model !== 'string' || !json.model) return erreur(res, 400, 'Modèle manquant.');
        // Pas de réflexion silencieuse par /v1, sauf si le portable la demande
        if (chemin.startsWith('/v1/') && json.reasoning_effort === undefined) json.reasoning_effort = 'none';
        corps = Buffer.from(JSON.stringify(borner(json)));
      }
      const amont = http.request(new URL(chemin, ollama), {
        method: req.method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': corps.length },
      }, (reponse) => {
        if (chemin === '/api/show' && reponse.statusCode === 200) {
          let texte = '';
          reponse.setEncoding('utf8');
          reponse.on('data', (m) => { texte += m; });
          reponse.on('end', () => {
            try { repondre(res, 200, champsFiche(JSON.parse(texte))); } catch { erreur(res, 502, "Réponse illisible d'Ollama."); }
          });
          return;
        }
        res.writeHead(reponse.statusCode || 502, { 'Content-Type': reponse.headers['content-type'] || 'application/json', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
        reponse.pipe(res);
      });
      amont.on('error', () => { if (!res.headersSent) erreur(res, 502, "Ollama ne répond pas sur le PC qui partage sa carte graphique."); else res.end(); });
      // Le portable arrête la réponse (Ctrl+C, carré stop) : Ollama arrête aussi
      res.on('close', () => { if (!res.writableFinished) amont.destroy(); });
      amont.end(corps);
    });
  });
  serveur.maxConnections = 64;
  serveur.headersTimeout = 15_000;
  return serveur;
}

// ---------- La recherche sur le Wi-Fi ----------
// Côté PC fixe : répond « je suis là » aux PC du réseau privé qui cherchent
function creerReponseRecherche({ id, port = PORT_PARTAGE, portRecherche = PORT_RECHERCHE } = {}) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  socket.on('message', (message, rinfo) => {
    if (message.toString() !== QUESTION_RECHERCHE || !adressePrivee(rinfo.address)) return;
    socket.send(JSON.stringify({ catai: 2, id, port }), rinfo.port, rinfo.address);
  });
  socket.on('error', () => {});
  socket.bind(portRecherche);
  return socket;
}

// Les adresses de diffusion de chaque réseau de ce PC (en plus de 255.255.255.255, que certains réseaux bloquent)
function adressesDiffusion(interfaces = os.networkInterfaces()) {
  const liste = new Set(['255.255.255.255']);
  for (const tout of Object.values(interfaces)) {
    for (const a of tout || []) {
      const ip = ipv4(a.address);
      const masque = ipv4(a.netmask);
      if (!ip || !masque || a.internal || (a.family !== 'IPv4' && a.family !== 4)) continue;
      liste.add(ip.map((o, i) => (o & masque[i]) | (~masque[i] & 255)).join('.'));
    }
  }
  return [...liste];
}

const idValide = (id) => /^[0-9a-f]{16}$/.test(String(id || ''));

// Côté portable : cherche les PC qui partagent leur carte graphique, pendant duree ms
function chercherPartages({ duree = 1500, cibles = adressesDiffusion(), portRecherche = PORT_RECHERCHE } = {}) {
  return new Promise((resoudre) => {
    const trouves = new Map();
    const socket = dgram.createSocket('udp4');
    const finir = () => {
      try { socket.close(); } catch { /* déjà fermé */ }
      resoudre([...trouves.values()]);
    };
    socket.on('error', finir);
    socket.on('message', (message, rinfo) => {
      try {
        const r = JSON.parse(message.toString());
        if (r.catai !== 2 || !idValide(r.id) || !adressePrivee(rinfo.address)) return;
        trouves.set(rinfo.address, { id: r.id, adresse: rinfo.address, port: Number(r.port) || PORT_PARTAGE });
      } catch { /* pas une réponse de Cat Ai */ }
    });
    socket.bind(0, () => {
      socket.setBroadcast(true);
      const question = Buffer.from(QUESTION_RECHERCHE);
      for (const cible of cibles) socket.send(question, portRecherche, cible, () => {});
      setTimeout(finir, duree);
    });
  });
}

// ---------- La recherche quand le Wi-Fi bloque les messages à tout le réseau ----------
// Les adresses voisines de ce PC (les 254 du même /24) : la box de la maison n'en donne presque jamais d'autres
function voisins(interfaces = os.networkInterfaces()) {
  const liste = new Set();
  for (const ip of adressesDuPC(interfaces).maison) {
    const p = ipv4(ip);
    for (let n = 1; n < 255; n++) if (n !== p[3]) liste.add(`${p[0]}.${p[1]}.${p[2]}.${n}`);
  }
  return [...liste];
}

// Les PC de Tailscale (« tailscale status --json »), en ligne, sauf celui-ci
function pcTailscale({ executer = require('child_process').execFile } = {}) {
  return new Promise((resoudre) => {
    executer('tailscale', ['status', '--json'], { timeout: 4000, windowsHide: true, encoding: 'utf8' }, (err, sortie) => {
      if (err) return resoudre([]);
      try {
        const etat = JSON.parse(sortie);
        resoudre(Object.values(etat.Peer || {}).filter((p) => p.Online !== false)
          .map((p) => (p.TailscaleIPs || []).find((ip) => estTailscale(ip))).filter(Boolean));
      } catch { resoudre([]); }
    });
  });
}

// GET /catai sur une adresse, sans vérifier le certificat (on ne fait que lire l'identifiant, rien n'est envoyé) :
// { id, adresse, port, empreinte, certificat } si c'est un Cat Ai qui partage, et que l'identifiant annoncé est bien
// celui de son certificat. Sinon une erreur.
function lireCatai(adresse, { port = PORT_PARTAGE, delai = 800 } = {}) {
  return new Promise((ok, ko) => {
    if (!adressePrivee(adresse)) return ko(new Error('adresse hors du réseau privé'));
    const req = https.request({ host: adresse, port, path: '/catai', method: 'GET', rejectUnauthorized: false, timeout: delai, agent: false }, (res) => {
      const brut = res.socket.getPeerCertificate?.()?.raw;
      let texte = '';
      res.setEncoding('utf8');
      res.on('data', (m) => { texte += m; if (texte.length > 2000) req.destroy(); });
      res.on('end', () => {
        try {
          const r = JSON.parse(texte);
          if (r.catai !== 2 || !idValide(r.id) || !brut) return ko(new Error('pas un Cat Ai'));
          const empreinte = empreinteDe(brut);
          if (empreinte.slice(0, 16) !== r.id) return ko(new Error('identifiant qui ne correspond pas au certificat'));
          ok({ id: r.id, adresse, port, empreinte, certificat: enPem(brut) });
        } catch (e) { ko(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('pas de réponse')));
    req.on('error', ko);
    req.end();
  });
}

// Essaie /catai sur chaque adresse (64 à la fois, délai court) : les PC qui partagent répondent leur identifiant.
// Une connexion TCP sortante passe là où la réponse UDP est bloquée.
async function sonder(adresses, { port = PORT_PARTAGE, delai = 800, enParallele = 64, lire = lireCatai } = {}) {
  const trouves = [];
  const file = [...new Set(adresses)].filter(adressePrivee);
  const ouvrier = async () => {
    while (file.length) {
      const adresse = file.shift();
      try { const r = await lire(adresse, { port, delai }); trouves.push({ id: r.id, adresse, port }); } catch { /* rien à cette adresse */ }
    }
  };
  await Promise.all(Array.from({ length: enParallele }, ouvrier));
  return trouves;
}

// Tout à la fois : le message UDP, les voisins du Wi-Fi, les PC de Tailscale. Un résultat par PC (par identifiant),
// la meilleure adresse : la maison avant Tailscale.
async function chercherPartout({ exclure = new Set(), chercherUdp = chercherPartages, listeVoisins = voisins, tailscale = pcTailscale, sonde = sonder } = {}) {
  const [udp, wifi, ts] = await Promise.all([
    chercherUdp().catch(() => []),
    sonde(listeVoisins()),
    tailscale().then((ips) => sonde(ips, { delai: 2500 })),
  ]);
  const parId = new Map();
  for (const p of [...udp, ...wifi, ...ts].filter((x) => !exclure.has(x.adresse)).sort((a, b) => rangAdresse(a.adresse) - rangAdresse(b.adresse))) {
    if (!parId.has(p.id)) parId.set(p.id, p);
  }
  return [...parId.values()];
}

module.exports = {
  PORT_PARTAGE, PORT_RECHERCHE, QUESTION_RECHERCHE, ROUTES, MAX_EN_COURS, MAX_CONTEXTE, DUREE_CODE, ESSAIS_CODE,
  adressePrivee, estTailscale, origineAcceptee, champsFiche, adressesDuPC, rangAdresse, nouvelleCleAppareil, empreinteCle, memeTexte, nouveauCode, nomPropre,
  creerGestionAppareils, borner, dureeAcceptable, idDuCertificat, creerServeurPartage, creerReponseRecherche,
  adressesDiffusion, chercherPartages, voisins, pcTailscale, lireCatai, sonder, chercherPartout,
};
