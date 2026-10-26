// Dessine les images de l'installateur Windows (NSIS) dans la DA de l'app : fond nuit, chat en pixels, yeux jaunes.
//   node outils/generer-installateur.js
// Crée build/installateur-cote.bmp (164 × 314, pages de début et de fin) et build/installateur-entete.bmp (150 × 57).
const fs = require('fs');
const path = require('path');

// Le sprite du chat, repris de chat.js (même dessin que dans l'app)
const SPRITE = [
  '...k.........k......', '...kk.......kk......', '...kik.....kik......', '..kkikkkkkkkikk.....',
  '..kkkkkkkkkkkkk.....', '..kkeeekkkeeekk.....', '..kkeeekkkeeekk.....', '.kkkkkkknkkkkkkk....',
  '..kkkkkkkkkkkkk.....', '...kkkkkkkkkkk......', '....kkkkkkkkk.......', '...kkkkkkkkkkk......',
  '...kkkkkkkkkkk......', '..kkkkkkkkkkkkk.....', '.kkkkkkkkkkkkkkk....', '.kkkkkkkrkkkkkkk....',
  '.kkkkkkkrkkkkkkk....', '.kkkkkkkrkkkkkkk....', '.....kkk.kkk........',
];
const QUEUE = [[17, 16], [17, 17], [16, 17], [16, 18], [15, 18], [14, 18], [13, 18], [12, 18], [11, 17]];

// Couleurs de style.css
const C = {
  fond: [5, 5, 5], pelage: [16, 16, 16], contour: [74, 74, 74], oreille: [51, 51, 51], nez: [61, 61, 61],
  poitrail: [42, 42, 42], oeil: [232, 197, 71], lueur: [24, 20, 8], texte: [232, 232, 232], gris: [133, 133, 133], etoile: [90, 90, 90],
};

// Petite police pixel 5 × 7 pour « CAT AI » et la phrase du bas
const LETTRES = {
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  ' ': ['...', '...', '...', '...', '...', '...', '...'],
};

function image(largeur, hauteur) {
  const px = Array.from({ length: hauteur }, () => Array.from({ length: largeur }, () => C.fond));
  const poser = (x, y, c) => { if (x >= 0 && y >= 0 && x < largeur && y < hauteur) px[y][x] = c; };
  const carre = (x, y, t, c) => { for (let j = 0; j < t; j++) for (let i = 0; i < t; i++) poser(x + i, y + j, c); };
  return { largeur, hauteur, px, poser, carre };
}

// Le chat à l'échelle e, coin haut gauche en (x0, y0), avec son contour et une lueur sous lui
function chat(img, x0, y0, e) {
  const grille = SPRITE.map((l) => [...l]);
  for (const [l, c] of QUEUE) grille[l][c] = 'k';
  const plein = (l, c) => grille[l]?.[c] && grille[l][c] !== '.';
  // Lueur jaune très douce sous les pattes
  for (let j = -1; j <= 1; j++) for (let i = -10; i <= 10; i++) {
    if ((i * i) / 100 + j * j <= 1) img.carre(x0 + (9 + i) * e, y0 + (19 + j) * e, e, C.lueur);
  }
  grille.forEach((ligne, l) => ligne.forEach((v, c) => {
    if (v === '.') {
      const bord = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dl, dc]) => plein(l + dl, c + dc));
      if (bord) img.carre(x0 + c * e, y0 + l * e, e, C.contour);
      return;
    }
    const couleur = { k: C.pelage, i: C.oreille, e: C.oeil, n: C.nez, r: C.poitrail }[v];
    img.carre(x0 + c * e, y0 + l * e, e, couleur);
  }));
}

function texte(img, mot, x0, y0, e, couleur) {
  let x = x0;
  for (const lettre of mot) {
    const motif = LETTRES[lettre];
    motif.forEach((ligne, j) => [...ligne].forEach((v, i) => { if (v === '#') img.carre(x + i * e, y0 + j * e, e, couleur); }));
    x += (motif[0].length + 1) * e;
  }
  return x;
}

function etoiles(img, liste) {
  for (const [x, y] of liste) img.carre(x, y, 2, C.etoile);
}

// BMP 24 bits, lignes de bas en haut, chaque ligne complétée à un multiple de 4 octets
function ecrireBmp(img, fichier) {
  const ligne = Math.ceil((img.largeur * 3) / 4) * 4;
  const taille = 54 + ligne * img.hauteur;
  const b = Buffer.alloc(taille);
  b.write('BM', 0);
  b.writeUInt32LE(taille, 2);
  b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(img.largeur, 18);
  b.writeInt32LE(img.hauteur, 22);
  b.writeUInt16LE(1, 26);
  b.writeUInt16LE(24, 28);
  b.writeUInt32LE(ligne * img.hauteur, 34);
  for (let y = 0; y < img.hauteur; y++) {
    const debut = 54 + (img.hauteur - 1 - y) * ligne;
    for (let x = 0; x < img.largeur; x++) {
      const [r, g, bl] = img.px[y][x];
      b[debut + x * 3] = bl;
      b[debut + x * 3 + 1] = g;
      b[debut + x * 3 + 2] = r;
    }
  }
  fs.writeFileSync(fichier, b);
}

const dossier = path.join(__dirname, '..', 'build');
fs.mkdirSync(dossier, { recursive: true });

// Côté : le grand chat au centre, « CAT AI » dessous, des étoiles
const cote = image(164, 314);
etoiles(cote, [[18, 22], [130, 14], [146, 60], [24, 92], [140, 128], [12, 170], [150, 210], [30, 262], [120, 290], [80, 40]]);
chat(cote, 22, 70, 6);
const largeurTitre = (5 + 1) * 3 * 3 + (3 + 1) * 3 + (5 + 1) * 3 + 3 * 3; // C A T ␣ A I
texte(cote, 'CAT AI', Math.round((164 - largeurTitre) / 2), 214, 3, C.texte);
cote.carre(78, 246, 2, C.oeil);
cote.carre(84, 246, 2, C.oeil);
ecrireBmp(cote, path.join(dossier, 'installateur-cote.bmp'));

// En-tête : petit chat à droite, « CAT AI » à gauche
const entete = image(150, 57);
etoiles(entete, [[60, 8], [96, 44], [8, 48]]);
texte(entete, 'CAT AI', 10, 22, 2, C.texte);
chat(entete, 100, 9, 2);
ecrireBmp(entete, path.join(dossier, 'installateur-entete.bmp'));

console.log('Images écrites dans', dossier);
