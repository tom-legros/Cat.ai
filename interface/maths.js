/* ==========================================================
   Cat Ai — formules de maths écrites en LaTeX par le modèle ($$…$$, \[…\], $…$, \(…\))
   Elles sont mises de côté avant le Markdown (sinon les _ deviennent de l'italique), puis affichées par KaTeX
   (dans markdown.js). Fonction pure, testée dans tests/maths.test.js.
   ========================================================== */

// Repères d'une formule mise de côté : deux caractères invisibles de la zone « usage privé » d'Unicode,
// différents de ceux des étiquettes d'action (markdown.js)
const DEBUT_MATHS = "";
const FIN_MATHS = "";

// Renvoie { texte, formules } : le texte avec un repère à la place de chaque formule, et la liste des formules.
// Le code (blocs ``` et `code`) n'est jamais touché : un $ dans du shell ou du PHP reste un $.
function protegerMaths(src) {
    const formules = [];
    const garder = (tex, bloc) => `${DEBUT_MATHS}${formules.push({ tex: tex.trim(), bloc }) - 1}${FIN_MATHS}`;
    // Un repère écrit par le modèle lui-même ne doit pas pouvoir désigner une formule
    const morceaux = String(src).replace(/[]/g, "").split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/);
    const texte = morceaux.map((m, i) => (i % 2 ? m : m
        .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => garder(t, true))
        .replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => garder(t, true))
        .replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => garder(t, false))
        // $…$ dans une phrase : pas d'espace juste après le premier $ ni juste avant le second, et pas un prix
        // (« 5$ et 10$ », « 3 $ ») : le $ ouvrant ne suit ni une lettre ni un chiffre, le fermant n'est pas suivi d'un chiffre
        .replace(/(^|[^\\$\w])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (_, avant, t) => avant + garder(t, false))
    )).join("");
    return { texte, formules };
}

if (typeof module !== "undefined") module.exports = { DEBUT_MATHS, FIN_MATHS, protegerMaths };
