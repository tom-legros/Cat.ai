/* ==========================================================
   Cat Ai — la barre latérale : on règle sa largeur en tirant sa bordure, on la replie (Ctrl+B).
   Chargé après renderer.js. La largeur et l'état replié sont retenus d'une ouverture à l'autre.
   ========================================================== */

const LARGEUR_COTE = { min: 200, max: 420, normale: 272, pas: 16 };

// Une largeur toujours raisonnable : jamais plus de 40 % de la fenêtre, pour laisser la place à la discussion
function bornerLargeur(largeur, fenetre = window.innerWidth) {
    const max = Math.max(LARGEUR_COTE.min, Math.min(LARGEUR_COTE.max, Math.round(fenetre * 0.4)));
    const n = Number(largeur);
    if (!Number.isFinite(n)) return Math.min(LARGEUR_COTE.normale, max);
    return Math.min(max, Math.max(LARGEUR_COTE.min, Math.round(n)));
}

function lireRetenu(cle) {
    try { return localStorage.getItem(cle); } catch { return null; }
}
function retenir(cle, valeur) {
    try { localStorage.setItem(cle, String(valeur)); } catch {}
}

const cote = document.querySelector(".cote");
const poignee = document.querySelector("#cote-poignee");
const boutonReplier = document.querySelector("#cote-replier");
const boutonDeplier = document.querySelector("#cote-deplier");
let largeurVoulue = lireRetenu("largeurCote"); // null : la largeur prévue par la feuille de style

function appliquerLargeur() {
    if (largeurVoulue === null) {
        document.documentElement.style.removeProperty("--largeur-cote");
        poignee.setAttribute("aria-valuenow", String(Math.round(cote.getBoundingClientRect().width)));
        return;
    }
    const largeur = bornerLargeur(largeurVoulue);
    document.documentElement.style.setProperty("--largeur-cote", largeur + "px");
    poignee.setAttribute("aria-valuenow", String(largeur));
}

function changerLargeur(largeur) {
    largeurVoulue = bornerLargeur(largeur);
    appliquerLargeur();
    retenir("largeurCote", largeurVoulue);
}

function replier(oui) {
    document.body.classList.toggle("cote-repliee", oui);
    cote.toggleAttribute("inert", oui); // replié : la barre ne reçoit plus la tabulation
    boutonDeplier.hidden = !oui;
    retenir("coteRepliee", oui ? "1" : "0");
    (oui ? boutonDeplier : boutonReplier).focus({ preventScroll: true });
}

poignee.setAttribute("aria-valuemin", String(LARGEUR_COTE.min));
poignee.setAttribute("aria-valuemax", String(LARGEUR_COTE.max));
appliquerLargeur();
if (lireRetenu("coteRepliee") === "1") {
    document.body.classList.add("cote-repliee");
    cote.setAttribute("inert", "");
    boutonDeplier.hidden = false;
}
boutonReplier.innerHTML = icone("panneau");
boutonDeplier.innerHTML = icone("panneau");
boutonReplier.onclick = (e) => { e.stopPropagation(); replier(true); }; // le logo a son propre clic
boutonDeplier.onclick = () => replier(false);

// Tirer la bordure : la largeur suit la souris, sans animation pendant le geste
poignee.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    poignee.setPointerCapture(e.pointerId);
    document.body.classList.add("is-redimensionne");
    const depart = e.clientX;
    const largeurDepart = cote.getBoundingClientRect().width;
    const bouger = (ev) => {
        largeurVoulue = bornerLargeur(largeurDepart + ev.clientX - depart);
        appliquerLargeur();
    };
    const finir = () => {
        document.body.classList.remove("is-redimensionne");
        poignee.removeEventListener("pointermove", bouger);
        poignee.removeEventListener("pointerup", finir);
        poignee.removeEventListener("pointercancel", finir);
        retenir("largeurCote", largeurVoulue);
    };
    poignee.addEventListener("pointermove", bouger);
    poignee.addEventListener("pointerup", finir);
    poignee.addEventListener("pointercancel", finir);
});
// Double-clic : la largeur normale
poignee.addEventListener("dblclick", () => {
    largeurVoulue = null;
    appliquerLargeur();
    try { localStorage.removeItem("largeurCote"); } catch {}
});
// Au clavier : flèches gauche et droite, Origine pour la largeur normale
poignee.addEventListener("keydown", (e) => {
    const actuelle = cote.getBoundingClientRect().width;
    if (e.key === "ArrowLeft") changerLargeur(actuelle - LARGEUR_COTE.pas);
    else if (e.key === "ArrowRight") changerLargeur(actuelle + LARGEUR_COTE.pas);
    else if (e.key === "Home") poignee.dispatchEvent(new MouseEvent("dblclick"));
    else return;
    e.preventDefault();
});
window.addEventListener("resize", appliquerLargeur);

// Ctrl+B replie ou déplie la barre, comme dans VS Code
window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "b") return;
    if (e.target.closest?.("input, textarea, [contenteditable]") && !e.target.closest?.("#input")) return;
    e.preventDefault();
    replier(!document.body.classList.contains("cote-repliee"));
});

if (typeof module !== "undefined") module.exports = { bornerLargeur, LARGEUR_COTE };

/* ---------- Réglages : le menu de gauche saute aux sections, et l'onglet Apparence ---------- */
const contenuReglages = document.querySelector("#reglages-contenu");
const liensReglages = [...document.querySelectorAll(".reglages__lien")];
function marquerSection(id) {
    for (const l of liensReglages) {
        const actif = l.dataset.section === id;
        l.classList.toggle("is-actif", actif);
        if (actif) l.setAttribute("aria-current", "true"); else l.removeAttribute("aria-current");
    }
}
for (const lien of liensReglages) {
    lien.addEventListener("click", () => {
        const section = document.getElementById(lien.dataset.section);
        marquerSection(lien.dataset.section);
        const cible = Math.min(section.offsetTop - contenuReglages.offsetTop, contenuReglages.scrollHeight - contenuReglages.clientHeight);
        contenuReglages.scrollTo({ top: cible, behavior: document.body.classList.contains("sans-animations") ? "auto" : "smooth" });
        // Le défilement doux ne tourne pas toujours (fenêtre en arrière-plan) : on arrive quand même
        setTimeout(() => { if (Math.abs(contenuReglages.scrollTop - cible) > 2) contenuReglages.scrollTop = cible; marquerSection(lien.dataset.section); }, 400);
        section.querySelector("h3")?.setAttribute("tabindex", "-1");
        section.querySelector("h3")?.focus({ preventScroll: true });
    });
}
// En faisant défiler, le menu suit la section qu'on lit
contenuReglages.addEventListener("scroll", () => {
    const haut = contenuReglages.scrollTop + 40;
    let courante = liensReglages[0].dataset.section;
    for (const l of liensReglages) if (document.getElementById(l.dataset.section).offsetTop - contenuReglages.offsetTop <= haut) courante = l.dataset.section;
    if (contenuReglages.scrollTop + contenuReglages.clientHeight >= contenuReglages.scrollHeight - 4) courante = liensReglages.at(-1).dataset.section;
    marquerSection(courante);
});

document.querySelector("#reglages-largeur-normale").addEventListener("click", () => poignee.dispatchEvent(new MouseEvent("dblclick")));
document.querySelector("#reglages-replier").addEventListener("click", () => {
    const replie = !document.body.classList.contains("cote-repliee");
    replier(replie);
    document.querySelector("#reglages-replier").focus();
});
const majBoutonReplier = () => { document.querySelector("#reglages-replier").textContent = document.body.classList.contains("cote-repliee") ? "Déplier" : "Replier"; };
new MutationObserver(majBoutonReplier).observe(document.body, { attributes: true, attributeFilter: ["class"] });
majBoutonReplier();

// Réduire les animations : en plus du réglage de Windows, que la feuille de style suit déjà
const caseAnimations = document.querySelector("#reglages-sans-animations");
caseAnimations.checked = lireRetenu("sansAnimations") === "1";
document.body.classList.toggle("sans-animations", caseAnimations.checked);
window.api.machineLegere?.().then((legere) => {
    if (legere !== true || lireRetenu("sansAnimations") !== null) return;
    caseAnimations.checked = true;
    document.body.classList.add("sans-animations");
}).catch(() => {});
caseAnimations.addEventListener("change", () => {
    document.body.classList.toggle("sans-animations", caseAnimations.checked);
    retenir("sansAnimations", caseAnimations.checked ? "1" : "0");
});
