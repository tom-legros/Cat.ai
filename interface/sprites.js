/* ==========================================================
   Cat Ai — un chat en pixel art par agent.
   Le même chat noir que la mascotte (chat.js), en buste, avec l'accessoire de son rôle. Chaque sprite est une
   grille de 18 × 18 écrite en texte, facile à retoucher pixel par pixel :
     k pelage   i oreille   e œil   n nez   r collier (sa couleur distingue deux agents du même rôle)
     g doré     p papier    l monture, métal   v vert   s rose   c clavier   b verre de loupe
   spriteAgent(role, variante) renvoie le SVG. Les couleurs viennent de style.css : elles suivent le thème.
   ========================================================== */

const CHAT_BUSTE = [
    "..................",
    "..................",
    "..................",
    "...k.........k....",
    "...kk.......kk....",
    "...kik.....kik....",
    "..kkikkkkkkkikk...",
    "..kkkkkkkkkkkkk...",
    "..kkeeekkkeeekk...",
    "..kkeeekkkeeekk...",
    ".kkkkkkknkkkkkkk..",
    "..kkkkkkkkkkkkk...",
    "...kkkkkkkkkkk....",
    "....rrrrrrrrr.....",
    "...kkkkkkkkkkk....",
    "..kkkkkkkkkkkkk...",
    "..kkkkkkkkkkkkk...",
    "..kkkkkkkkkkkkk..."
];

// L'accessoire de chaque rôle : des lignes [ligne, colonne de départ, pixels] posées par-dessus le buste
const ACCESSOIRES = {
    // Une petite couronne dorée entre les oreilles
    chef: [[3, 6, "g.g.g"], [4, 6, "ggggg"], [5, 6, "ggggg"]],
    // Des lunettes carrées et un clavier
    codeur: [[7, 3, "lllll.lllll"], [8, 3, "l...lll...l"], [9, 3, "l...l.l...l"], [10, 3, "lllll.lllll"], [16, 3, "ccccccccccc"], [17, 3, "clclclclclc"]],
    // Un carnet à cases et un crayon
    auteur: [[11, 10, "pppppp"], [12, 10, "plplpp"], [13, 10, "pppppp"], [14, 10, "plplpp"], [15, 10, "pppppp"], [16, 10, "plplpp"], [17, 10, "pppppp"], [10, 16, "g"], [11, 15, "gg"], [12, 15, "g"]],
    // Une fiche avec une coche verte
    testeur: [[11, 10, "pppppp"], [12, 10, "pppppv"], [13, 10, "ppppvp"], [14, 10, "pvpvpp"], [15, 10, "ppvppp"], [16, 10, "pppppp"], [17, 10, "pppppp"]],
    // Une loupe
    logs: [[10, 11, ".lll."], [11, 11, "lbbbl"], [12, 11, "lbbbl"], [13, 11, "lbbbl"], [14, 11, ".lll."], [15, 15, "l"], [16, 16, "l"], [17, 17, "l"]],
    // Des lunettes rondes et une fiche annotée
    relecteur: [[7, 4, "lll...lll"], [8, 3, "l...lll...l"], [9, 3, "l...l.l...l"], [10, 4, "lll...lll"], [12, 0, "pppppp"], [13, 0, "psssps"], [14, 0, "pppppp"], [15, 0, "pssspp"], [16, 0, "pppppp"], [17, 0, "pppppp"]]
};

const ROLES_SPRITE = Object.keys(ACCESSOIRES);
const VARIANTES = 4; // couleurs de collier, pour distinguer plusieurs agents du même rôle

// La grille d'un rôle : le buste, l'accessoire par-dessus (un point laisse voir le chat), puis un contour clair
// autour du pelage, sans lequel un chat noir disparaît sur un fond sombre.
function grilleAgent(role) {
    const grille = CHAT_BUSTE.map((ligne) => [...ligne]);
    for (const [ligne, colonne, pixels] of ACCESSOIRES[role] || []) {
        [...pixels].forEach((p, i) => { if (p !== "." && grille[ligne]?.[colonne + i] !== undefined) grille[ligne][colonne + i] = p; });
    }
    const pelage = (l, c) => ["k", "i", "n", "r"].includes(grille[l]?.[c]);
    return grille.map((ligne, l) => ligne.map((p, c) => (p === "." && (pelage(l - 1, c) || pelage(l + 1, c) || pelage(l, c - 1) || pelage(l, c + 1)) ? "o" : p)).join(""));
}

// Un rectangle par suite de pixels de la même couleur : moins d'éléments, même dessin
function spriteAgent(role, variante = 0) {
    const lignes = grilleAgent(ACCESSOIRES[role] ? role : "codeur");
    let rects = "";
    lignes.forEach((ligne, y) => {
        for (const m of ligne.matchAll(/([a-z])\1*/g)) rects += `<rect class="px-${m[1]}" x="${m.index}" y="${y}" width="${m[0].length}" height="1"/>`;
    });
    return `<svg class="sprite sprite--v${Math.abs(variante) % VARIANTES}" viewBox="0 0 18 18" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

// Pour les tests
if (typeof module !== "undefined") module.exports = { CHAT_BUSTE, ACCESSOIRES, ROLES_SPRITE, VARIANTES, grilleAgent, spriteAgent };
