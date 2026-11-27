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
// Le journal d'une tâche en cours est ouvert, sauf si on l'a fermé ; celui d'une tâche finie est fermé, sauf si on l'a ouvert
const journauxFermes = new Set();
const journauxOuverts = new Set();

// L'état d'une étape → marque et classe
const ETAT_ETAPE = {
    "à faire": { marque: "", classe: "etape--attente", texte: "à faire" },
    "en cours": { marque: "", classe: "etape--cours", texte: "en cours" },
    "faite": { marque: "✓", classe: "etape--faite", texte: "faite" },
    "à vérifier": { marque: "!", classe: "etape--doute", texte: "faite, à vérifier" },
    "ratée": { marque: "✕", classe: "etape--ratee", texte: "ratée" },
};
function listeEtapes(etapes) {
    const ol = creer("ol", "tache__etapes");
    ol.setAttribute("aria-label", "Étapes du plan");
    for (const e of etapes) {
        const etat = ETAT_ETAPE[e.etat] || ETAT_ETAPE["à faire"];
        const li = creer("li", `tache__etape ${etat.classe}`);
        const marque = creer("span", "tache__etape-marque", etat.marque);
        marque.setAttribute("aria-hidden", "true");
        li.append(marque, creer("span", "tache__etape-titre", e.titre));
        li.title = etat.texte;
        li.setAttribute("aria-label", `${e.titre} : ${etat.texte}`);
        ol.append(li);
    }
    return ol;
}

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
    if (t.tests === "syntaxe ok") infos.push("pas de tests · syntaxe vérifiée");
    else if (t.tests && t.tests !== "aucun test") infos.push(`tests ${t.tests}`);
    tete.append(creer("span", "tache__infos", infos.filter(Boolean).join(" · ")));
    li.append(tete);
    // Les étapes du plan dans l'ordre, cochées au fur et à mesure (mode Équipe)
    if (t.etapes?.length) li.append(listeEtapes(t.etapes));
    if (t.statut === "en cours" && t.activite) li.append(creer("p", "tache__activite", t.activite));
    // Ce que la tâche vient de faire, dans l'ordre : ouvert pendant qu'elle tourne
    if (t.journal?.length > 1 && (t.statut === "en cours" || !t.etapes?.length)) {
        const details = creer("details", "tache__journal");
        details.open = t.statut === "en cours" ? !journauxFermes.has(t.id) : journauxOuverts.has(t.id);
        details.addEventListener("toggle", () => {
            if (t.statut === "en cours") { if (details.open) journauxFermes.delete(t.id); else journauxFermes.add(t.id); }
            else if (details.open) journauxOuverts.add(t.id); else journauxOuverts.delete(t.id);
        });
        const ol = creer("ol", "tache__journal-liste");
        ol.append(...t.journal.map((a) => creer("li", "", a)));
        details.append(creer("summary", "", "Ce qu'elle a fait"), ol);
        li.append(details);
    }
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

function montrerErreurTache(texte, boutons = []) {
    const el = $("#tache-erreur");
    el.textContent = texte;
    el.hidden = !texte;
    const actions = $("#tache-erreur-actions");
    actions.replaceChildren(...boutons);
    actions.hidden = !boutons.length;
}

// Les boutons qui règlent le problème d'un ajout refusé : un dossier pas sous git, sans version, ou des fichiers pas
// enregistrés (l'équipe ne les verrait pas). « Préparer le dossier » demande l'accord (fenêtre du programme principal),
// puis la tâche est ajoutée. relancer(options) refait l'ajout ; fini(r) reçoit le résultat.
function boutonsPourAjout(r, relancer, fini) {
    if (!r.aPreparer && !r.modifs) return [];
    const preparer = boutonTache(r.modifs ? "Enregistrer et lancer" : "Préparer le dossier", async () => {
        const p = await window.api.preparerChantier();
        if (p.annule) return;
        if (!p.ok) { fini({ ok: false, erreur: p.erreur }); return; }
        fini(await relancer({}));
    }, "bouton");
    const boutons = [preparer];
    if (r.modifs) boutons.push(boutonTache("Lancer sans eux", async () => fini(await relancer({ malgreModifs: true }))));
    return boutons;
}

// Ajouter une tâche, depuis la page ou depuis /agent et /chantier dans la discussion. Renvoie { ok, erreur }.
// mode : « seul » (l'agent seul, le défaut) ou « equipe » (le chantier : chef, codeurs, relecteur)
async function ajouterTache(demande, mode = "seul", options = {}) {
    const { choix } = configurationDuTour();
    return window.api.tacheAjouter({ demande, fournisseurId: choix.fournisseurId, modele: choix.model, mode, ...options });
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
    const demande = champ.value;
    const mode = $("#tache-mode").value;
    const fini = (r) => {
        if (!r.ok) { montrerErreurTache(r.erreur, boutonsPourAjout(r, (o) => ajouterTache(demande, mode, o), fini)); return; }
        if (champ.value === demande) champ.value = "";
        montrerErreurTache("");
    };
    fini(await ajouterTache(demande, mode));
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
// Une seule carte par réponse : le modèle peut l'avoir demandée (outil), et l'app la montre aussi à la fin
const propositionsMontrees = new Set();
window.api.onPropositionTache(({ id, tache }) => afficherPropositionTache(id, tache));
function afficherPropositionTache(id, tache) {
    if (!fonctionsExperimentales() || propositionsMontrees.has(id)) return;
    propositionsMontrees.add(id);
    const flux = fluxParId(id);
    const carte = creer("div", "proposition-tache");
    const champ = creer("textarea", "proposition-tache__texte");
    champ.value = tache;
    champ.rows = 3;
    champ.setAttribute("aria-label", "La tâche à lancer");
    const message = creer("p", "tache__erreur");
    message.hidden = true;
    const reglage = creer("div", "tache__actions");
    reglage.hidden = true;
    // Qui fait la tâche : le même choix que sur la page Tâches
    const mode = $("#tache-mode").cloneNode(true);
    mode.removeAttribute("id");
    mode.value = $("#tache-mode").value;
    const actions = creer("div", "tache__actions");
    const fini = (r) => {
        if (!r.ok) {
            message.textContent = r.erreur; message.hidden = false;
            reglage.replaceChildren(...boutonsPourAjout(r, (o) => ajouterTache(champ.value, mode.value, o), fini));
            reglage.hidden = !reglage.children.length;
            return;
        }
        carte.replaceChildren(creer("p", "proposition-tache__titre", "Tâche lancée en fond."), boutonTache("Voir les tâches", () => document.querySelector('[data-page="taches"]')?.click()));
    };
    actions.append(
        mode,
        boutonTache("Lancer", async () => fini(await ajouterTache(champ.value, mode.value)), "bouton"),
        boutonTache("Non, réponds ici", () => {
            carte.remove();
            if (!reponseVivante(current)) send("Non, fais-le directement ici.");
        }),
    );
    carte.append(creer("p", "proposition-tache__titre", "Faire ça en tâche de fond ?"), champ, message, reglage, actions);
    (flux?.el.parentElement || messagesEl).append(carte);
    if (!flux) carte.scrollIntoView({ block: "nearest" });
}
