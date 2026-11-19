/* ==========================================================
   Cat Ai — icônes en pixel art, sur une grille de 8 × 8 comme le chat.
   Chaque icône est dessinée en texte : # = pixel allumé. icone(nom) renvoie le SVG.
   ========================================================== */

const PIXELS = {
    modeleQwen: ["...##...", "..####..", ".##..##.", "##....##", "##.#..##", ".##.###.", "..####..", ".....##."],
    modeleGemma: ["...##...", "...##...", "..####..", "########", "########", "..####..", "...##...", "...##..."],
    modeleDeepSeek: ["......#.", ".....###", ".#....#.", ".######.", "########", "#.#....#", ".######.", "........"],
    modeleOpenAI: ["..####..", ".##..##.", "##.##.##", "#.#..#.#", "#.#..#.#", "##.##.##", ".##..##.", "..####.."],
    copier: ["..######", "..#....#", "#####..#", "#...#..#", "#...####", "#...#...", "#...#...", "#####..."],
    corbeille: ["..####..", "########", "........", ".######.", ".#.#..#.", ".#.#..#.", ".#.#..#.", ".######."],
    relancer: ["..####..", ".#....#.", "#.....#.", "....####", "........", "#......#", ".#....#.", "..####.."],
    loupe: [".####...", "#....#..", "#....#..", "#....#..", ".####...", ".....#..", "......#.", ".......#"],
    plus: ["...##...", "...##...", "...##...", "########", "########", "...##...", "...##...", "...##..."],
    coeur: ["........", ".##..##.", "########", "########", ".######.", "..####..", "...##...", "........"],
    engrenage: ["...##...", ".######.", ".##..##.", "###..###", "###..###", ".##..##.", ".######.", "...##..."],
    ampoule: ["..####..", ".#....#.", ".#....#.", ".#....#.", "..#..#..", "...##...", "..####..", "...##..."],
    stylo: ["......##", ".....###", "....###.", "...###..", "..###...", ".###....", "##......", "#......."],
    livre: [".######.", ".#....#.", ".#.##.#.", ".#....#.", ".#.##.#.", ".#....#.", ".######.", "........"],
    code: ["........", "..#..#..", ".#....#.", "#......#", ".#....#.", "..#..#..", "........", "........"],
    envoi: ["...##...", "..####..", ".######.", "##.##.##", "...##...", "...##...", "...##...", "...##..."],
    stop: ["........", ".######.", ".######.", ".######.", ".######.", ".######.", ".######.", "........"],
    dossier: ["........", "###.....", "#######.", "#......#", "#......#", "#......#", "########", "........"],
    lunettes: ["........", "#......#", "###..###", "#.####.#", "#.#..#.#", "###..###", "........", "........"],
    etoile: ["...##...", "...##...", "########", ".######.", "..####..", ".##..##.", ".#....#.", "........"],
    chevron: ["........", "........", "##....##", ".##..##.", "..####..", "...##...", "........", "........"],
    pc: ["########", "#......#", "#......#", "#......#", "########", "...##...", ".######.", "........"],
    etincelle: ["...#..#.", "...#....", "..###...", "#######.", "..###...", "...#....", "...#....", "........"],
    eclair: ["....###.", "...###..", "..###...", ".######.", "...###..", "..###...", ".###....", ".#......"],
    route: ["##......", "##......", ".#......", ".####...", "....#...", "....####", "......##", "......##"],
    serveur: ["########", "#.#....#", "########", "........", "########", "#.#....#", "########", "........"],
    poids: ["..####..", ".#....#.", ".######.", "########", "########", "########", ".######.", "........"],
    puce: [".#.##.#.", "########", ".#....#.", "##....##", "##....##", ".#....#.", "########", ".#.##.#."],
    image: ["########", "#......#", "#.....##", "#....##.", "#..##..#", "#.##...#", "########", "........"],
    bulle: ["########", "#......#", "#......#", "#......#", "########", ".##.....", ".#......", "........"],
    agents: ["..####..", "..####..", "...##...", ".######.", ".#....#.", "###..###", "###..###", "........"],
    boite: ["..####..", ".######.", "###..###", "#.####.#", "#..##..#", "#..##..#", ".######.", "........"],
    couronne: ["........", "#..##..#", "##.##.##", "########", "########", "########", "........", "........"],
    marteau: [".#####..", ".######.", ".#####..", "...##...", "...##...", "...##...", "...##...", "........"],
    coche: ["........", ".......#", "......##", "#....##.", "##..##..", ".####...", "..##....", "........"],
    panneau: ["########", "#..#...#", "#..#...#", "#..#...#", "#..#...#", "#..#...#", "#..#...#", "########"],
    fleche: ["........", "....#...", "....##..", "#######.", "#######.", "....##..", "....#...", "........"]
};

/* Les icônes de l'interface : un trait fin et net sur une grille de 24 × 24, comme les apps pro.
   Le pixel art reste l'identité de Cat Ai (le chat, le logo, le titre de l'accueil) : PIXELS sert encore
   aux sprites et à ce qui n'a pas d'équivalent ici. Chaque valeur : le contenu du SVG. */
const LIGNES = {
    copier: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
    corbeille: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v5M14 11v5"/>',
    relancer: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
    loupe: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    coeur: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
    engrenage: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
    ampoule: '<path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z"/>',
    stylo: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 7l3 3"/>',
    livre: '<path d="M5 5a2 2 0 0 1 2-2h11v15H7a2 2 0 0 0-2 2z"/><path d="M5 20a2 2 0 0 0 2 1h11"/>',
    code: '<path d="M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5"/>',
    envoi: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>',
    dossier: '<path d="M4 7a2 2 0 0 1 2-2h3.5l2 2H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>',
    lunettes: '<path d="M3 9l9-4 9 4-9 4z"/><path d="M7 11v4c0 1.4 2.2 3 5 3s5-1.6 5-3v-4M21 9v5"/>',
    etoile: '<path d="M12 4l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.4l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    pc: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    etincelle: '<path d="M12 3.5l1.9 5 5 1.9-5 1.9-1.9 5-1.9-5-5-1.9 5-1.9z"/><path d="M18.5 16v4M16.5 18h4"/>',
    eclair: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
    route: '<path d="M6 20v-9a4 4 0 0 1 4-4h9"/><path d="M16 4l3 3-3 3"/>',
    serveur: '<rect x="4" y="4" width="16" height="7" rx="2"/><rect x="4" y="13" width="16" height="7" rx="2"/><path d="M8 7.5h.01M8 16.5h.01"/>',
    poids: '<path d="M6.5 9h11l2 11h-15z"/><path d="M10 9a2 2 0 1 1 4 0"/>',
    puce: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>',
    image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M20 16l-5-5-8.5 8"/>',
    bulle: '<path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>',
    agents: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3 3 0 0 1 0 5.6M17.5 14.3A5.5 5.5 0 0 1 20.5 19"/>',
    boite: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
    couronne: '<path d="M5 17l-1-9 5 4 3-6 3 6 5-4-1 9z"/><path d="M5 20h14"/>',
    marteau: '<path d="M14.5 4.5l5 5-2.5 2.5-5-5z"/><path d="M13.5 9.5L5 18l1 1 8.5-8.5"/>',
    coche: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    panneau: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    fleche: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    trombone: '<path d="M20 11.5l-7.6 7.6a5 5 0 0 1-7.1-7.1l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3"/>',
};
// Les modèles : la première lettre de leur famille, dans un carré arrondi (plus de logo pixel brut)
const MONOGRAMMES = { modeleQwen: "Q", modeleGemma: "G", modeleDeepSeek: "D", modeleOpenAI: "O", modeleMistral: "M", modeleBonsai: "B" };

// Un rectangle par suite de pixels sur une ligne : moins d'éléments, même dessin
function icone(nom, classe = "") {
    const fin = classe ? " " + classe : "";
    if (MONOGRAMMES[nom]) return `<svg class="icone icone-px icone-lettre${fin}" viewBox="0 0 24 24" aria-hidden="true"><text x="12" y="18.5" text-anchor="middle">${MONOGRAMMES[nom]}</text></svg>`;
    if (LIGNES[nom]) return `<svg class="icone icone-px icone-ligne${fin}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LIGNES[nom]}</svg>`;
    const lignes = PIXELS[nom] || PIXELS.puce;
    let rects = "";
    lignes.forEach((ligne, y) => {
        for (const m of ligne.matchAll(/#+/g)) rects += `<rect x="${m.index}" y="${y}" width="${m[0].length}" height="1"/>`;
    });
    return `<svg class="icone icone-px${classe ? " " + classe : ""}" viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

// Lettres pixel 5 × 7 pour le logo. motEnPixels renvoie null si une lettre manque (le logo garde alors le texte).
const LETTRES_PIXEL = {
    A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
    I: ["###", ".#.", ".#.", ".#.", ".#.", ".#.", "###"],
    T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
    " ": ["..", "..", "..", "..", "..", "..", ".."]
};

function motEnPixels(mot) {
    const lettres = [...String(mot).toUpperCase()].map((l) => LETTRES_PIXEL[l]);
    if (!lettres.length || lettres.some((l) => !l)) return null;
    let x = 0;
    let rects = "";
    for (const lettre of lettres) {
        lettre.forEach((ligne, y) => {
            for (const m of ligne.matchAll(/#+/g)) rects += `<rect x="${x + m.index}" y="${y}" width="${m[0].length}" height="1"/>`;
        });
        x += lettre[0].length + 1;
    }
    return `<svg class="logo__pixels" viewBox="0 0 ${x - 1} 7" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

// Pour les tests et le script qui écrit les icônes dans index.html
if (typeof module !== "undefined") module.exports = { PIXELS, LIGNES, MONOGRAMMES, icone, motEnPixels };
