/* ==========================================================
   Le chat noir — calcul de la fenêtre avant / après (l'affichage reste dans renderer.js)
   ========================================================== */

// Différence ligne par ligne, calculée par jsdiff (algorithme de Myers, le même que git)
function difference(ancien, nouveau) {
    const lignes = [];
    let na = 0, nb = 0;
    for (const morceau of Diff.diffLines(ancien, nouveau)) {
        const textes = morceau.value.replace(/\n$/, "").split("\n");
        for (const t of textes) {
            if (morceau.added) lignes.push({ type: "ajout", t, nb: ++nb });
            else if (morceau.removed) lignes.push({ type: "retrait", t, na: ++na });
            else lignes.push({ type: "pareil", t, na: ++na, nb: ++nb });
        }
    }
    return lignes;
}
