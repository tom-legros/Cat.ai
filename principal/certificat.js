// Le certificat du PC qui partage sa carte graphique : la connexion entre les deux PC passe en HTTPS.
// Il n'est signé par personne (autosigné) : le portable retient son empreinte la première fois (quand on tape le
// code d'ajout) et refuse ensuite tout autre certificat. Un faux PC sur le Wi-Fi ne peut donc pas se faire passer
// pour le vrai, ni lire les messages.
// Node sait créer une paire de clés mais pas un certificat : on l'écrit ici en DER (ASN.1), clé ECDSA P-256.
const crypto = require('crypto');

// ---------- DER : longueur, puis les quelques types utiles ----------
function longueur(n) {
  if (n < 0x80) return Buffer.from([n]);
  const octets = [];
  while (n > 0) { octets.unshift(n & 0xff); n >>= 8; }
  return Buffer.from([0x80 | octets.length, ...octets]);
}
const tlv = (tag, contenu) => Buffer.concat([Buffer.from([tag]), longueur(contenu.length), contenu]);
const sequence = (...parties) => tlv(0x30, Buffer.concat(parties));
const ensemble = (...parties) => tlv(0x31, Buffer.concat(parties));
function entier(octets) {
  let b = Buffer.from(octets);
  while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.subarray(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]); // toujours positif
  return tlv(0x02, b);
}
function oid(texte) {
  const n = texte.split('.').map(Number);
  const octets = [40 * n[0] + n[1]];
  for (const v of n.slice(2)) {
    const groupe = [v & 0x7f];
    for (let x = v >> 7; x > 0; x >>= 7) groupe.unshift((x & 0x7f) | 0x80);
    octets.push(...groupe);
  }
  return tlv(0x06, Buffer.from(octets));
}
const utf8 = (texte) => tlv(0x0c, Buffer.from(texte, 'utf8'));
// UTCTime (AAMMJJHHMMSSZ) jusqu'en 2049
const date = (d) => tlv(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));
const ECDSA_SHA256 = sequence(oid('1.2.840.10045.4.3.2'));
const nom = (texte) => sequence(ensemble(sequence(oid('2.5.4.3'), utf8(texte))));

function enPem(der) {
  return `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
}

// Un nouveau certificat autosigné, valable 20 ans : { cle (PEM PKCS#8), certificat (PEM), empreinte }
function creerCertificat({ maintenant = new Date(), nomCommun = 'Cat Ai' } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const debut = new Date(maintenant.getTime() - 24 * 3600 * 1000); // un jour de marge si l'horloge de l'autre PC retarde
  const fin = new Date(maintenant.getTime());
  fin.setUTCFullYear(fin.getUTCFullYear() + 20);
  const tbs = sequence(
    tlv(0xa0, entier([2])), // version 3
    entier(crypto.randomBytes(16)),
    ECDSA_SHA256,
    nom(nomCommun),
    sequence(date(debut), date(fin)),
    nom(nomCommun),
    publicKey.export({ type: 'spki', format: 'der' }),
  );
  const signature = crypto.sign('sha256', tbs, privateKey);
  const der = sequence(tbs, ECDSA_SHA256, tlv(0x03, Buffer.concat([Buffer.from([0]), signature])));
  return { cle: privateKey.export({ type: 'pkcs8', format: 'pem' }), certificat: enPem(der), empreinte: empreinteDe(der) };
}

// L'empreinte SHA-256 d'un certificat (PEM ou DER), en hexadécimal minuscule sans séparateur
function empreinteDe(certificat) {
  const der = Buffer.isBuffer(certificat) ? certificat : Buffer.from(String(certificat).replace(/-----[^-]+-----|\s/g, ''), 'base64');
  return crypto.createHash('sha256').update(der).digest('hex');
}

module.exports = { creerCertificat, empreinteDe, enPem };
