// Réveiller l'autre PC (Wake-on-LAN) quand il dort et que le portable a besoin de sa carte graphique.
// - À la maison (même réseau que lui) : le portable envoie lui-même le « paquet magique » à tout le réseau.
// - Loin de chez soi : un appareil resté à la maison l'envoie (par exemple un serveur, joint par SSH, qui a la commande
//   wakeonlan) : ssh <machine> wakeonlan -i <diffusion> <MAC>. Le paquet magique ne traverse pas internet ni Tailscale.
// Rien n'est jamais construit à partir d'un texte libre : MAC, adresse et machine sont vérifiées, et la commande est
// lancée sans shell (les valeurs ne peuvent pas devenir des options ou d'autres commandes).
const dgram = require('dgram');
const { spawn } = require('child_process');

const MAC = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/;
const normaliserMac = (mac) => {
  const m = String(mac || '').trim().toLowerCase().replace(/-/g, ':');
  return MAC.test(m) && m !== '00:00:00:00:00:00' && m !== 'ff:ff:ff:ff:ff:ff' ? m : null;
};
const ipv4 = (ip) => {
  const p = String(ip || '').split('.').map(Number);
  return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? p : null;
};
// « machine » ou « utilisateur@machine » : lettres, chiffres, points, tirets ; jamais d'espace ni de tiret au début
const MACHINE = /^(?:[a-z_][a-z0-9_.-]{0,31}@)?[a-z0-9](?:[a-z0-9.-]{0,252})$/i;
const machineValide = (texte) => (MACHINE.test(String(texte || '').trim()) ? String(texte).trim() : null);

// L'adresse de diffusion d'un réseau : 192.168.1.20 / 255.255.255.0 → 192.168.1.255
function diffusion(ip, masque) {
  const a = ipv4(ip);
  const m = ipv4(masque);
  if (!a || !m) return null;
  return a.map((o, i) => (o & m[i]) | (~m[i] & 255)).join('.');
}
// Ce PC est-il sur le même réseau que l'adresse de diffusion de l'autre PC ?
function memeReseau(interfaces, diffusionCible) {
  for (const liste of Object.values(interfaces || {})) {
    for (const a of liste || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal && diffusion(a.address, a.netmask) === diffusionCible) return true;
    }
  }
  return false;
}

// Côté PC qui partage : de quoi le réveiller, pour son adresse de la maison (la carte qui a cette adresse)
function infosReveil(interfaces, adresseMaison) {
  for (const liste of Object.values(interfaces || {})) {
    for (const a of liste || []) {
      if (a.address !== adresseMaison) continue;
      const mac = normaliserMac(a.mac);
      const diff = diffusion(a.address, a.netmask);
      return mac && diff ? { mac, diffusion: diff } : null;
    }
  }
  return null;
}

// Le paquet magique : 6 fois FF, puis 16 fois l'adresse MAC
function paquetMagique(mac) {
  const m = normaliserMac(mac);
  if (!m) throw new Error('Adresse MAC invalide.');
  const octets = Buffer.from(m.split(':').map((h) => parseInt(h, 16)));
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(octets)]);
}

// Envoi direct, à la maison
function envoyerPaquet({ mac, diffusion: cible, port = 9, creerSocket = () => dgram.createSocket('udp4') }) {
  return new Promise((ok, ko) => {
    const s = creerSocket();
    s.on('error', (e) => { try { s.close(); } catch {} ko(e); });
    s.bind(0, () => {
      s.setBroadcast(true);
      s.send(paquetMagique(mac), port, cible, (e) => { try { s.close(); } catch {} return e ? ko(e) : ok(); });
    });
  });
}

// Les arguments de ssh (sans shell) pour faire réveiller le PC par une machine de la maison.
// cle : la clé de réveil de Cat Ai (sans phrase de passe, bridée sur le serveur), utilisée seule.
function argumentsSsh({ machine, mac, diffusion: cible, cle }) {
  const m = machineValide(machine);
  const adresseMac = normaliserMac(mac);
  if (!m || !adresseMac || !ipv4(cible)) return null;
  return ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', ...(cle ? ['-i', cle, '-o', 'IdentitiesOnly=yes'] : []), m, 'wakeonlan', '-i', cible, adresseMac];
}

// ---------- La clé de réveil ----------
// La clé SSH de l'utilisateur a souvent une phrase de passe : Cat Ai, sans terminal, ne peut pas la taper (et ne la
// garde pas). Il a donc sa propre clé, sans phrase, et le serveur la bride à UNE commande : wakeonlan pour ce PC
// (« restrict » : ni shell, ni tunnel, ni transfert). Volée, elle ne permet que d'allumer le PC.
const CLE_PUBLIQUE = /^ssh-ed25519 [A-Za-z0-9+/]{40,}={0,2}( [\w.@-]{1,64})?$/;
function ligneServeur({ clePublique, mac, diffusion: cible }) {
  const cle = String(clePublique || '').trim();
  const adresseMac = normaliserMac(mac);
  if (!CLE_PUBLIQUE.test(cle) || !adresseMac || !ipv4(cible)) return null;
  return `command="wakeonlan -i ${cible} ${adresseMac}",restrict ${cle}`;
}
// Crée la clé si besoin (ssh-keygen, sans phrase de passe) et renvoie la clé publique
function preparerCle({ fichier, executer = require('child_process').execFile }) {
  const fs = require('fs');
  const lire = () => fs.readFileSync(`${fichier}.pub`, 'utf8').trim();
  if (fs.existsSync(fichier) && fs.existsSync(`${fichier}.pub`)) return Promise.resolve(lire());
  return new Promise((ok, ko) => {
    executer('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'cat-ai-reveil', '-f', fichier], { windowsHide: true, timeout: 15000 }, (err) => {
      if (err) return ko(new Error(`ssh-keygen n'a pas pu créer la clé de réveil : ${err.message}`));
      try { ok(lire()); } catch (e) { ko(e); }
    });
  });
}

function reveillerParSsh({ machine, mac, diffusion: cible, cle, lancer = spawn }) {
  const args = argumentsSsh({ machine, mac, diffusion: cible, cle });
  if (!args) return Promise.reject(new Error('Réglage de réveil invalide.'));
  return new Promise((ok, ko) => {
    const p = lancer('ssh', args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let erreur = '';
    p.stderr?.on('data', (d) => { erreur += d; });
    const minuterie = setTimeout(() => p.kill(), 20000);
    p.on('error', (e) => { clearTimeout(minuterie); ko(e); });
    p.on('close', (code) => {
      clearTimeout(minuterie);
      if (code === 0) ok(); else ko(new Error(erreur.trim().split('\n').at(-1) || `ssh a terminé avec le code ${code}`));
    });
  });
}

// Réveiller : directement si on est sur le même réseau, sinon par la machine de la maison si elle est réglée.
// Renvoie la façon utilisée (« direct » ou « ssh »), ou une erreur.
async function reveiller({ reveil, machine, cle, interfaces = require('os').networkInterfaces(), envoyer = envoyerPaquet, parSsh = reveillerParSsh }) {
  if (!reveil?.mac || !reveil?.diffusion) throw new Error("L'autre PC n'a pas donné de quoi le réveiller.");
  if (memeReseau(interfaces, reveil.diffusion)) { await envoyer(reveil); return 'direct'; }
  if (!machineValide(machine)) throw new Error('Loin de chez toi, il faut un appareil à la maison pour réveiller ton PC (Réglages › Cerveau › Autre PC).');
  await parSsh({ machine, cle, ...reveil });
  return 'ssh';
}

module.exports = { normaliserMac, machineValide, diffusion, memeReseau, infosReveil, paquetMagique, envoyerPaquet, argumentsSsh, ligneServeur, preparerCle, reveillerParSsh, reveiller };
