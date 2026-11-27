/* ==========================================================
   Cat Ai — la saisie : retrouver ses anciens messages avec les flèches, comme dans un terminal.
   Que des fonctions pures : elles ne touchent pas à la page.
   ========================================================== */

// Les messages déjà envoyés dans la discussion, du plus ancien au plus récent, sans doublons qui se suivent
function anciensMessages(messages) {
    const textes = (messages || []).filter((m) => m.role === "user").map((m) => String(m.affichage ?? m.content ?? "").trim()).filter(Boolean);
    return textes.filter((t, i) => t !== textes[i - 1]);
}

// Une flèche dans la saisie. etat : { position, brouillon } (position = anciens.length quand on est sur le brouillon).
// Renvoie le nouvel état et le texte à afficher, ou null si la flèche doit juste bouger le curseur.
function parcourirAnciens(anciens, etat, sens, texteActuel) {
    const position = Math.min(etat?.position ?? anciens.length, anciens.length);
    const suivante = position + sens;
    if (suivante < 0 || suivante > anciens.length) return null;
    // On quitte le brouillon : il est gardé pour y revenir avec la flèche du bas
    const brouillon = position === anciens.length ? texteActuel : etat.brouillon;
    return { position: suivante, brouillon, texte: suivante === anciens.length ? brouillon : anciens[suivante] };
}

if (typeof module !== "undefined") module.exports = { anciensMessages, parcourirAnciens };
