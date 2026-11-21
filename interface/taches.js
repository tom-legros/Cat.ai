/* ==========================================================
   Cat Ai — la page Tâches : on donne du travail à l'agent, on part, on revient.
   La file vit dans le programme principal (principal/taches.js) ; ici on l'affiche et on agit dessus.
   Chargé après renderer.js et pages.js : il se sert de $, creer, icone, project, configurationDuTour,
   lignesPatch, resumeCopie et de la fenêtre de diff du mode Auto.
   ========================================================== */

let taches = [];
// Les bilans ouverts restent ouverts quand la liste se redessine (toutes les secondes pendant une tâche)
const bilansOuverts = new Set();
// Seules les nouvelles cartes s'animent : la liste se redessine chaque seconde pendant une tâche
const tachesVues = new Set();

// Statut → libellé court et classe de couleur
const STATUT_TACHE = {
    "en attente": { texte: "En attente", classe: "statut--attente" },
    "en cours": { texte: "En cours", classe: "statut--cours" },
    "réussie": { texte: "Réussie", classe: "statut--ok" },
    "réussie, à vérifier": { texte: "À vérifier", classe: "statut--doute" },
    "en partie": { texte: "En partie", classe: "statut--doute" },
    "ratée": { texte: "Ratée", classe: "statut--rate" },
    "arrêtée": { texte: "Arrêtée", classe: "statut--neutre" },
    "interrompue": { texte: "Interrompue", classe: "statut--neutre" },
    "gardée": { texte: "Gardée", classe: "statut--neutre" },
    "jetée": { texte: "Jetée", classe: "statut--neutre" },
};
const tacheActive = (t) => t.statut === "en attente" || t.statut === "en cours";
const nomDossier = (chemin) => String(chemin || "").split(/[\\/]/).filter(Boolean).pop() || chemin;

function dureeTache(t) {
    if (!t.debut) return "";
    const secondes = Math.max(0, Math.round(((t.fin || Date.now()) - t.debut) / 1000));
    return secondes < 60 ? `${secondes} s` : `${Math.floor(secondes / 60)} min ${String(secondes % 60).padStart(2, "0")}`;
}

// Le badge de l'entrée Tâches : combien attendent ou tournent
function majBadgeTaches() {
    const n = taches.filter(tacheActive).length;
    const badge = $("#taches-badge");
    badge.hidden = !n;
    badge.textContent = String(n);
}

function boutonTache(texte, action, classe = "bouton-calme") {
    const b = creer("button", classe, texte);
    b.type = "button";
    b.addEventListener("click", action);
    return b;
}

async function agirTache(promesse) {
    const r = await promesse;
    if (r && !r.ok && !r.annule && r.erreur) montrerErreurTache(r.erreur);
}

// Les changements d'une tâche, dans la même fenêtre que le mode Auto
async function voirTache(t) {
    const r = await window.api.tacheChangements(t.id);
    if (!r.ok) { montrerErreurTache(r.erreur || "La copie de cette tâche n'existe plus."); return; }
    $("#agent-diff-stats").textContent = resumeCopie({ fichiers: r.fichiers.length, ajouts: r.ajouts, retraits: r.retraits });
    $("#agent-diff-contenu").replaceChildren(...lignesPatch(r.patch));
    $("#agent-diff-modal").hidden = false;
    $("#agent-diff-fermer").focus();
}

function carteTache(t) {
    const li = creer("li", "tache");
    if (!tachesVues.has(t.id)) { tachesVues.add(t.id); li.classList.add("is-nouvelle"); }
    const statut = STATUT_TACHE[t.statut] || { texte: t.statut, classe: "statut--neutre" };
    const tete = creer("div", "tache__tete");
    tete.append(creer("span", `tache__statut ${statut.classe}`, statut.texte), creer("span", "tache__titre", t.demande.split("\n")[0]));
    const infos = [nomDossier(t.projet), t.mode === "equipe" ? "Équipe" : t.modele, dureeTache(t)];
    if (t.fichiers) infos.push(resumeCopie(t));
    if (t.tests && t.tests !== "aucun test") infos.push(`tests ${t.tests}`);
    tete.append(creer("span", "tache__infos", infos.filter(Boolean).join(" · ")));
    li.append(tete);
    if (t.statut === "en cours" && t.activite) li.append(creer("p", "tache__activite", t.activite));
    if (t.erreur) li.append(creer("p", "tache__erreur", t.erreur));
    if (t.aVerifier) li.append(creer("p", "tache__doute", `À vérifier : ${t.aVerifier}`));
    if (t.bilan || t.rapport) {
        const details = creer("details", "tache__rapport");
        details.open = bilansOuverts.has(t.id);
        details.addEventListener("toggle", () => (details.open ? bilansOuverts.add(t.id) : bilansOuverts.delete(t.id)));
        const texte = creer("div", "tache__texte");
        texte.innerHTML = renderMarkdown(t.rapport || t.bilan);
        details.append(creer("summary", "", "Bilan"), texte);
        li.append(details);
    }
    const actions = creer("div", "tache__actions");
    if (tacheActive(t)) actions.append(boutonTache("Arrêter", () => agirTache(window.api.tacheArreter(t.id))));
    if (t.copie && ["réussie", "réussie, à vérifier", "en partie"].includes(t.statut)) {
        actions.append(
            boutonTache("Voir", () => voirTache(t)),
            boutonTache("Garder", () => agirTache(window.api.tacheGarder(t.id)), "bouton"),
            boutonTache("Jeter", () => agirTache(window.api.tacheJeter(t.id))),
        );
    }
    if (["ratée", "arrêtée", "interrompue", "en partie"].includes(t.statut)) actions.append(boutonTache("Relancer", () => agirTache(window.api.tacheRelancer(t.id))));
    if (!tacheActive(t) && !(t.copie && ["réussie", "réussie, à vérifier", "en partie"].includes(t.statut))) {
        actions.append(boutonTache("Retirer", () => agirTache(window.api.tacheRetirer(t.id))));
    }
    if (actions.children.length) li.append(actions);
    return li;
}

function dessinerTaches() {
    majBadgeTaches();
    if ($("#page-taches").hidden) return;
    $("#taches-projet").textContent = project ? `Dossier : ${nomDossier(project)}` : "Ouvre un dossier dans la discussion pour confier une tâche.";
    // Les plus récentes en haut
    const liste = [...taches].reverse();
    $("#taches-liste").replaceChildren(...liste.map(carteTache));
    $("#taches-vide").hidden = liste.length > 0;
}

function montrerErreurTache(texte) {
    const el = $("#tache-erreur");
    el.textContent = texte;
    el.hidden = !texte;
}

// Ajouter une tâche, depuis la page ou depuis /agent et /chantier dans la discussion. Renvoie { ok, erreur }.
// mode : « seul » (l'agent seul, le défaut) ou « equipe » (le chantier : chef, codeurs, relecteur)
async function ajouterTache(demande, mode = "seul") {
    const { choix } = configurationDuTour();
    return window.api.tacheAjouter({ demande, fournisseurId: choix.fournisseurId, modele: choix.model, mode });
}

async function ouvrirTaches() {
    taches = await window.api.tachesLister();
    montrerErreurTache("");
    dessinerTaches();
    $("#tache-demande").focus();
}

$("#tache-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const champ = $("#tache-demande");
    const r = await ajouterTache(champ.value, $("#tache-mode").value);
    if (!r.ok) { montrerErreurTache(r.erreur); return; }
    champ.value = "";
    montrerErreurTache("");
});
// Entrée ajoute, Maj+Entrée va à la ligne
$("#tache-demande").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#tache-form").requestSubmit(); }
});

window.api.onTaches((liste) => { taches = liste; dessinerTaches(); });
// La durée de la tâche en cours avance à l'écran
setInterval(() => { if (taches.some((t) => t.statut === "en cours")) dessinerTaches(); }, 1000);
window.api.tachesLister().then((liste) => { taches = liste; majBadgeTaches(); }).catch(() => {});

// Le chat propose une tâche de fond (outil proposer_tache) : une carte sous sa réponse. Rien ne part sans un clic :
// on peut corriger le texte, lancer, ou demander au chat de le faire directement.
window.api.onPropositionTache(({ id, tache }) => {
    const flux = fluxParId(id);
    const carte = creer("div", "proposition-tache");
    const champ = creer("textarea", "proposition-tache__texte");
    champ.value = tache;
    champ.rows = 3;
    champ.setAttribute("aria-label", "La tâche à lancer");
    const message = creer("p", "tache__erreur");
    message.hidden = true;
    const actions = creer("div", "tache__actions");
    actions.append(
        boutonTache("Lancer", async () => {
            const r = await ajouterTache(champ.value);
            if (!r.ok) { message.textContent = r.erreur; message.hidden = false; return; }
            carte.replaceChildren(creer("p", "proposition-tache__titre", "Tâche lancée en fond."), boutonTache("Voir les tâches", () => document.querySelector('[data-page="taches"]')?.click()));
        }, "bouton"),
        boutonTache("Non, réponds ici", () => {
            carte.remove();
            if (!reponseVivante(current)) send("Non, fais-le directement ici.");
        }),
    );
    carte.append(creer("p", "proposition-tache__titre", "Faire ça en tâche de fond ?"), champ, message, actions);
    (flux?.el.parentElement || messagesEl).append(carte);
});
