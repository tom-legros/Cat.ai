// Génère l'icône en pixel art à partir du sprite du chat : icone.png (256 px) et icone-pixel.ico.
// Chaque taille est dessinée avec un nombre entier de pixels par case : aucun flou, des pixels nets.
// Usage : node outils/generer-icone.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Même sprite que chat.js — k : pelage, i : oreille, e : œil, n : nez, r : poitrail
const SPRITE = [
  '...k.........k......',
  '...kk.......kk......',
  '...kik.....kik......',
  '..kkikkkkkkkikk.....',
  '..kkkkkkkkkkkkk.....',
  '..kkeeekkkeeekk.....',
  '..kkeeekkkeeekk.....',
  '.kkkkkkknkkkkkkk....',
  '..kkkkkkkkkkkkk.....',
  '...kkkkkkkkkkk......',
  '....kkkkkkkkk.......',
  '...kkkkkkkkkkk......',
  '...kkkkkkkkkkk......',
  '..kkkkkkkkkkkkk.....',
  '.kkkkkkkkkkkkkkk....',
  '.kkkkkkkrkkkkkkk....',
  '.kkkkkkkrkkkkkkk....',
  '.kkkkkkkrkkkkkkk....',
  '.....kkk.kkk........',
];
const QUEUE = [[17, 16], [17, 17], [16, 17], [16, 18], [15, 18], [14, 18], [13, 18], [12, 18], [11, 17]];

// Couleurs de style.css ; le contour est un peu plus clair que dans l'app pour ressortir sur le Bureau
const COULEURS = {
  k: [10, 10, 10], i: [51, 51, 51], n: [61, 61, 61], r: [42, 42, 42],
  contour: [106, 106, 106], ombre: [38, 38, 38],
  oeil: [232, 197, 71], pupille: [10, 10, 10],
};

// Grille finale 20 × 19 : une couleur RGB (ou null) par case
function grilleCouleurs() {
  const g = SPRITE.map((l) => l.split(''));
  QUEUE.forEach(([l, c]) => (g[l][c] = 'k'));
  const plein = (l, c) => (g[l]?.[c] ?? '.') !== '.';
  return g.map((ligne, l) => ligne.map((ch, c) => {
    if (ch === '.') return null;
    if (ch === 'e') return (c === 5 || c === 11) ? COULEURS.pupille : COULEURS.oeil; // pupilles au centre
    if (ch === 'k') {
      if (!plein(l - 1, c) || !plein(l, c - 1)) return COULEURS.contour; // bords éclairés
      if (!plein(l, c + 1)) return COULEURS.ombre;                       // bord droit
    }
    return COULEURS[ch];
  }));
}

// Dessine le sprite dans un carré de `taille` px, centré, avec un nombre entier de px par case
function dessiner(taille) {
  const grille = grilleCouleurs();
  const lignes = grille.length;
  const colonnes = grille[0].length;
  const cote = Math.max(1, Math.floor(taille / colonnes));
  const x0 = Math.floor((taille - colonnes * cote) / 2);
  const y0 = Math.floor((taille - lignes * cote) / 2);
  const px = Buffer.alloc(taille * taille * 4); // transparent par défaut
  grille.forEach((ligne, l) => ligne.forEach((rgb, c) => {
    if (!rgb) return;
    for (let y = 0; y < cote; y++) for (let x = 0; x < cote; x++) {
      const i = ((y0 + l * cote + y) * taille + x0 + c * cote + x) * 4;
      px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; px[i + 3] = 255;
    }
  }));
  return png(taille, px);
}

// Encodage PNG minimal (RGBA 8 bits)
const tableCrc = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = tableCrc[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function bloc(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
}
function png(taille, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(taille, 0); ihdr.writeUInt32BE(taille, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const brut = Buffer.alloc(taille * (taille * 4 + 1));
  for (let y = 0; y < taille; y++) px.copy(brut, y * (taille * 4 + 1) + 1, y * taille * 4, (y + 1) * taille * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc('IHDR', ihdr), bloc('IDAT', zlib.deflateSync(brut, { level: 9 })), bloc('IEND', Buffer.alloc(0)),
  ]);
}

// Un .ico peut contenir directement des PNG, un par taille
function ico(images) {
  const entete = Buffer.alloc(6);
  entete.writeUInt16LE(1, 2);
  entete.writeUInt16LE(images.length, 4);
  let position = 6 + 16 * images.length;
  const entrees = images.map(({ taille, data }) => {
    const e = Buffer.alloc(16);
    e[0] = e[1] = taille === 256 ? 0 : taille; // 0 veut dire 256
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(position, 12);
    position += data.length;
    return e;
  });
  return Buffer.concat([entete, ...entrees, ...images.map((i) => i.data)]);
}

// Tailles multiples de 20 (largeur du sprite) pour remplir au mieux, plus les tailles standard de Windows
const TAILLES = [256, 200, 160, 128, 100, 80, 64, 60, 48, 40, 32, 24, 20, 16];
const images = TAILLES.map((taille) => ({ taille, data: dessiner(taille) }));
const dossier = path.join(__dirname, '..');
fs.writeFileSync(path.join(dossier, 'icone.png'), images[0].data);
fs.writeFileSync(path.join(dossier, 'icone-pixel.ico'), ico(images));
console.log(`icone.png et icone-pixel.ico créés (${TAILLES.join(', ')} px)`);
