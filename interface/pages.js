/* ==========================================================
   Cat Ai — les pages : Discussion, Agents, Modèles.
   Chargé après renderer.js : il se sert de $, reglages, icone, loadModels…
   10. Navigation   11. Page Agents   12. Page Modèles
   ========================================================== */

/* ---------- 10. Navigation ---------- */
const PAGES = { agents: $("#page-agents"), modeles: $("#page-modeles") };
let pageOuverte = "discussion";
// La page Agents est rangée le temps de la refonte de l'agent (façon Claude Code, avec Git) : le code reste, l'entrée disparaît
const PAGE_AGENTS = false;
if (!PAGE_AGENTS) {
    document.querySelector('.nav__lien[data-page="agents"]')?.remove();
    delete PAGES.agents;
}

// Toutes les icônes viennent de la même source (PIXELS dans icones.js) : même grille 8 × 8, même rendu, même alignement.
document.querySelectorAll("[data-icone]").forEach((el) => { el.innerHTML = icone(el.dataset.icone, el.dataset.classe); });

function voirPage(nom) {
    pageOuverte = PAGES[nom] ? nom : "discussion";
    for (const [id, el] of Object.entries(PAGES)) el.hidden = id !== pageOuverte;
    $(".principal").classList.toggle("is-page", pageOuverte !== "discussion");
    document.querySelectorAll(".nav__lien").forEach((b) => {
        const active = b.dataset.page === pageOuverte;
        b.classList.toggle("is-actif", active);
        if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (pageOuverte === "agents") ouvrirAgents();
    if (pageOuverte === "modeles") ouvrirModeles();
    if (pageOuverte === "discussion") $("#input").focus();
}

document.querySelectorAll(".nav__lien").forEach((b) => b.addEventListener("click", () => voirPage(b.dataset.page)));
// Ouvrir une discussion, ou en commencer une, ramène à la discussion
$("#new-chat").addEventListener("click", () => voirPage("discussion"));
$("#conv-list").addEventListener("click", () => voirPage("discussion"));

// Un élément avec sa classe et son texte : moins de lignes pour construire la page
function creer(balise, classe, texte) {
    const el = document.createElement(balise);
    if (classe) el.className = classe;
    if (texte !== undefined) el.textContent = texte;
    return el;
}


/* ---------- 11. Page Agents : l'arbre de l'équipe ---------- */
// Les règles de l'arbre (qui va sous qui, combien) sont dans principal/equipe.js : ici, on dessine et on demande.
const GENRES = {
    chef: { icone: "couronne", couleur: "jaune", role: "Découpe ton plan et distribue les étapes." },
    codeur: { icone: "code", couleur: "bleu", role: "Écrit le code de ses étapes, dans une copie de ton projet." },
    testeur: { icone: "coche", couleur: "vert", role: "Lance les tests de ton projet après chaque étape." },
    logs: { icone: "serveur", couleur: "gris", role: "Quand un test casse, il lit la sortie et dit quoi corriger." },
    relecteur: { icone: "lunettes", couleur: "rose", role: "Compare le changement à la consigne : il accepte ou refuse." },
    auteur: { icone: "livre", couleur: "bleu", role: "Écrit les tests qui prouvent que le travail des devs marche." }
};
// Sous un agent : les devs d'abord, puis l'auteur de tests, puis les contrôles
const ORDRE_ROLES = ["codeur", "auteur", "testeur", "logs", "relecteur"];
let equipe = null;          // { agents: [{ id, type, nom, parent, fournisseur, modele, ajouts… }], types }
let agentOuvert = "chef";
let menuAjout = "";         // id de l'agent dont le menu « + » est ouvert
const modelesParFournisseur = {}; // demandés une fois par ouverture de la page

// Le chat d'un agent : son rôle donne l'accessoire. Un codeur chargé des tests a le carnet de l'auteur de tests.
// Plusieurs agents qui ont le même chat se distinguent par la couleur du collier, dans l'ordre de l'équipe : la
// couleur reste la même d'une ouverture à l'autre.
const roleSprite = (agent) => (agent.type === "codeur" && /test/i.test(`${agent.nom} ${agent.specialite || ""}`) ? "auteur" : agent.type);
function chatDe(agent) {
    const role = roleSprite(agent);
    const memes = (equipe?.agents || []).filter((a) => roleSprite(a) === role);
    return spriteAgent(role, Math.max(0, memes.findIndex((a) => a.id === agent.id)));
}

const nomFournisseur = (id) => reglages.fournisseurs.find((f) => f.id === id)?.nom.replace(/ \(local\)$/, "") || id;
const agentDe = (id) => equipe.agents.find((a) => a.id === id);

async function modelesDe(fournisseurId) {
    if (!modelesParFournisseur[fournisseurId]) {
        const r = await window.api.models(fournisseurId);
        if (!r.ok) return [];
        modelesParFournisseur[fournisseurId] = r.models;
    }
    return modelesParFournisseur[fournisseurId];
}

function sousTitre(agent) {
    if (!agent.avecModele) return "tests du projet";
    if (!agent.modele) return "aucun modèle";
    // Sur le PC, le nom du modèle suffit ; en ligne, on dit chez qui
    return agent.fournisseur === "ollama" ? agent.modele : `${nomFournisseur(agent.fournisseur)} · ${agent.modele}`;
}

function dessinerNoeud(agent) {
    const li = creer("li");
    const carte = creer("div", "noeud" + (agent.id === agentOuvert ? " is-ouvert" : ""));
    carte.dataset.id = agent.id;
    const bouton = creer("button", "noeud__carte");
    bouton.type = "button";
    bouton.title = `${agent.nom} · ${sousTitre(agent)}`;
    bouton.setAttribute("aria-pressed", String(agent.id === agentOuvert));
    bouton.innerHTML = chatDe(agent)
        + `<span class="noeud__texte"><span class="noeud__nom">${escape(agent.nom)}</span><span class="noeud__qui">${escape(sousTitre(agent))}</span></span>`;
    bouton.addEventListener("click", () => { agentOuvert = agent.id; menuAjout = ""; dessinerAgents(); });
    carte.appendChild(bouton);
    if (agent.ajouts.length) {
        const plus = creer("button", "noeud__plus");
        plus.type = "button";
        plus.title = "Ajouter un agent dessous";
        plus.setAttribute("aria-label", `Ajouter un agent sous ${agent.nom}`);
        plus.innerHTML = icone("plus");
        plus.addEventListener("click", (e) => { e.stopPropagation(); menuAjout = menuAjout === agent.id ? "" : agent.id; dessinerToile(); });
        carte.appendChild(plus);
        if (menuAjout === agent.id) {
            const menu = creer("div", "noeud__menu");
            for (const type of agent.ajouts) {
                const choix = creer("button", "noeud__choix");
                choix.type = "button";
                choix.innerHTML = `${spriteAgent(type)}${escape(equipe.types[type])}`;
                choix.title = GENRES[type].role;
                choix.addEventListener("click", () => changerEquipe(window.api.ajouterAgent(agent.id, type), true));
                menu.appendChild(choix);
            }
            carte.appendChild(menu);
        }
    }
    li.appendChild(carte);
    const dessous = equipe.agents.filter((a) => a.parent === agent.id)
        .sort((a, b) => ORDRE_ROLES.indexOf(roleSprite(a)) - ORDRE_ROLES.indexOf(roleSprite(b)));
    if (dessous.length) {
        const ul = creer("ul");
        dessous.forEach((a) => ul.appendChild(dessinerNoeud(a)));
        li.appendChild(ul);
    }
    return li;
}

function dessinerToile() {
    const arbre = creer("ul", "arbre");
    const chef = equipe.agents.find((a) => a.type === "chef");
    arbre.appendChild(dessinerNoeud(chef));
    const toile = $("#toile");
    toile.classList.toggle("toile--compacte", equipe.agents.filter((a) => a.parent === chef.id).length > 4);
    toile.replaceChildren(arbre);
}

// Une ligne de conseil, seulement quand le choix a une conséquence
function conseilAgent(agent) {
    if (!agent.avecModele) return "";
    if (!agent.modele) return "Aucun modèle : installe-en un dans la page Modèles.";
    if (agent.fournisseur !== "ollama") return agent.type === "codeur" ? "En ligne : il code mieux, mais un long chantier peut vider ton quota gratuit du jour. Le modèle du PC prend alors le relais." : "En ligne : plus malin, mais chaque étape prend sur ton quota gratuit.";
    const locaux = new Set(equipe.agents.filter((a) => a.fournisseur === "ollama" && a.modele).map((a) => a.modele));
    return locaux.size > 1 ? "Plusieurs modèles sur ton PC : Ollama les échange, c'est plus lent." : "";
}

function champ(etiquette, controle) {
    const bloc = creer("label", "fiche__champ");
    bloc.append(creer("span", "fiche__etiquette", etiquette), controle);
    return bloc;
}

function dessinerFiche() {
    const agent = agentDe(agentOuvert) || agentDe("chef");
    const genre = GENRES[roleSprite(agent)];
    const fiche = $("#fiche");
    const tete = creer("div", "fiche__tete");
    tete.innerHTML = `${chatDe(agent)}<span><span class="fiche__genre">${escape(roleSprite(agent) === "auteur" ? "Auteur de tests" : equipe.types[agent.type])}</span><span class="fiche__role">${escape(genre.role)}</span></span>`;
    const erreur = creer("p", "fiche__erreur");
    const modifier = async (changement) => {
        const ok = await changerEquipe(window.api.modifierAgent(agent.id, changement));
        if (ok !== true) erreur.textContent = ok;
    };

    const nom = creer("input");
    nom.value = agent.nom;
    nom.maxLength = 30;
    nom.addEventListener("change", () => modifier({ nom: nom.value }));
    const blocs = [tete, champ("Nom", nom)];

    if (agent.type === "codeur") {
        const specialite = creer("input");
        specialite.value = agent.specialite || "";
        specialite.maxLength = 120;
        specialite.placeholder = "interface, tests, base de données…";
        specialite.addEventListener("change", () => modifier({ specialite: specialite.value }));
        blocs.push(champ("Spécialité, pour que le chef distribue", specialite));
    }

    if (agent.avecModele) {
        const selFournisseur = creer("select");
        const possibles = reglages.fournisseurs;
        selFournisseur.innerHTML = possibles.map((f) => `<option value="${escape(f.id)}"${f.aCle ? "" : " disabled"}>${escape(f.nom)}${f.aCle ? "" : " (pas de clé)"}</option>`).join("");
        selFournisseur.value = agent.fournisseur;
        selFournisseur.disabled = possibles.length < 2;
        const selModele = creer("select");
        selFournisseur.addEventListener("change", async () => {
            const fournisseur = selFournisseur.value;
            const modeles = await modelesDe(fournisseur);
            if (!modeles.length) { erreur.textContent = `${nomFournisseur(fournisseur)} ne répond pas, ou n'a aucun modèle.`; selFournisseur.value = agent.fournisseur; return; }
            const retenu = reglages.modeles[fournisseur];
            modifier({ fournisseur, modele: modeles.includes(retenu) ? retenu : modeleParDefaut(modeles, fournisseur) });
        });
        selModele.addEventListener("change", () => modifier({ fournisseur: agent.fournisseur, modele: selModele.value }));
        blocs.push(champ("Fournisseur", selFournisseur), champ("Modèle", selModele));
        modelesDe(agent.fournisseur).then((modeles) => {
            const liste = agent.modele && !modeles.includes(agent.modele) ? [agent.modele, ...modeles] : modeles;
            selModele.innerHTML = liste.map((m) => `<option value="${escape(m)}">${escape(m)}</option>`).join("");
            selModele.value = agent.modele;
        });
    }

    const conseil = conseilAgent(agent);
    if (conseil) blocs.push(creer("p", "fiche__conseil", conseil));
    blocs.push(erreur);
    if (agent.type !== "chef") {
        const dessous = equipe.agents.some((a) => a.parent === agent.id);
        const retirer = creer("button", "bouton-calme bouton-calme--retirer", dessous ? "Retirer avec ce qui est dessous" : "Retirer");
        retirer.type = "button";
        retirer.addEventListener("click", async () => {
            const parent = agent.parent;
            const ok = await changerEquipe(window.api.retirerAgent(agent.id));
            if (ok === true) { agentOuvert = parent; dessinerAgents(); } else erreur.textContent = ok;
        });
        blocs.push(retirer);
    }
    fiche.replaceChildren(...blocs);
}

function dessinerAgents() {
    dessinerToile();
    marquerActif();
    dessinerFiche();
}

for (const [id, tests] of [["#equipe-dev", false], ["#equipe-auteur-tests", true]]) {
    $(id).addEventListener("click", async () => {
        const chef = equipe?.agents.find((a) => a.type === "chef");
        if (!chef || chantierTourne) return;
        $(id).disabled = true;
        try {
            const ok = await changerEquipe(window.api.ajouterAgent(chef.id, "codeur", tests), true);
            $("#equipe-statut").textContent = ok === true ? "" : ok;
            if (ok === true) await donnerModelesManquants();
        } finally {
            $(id).disabled = false;
        }
    });
}
$("#agents-projet").addEventListener("click", async () => {
    const bouton = $("#agents-projet");
    bouton.disabled = true;
    try {
        await choisirProjet();
    } catch {
        $("#equipe-statut").textContent = "Impossible d’ouvrir le dossier.";
    } finally {
        bouton.disabled = chantierTourne;
    }
});
$("#equipe-plan").addEventListener("click", () => {
    $("#chantier").scrollIntoView({ block: "start" });
    $("#chantier-plan").focus({ preventScroll: true });
});

// Applique la réponse de l'app à une demande de changement. Renvoie true, ou le message d'erreur.
async function changerEquipe(demande, ouvrirNouveau = false) {
    const r = await demande;
    if (!r.ok) return r.erreur || "Ça n'a pas marché.";
    invaliderPreparation();
    equipe = r;
    menuAjout = "";
    if (ouvrirNouveau && r.id) agentOuvert = r.id;
    dessinerAgents();
    return true;
}

$("#equipe-remettre").addEventListener("click", async () => {
    agentOuvert = "chef";
    await changerEquipe(window.api.remettreEquipe());
    await donnerModelesManquants();
});

// Un clic ailleurs ferme le menu « + »
$("#page-agents").addEventListener("click", (e) => {
    if (menuAjout && !e.target.closest(".noeud")) { menuAjout = ""; dessinerToile(); }
});

// Un agent sans modèle (rien n'a encore été choisi) prend celui de la discussion, sinon le conseillé
async function donnerModelesManquants() {
    for (const agent of equipe.agents.filter((a) => a.avecModele && !a.modele)) {
        const modeles = await modelesDe(agent.fournisseur);
        const choisi = agent.fournisseur === reglages.actif && modeles.includes(modelSel.value) ? modelSel.value : modeleParDefaut(modeles, agent.fournisseur);
        if (!choisi) continue;
        const r = await window.api.modifierAgent(agent.id, { fournisseur: agent.fournisseur, modele: choisi });
        if (r.ok) equipe = r;
    }
    dessinerAgents();
}

async function ouvrirAgents() {
    window.api.etatChantier().then(majChantier);
    for (const id of Object.keys(modelesParFournisseur)) delete modelesParFournisseur[id];
    equipe = await window.api.lireEquipe();
    if (!agentDe(agentOuvert)) agentOuvert = "chef";
    await donnerModelesManquants();
}

/* Le chantier : le plan, le suivi en direct, puis le rapport. Tout le travail est fait par le processus principal. */
let chantierTourne = false;
let chantierFini = "";       // nom du dernier chantier terminé, tant qu'il n'est ni gardé ni jeté
let planPrepare = false;
let arretDemande = false;
const JOURNAL_MAX = 300;

function invaliderPreparation() {
    planPrepare = false;
    $("#chantier-apercu").hidden = true;
    majChantier();
}

window.api.onProjectChanged(() => {
    invaliderPreparation();
    window.api.etatChantier().then(majChantier);
});

function majChantier(etat) {
    $("#chantier-lancer").textContent = arretDemande ? "Arrêt en cours…" : chantierTourne ? "Arrêter" : planPrepare ? "Lancer les agents" : "Préparer le plan";
    $("#chantier-lancer").disabled = arretDemande;
    for (const id of ["#chantier-garder", "#chantier-jeter", "#chantier-reprendre", "#chantier-nouveau-dev"]) $(id).disabled = chantierTourne;
    $("#chantier-lancer").classList.toggle("is-stop", chantierTourne);
    // Pendant un chantier, la page se resserre : l'arbre et la vue en direct tiennent ensemble à l'écran
    $("#page-agents").classList.toggle("is-chantier", chantierTourne);
    $("#chantier-importer").hidden = chantierTourne;
    $("#chantier-plan").readOnly = chantierTourne;
    for (const id of ["#equipe-dev", "#equipe-auteur-tests", "#equipe-remettre", "#agents-projet"]) $(id).disabled = chantierTourne;
    if (!etat) return;
    const dossier = $("#chantier-dossier");
    dossier.textContent = etat.projet ? `Dossier : ${etat.projet}` : "Aucun dossier sélectionné.";
    $("#agents-projet").textContent = etat.projet ? "Changer de dossier" : "Choisir un dossier";
    $("#chantier-preparer").hidden = chantierTourne || !etat.projet || etat.pret || etat.raison === "git-absent";
    if (etat.projet && !etat.pret && !chantierTourne) $("#chantier-statut").textContent = etat.message;
}

function ligneJournal(texte, classe = "") {
    const journal = $("#chantier-journal");
    const li = creer("li", classe, texte.trim());
    journal.appendChild(li);
    while (journal.children.length > JOURNAL_MAX) journal.firstChild.remove();
    journal.scrollTop = journal.scrollHeight;
}

/* La vue en direct. suivi : { debut, fin, etapes: [{ titre, codeur, etat, debut, fin, essais }], actif }
   etat : attente, cours, fait, bloque. actif : { role, nom, action, essai, depuis } de l'agent qui a la main. */
let suivi = null;
let horlogeChantier = null;

// 0:42, 12:05, puis 1 h 03
function chrono(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(s / 60);
    return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`;
}

// L'agent de l'arbre qui correspond à celui qui travaille : même rôle et même nom, sinon le premier de ce rôle
function agentQuiTravaille() {
    const a = suivi?.actif;
    if (!a || !equipe) return null;
    return equipe.agents.find((x) => x.type === a.role && x.nom === a.nom) || equipe.agents.find((x) => x.type === a.role) || null;
}

// Dans l'arbre : la case de l'agent actif s'allume et dit ce qu'il fait, les autres reprennent leur texte
function marquerActif() {
    const actif = agentQuiTravaille();
    const depuis = suivi?.actif ? chrono((suivi.fin || Date.now()) - suivi.actif.depuis) : "";
    document.querySelectorAll("#toile .noeud").forEach((n) => {
        const agent = equipe?.agents.find((x) => x.id === n.dataset.id);
        const travaille = !!actif && agent === actif;
        n.classList.toggle("is-travaille", travaille);
        const ligne = n.querySelector(".noeud__qui");
        if (ligne && agent) ligne.textContent = travaille ? `${suivi.actif.action} · ${depuis}` : sousTitre(agent);
    });
}

function dessinerDirect() {
    if (!suivi) return;
    const maintenant = suivi.fin || Date.now();
    $("#direct-total").textContent = `${suivi.fin ? "Durée" : "En cours depuis"} ${chrono(maintenant - suivi.debut)}`;
    const zone = $("#direct-agent");
    const a = suivi.actif;
    if (a) {
        const qui = agentQuiTravaille();
        zone.innerHTML = `<span class="direct__chat">${qui ? chatDe(qui) : spriteAgent(a.role)}</span>`
            + `<span class="direct__texte"><span class="direct__nom">${escape(a.nom)} ${escape(a.action)}</span>`
            + `<span class="direct__depuis">depuis ${chrono(maintenant - a.depuis)}${a.essai > 1 ? ` · essai ${a.essai} sur 3` : ""}</span></span>`;
    } else zone.replaceChildren();
    const liste = $("#chantier-etapes");
    liste.replaceChildren();
    suivi.etapes.forEach((e, i) => {
        const li = creer("li", `etape is-${e.etat}`);
        const duree = e.debut ? chrono((e.fin || maintenant) - e.debut) : "";
        const info = [e.codeur, e.essais > 1 ? `${e.essais} essais` : "", { fait: "fait", bloque: "bloquée", cours: "en cours", attente: "" }[e.etat]].filter(Boolean).join(" · ");
        li.append(creer("span", "etape__puce", e.etat === "fait" ? "" : String(i + 1)), creer("span", "etape__titre", e.titre), creer("span", "etape__info", info), creer("span", "etape__duree", duree));
        if (e.etat === "fait") li.firstChild.innerHTML = icone("coche");
        liste.appendChild(li);
    });
    marquerActif();
}

function demarrerSuivi() {
    suivi = { debut: Date.now(), fin: 0, etapes: [], actif: { role: "chef", nom: "Chef", action: "découpe le plan", depuis: Date.now() } };
    clearInterval(horlogeChantier);
    horlogeChantier = setInterval(dessinerDirect, 1000);
    dessinerDirect();
}

function arreterSuivi() {
    clearInterval(horlogeChantier);
    horlogeChantier = null;
    if (!suivi) return;
    suivi.fin = Date.now();
    suivi.actif = null;
    // Une étape encore en cours à l'arrêt n'a pas été finie
    for (const e of suivi.etapes) if (e.etat === "cours") { e.etat = "attente"; e.fin = suivi.fin; }
    dessinerDirect();
}

window.api.onChantier((e) => {
    if (e.type === "info") { ligneJournal(e.texte, /échec|refusée|abandonnée|indisponible|Attention|Écriture sans changement/.test(e.texte) ? "is-alerte" : ""); return; }
    if (!suivi) return;
    const etape = (n) => (suivi.etapes[n - 1] ??= { titre: `Étape ${n}`, codeur: "", etat: "attente", essais: 0 });
    if (e.type === "plan") suivi.etapes = e.etapes.map((x) => ({ titre: x.titre, codeur: x.codeur, etat: x.fait ? "fait" : "attente", essais: 0 }));
    else if (e.type === "etape") {
        Object.assign(etape(e.i), { etat: "cours", debut: Date.now() });
        $("#chantier-etape").textContent = `Étape ${e.i} sur ${e.n} · ${e.titre}`;
        $("#chantier-barre").style.width = `${Math.round(((e.i - 1) / e.n) * 100)}%`;
        ligneJournal(`Étape ${e.i} : ${e.titre}`, "is-etape");
    } else if (e.type === "activite") {
        suivi.actif = e.fini ? null : { role: e.role, nom: e.nom, action: e.action, essai: e.essai || 1, depuis: Date.now() };
        if (e.etape && e.essai) etape(e.etape).essais = e.essai;
    } else if (e.type === "resultat") Object.assign(etape(e.etape), { etat: e.ok ? "fait" : "bloque", fin: Date.now(), essais: e.essais });
    dessinerDirect();
});

async function lancerOuArreter(reprendre = false) {
    const statut = $("#chantier-statut");
    if (chantierTourne) {
        arretDemande = true;
        statut.textContent = "Arrêt demandé…";
        majChantier();
        await window.api.arreterChantier();
        return;
    }
    const action = reprendre ? "reprendre" : planPrepare ? "executer" : "preparer";
    const rapportVisible = !$("#chantier-fin").hidden;
    chantierTourne = true;
    statut.textContent = "";
    if (action !== "preparer") {
        $("#chantier-fin").hidden = true;
        $("#chantier-apercu").hidden = true;
    }
    $("#chantier-suivi").hidden = false;
    $("#chantier-journal").replaceChildren();
    $("#chantier-etape").textContent = action === "preparer" ? "Le chef découpe le plan…" : "Ouverture de la copie de travail…";
    $("#chantier-barre").style.width = "0%";
    majChantier();
    demarrerSuivi();
    if (action !== "preparer") { suivi.actif = null; dessinerDirect(); }
    let r;
    try {
        r = await window.api.lancerChantier($("#chantier-plan").value, action, reprendre ? $("#chantier-nouveau-dev").value : "");
    } catch (err) {
        r = { ok: false, erreur: err.message };
    }
    chantierTourne = false;
    arretDemande = false;
    arreterSuivi();
    majChantier(await window.api.etatChantier());
    if (!r.ok) {
        statut.textContent = r.erreur;
        $("#chantier-fin").hidden = !rapportVisible;
        if (r.modelesManquants) statut.append(" ", boutonAction("Ouvrir Modèles", "lien", () => voirPage("modeles")));
        if (planPrepare) $("#chantier-apercu").hidden = false;
        if (!$("#chantier-journal").children.length) $("#chantier-suivi").hidden = true;
        return;
    }
    if (r.preparation) {
        planPrepare = true;
        $("#chantier-affectations").replaceChildren(...r.preparation.map(({ titre, codeur, modele }) => {
            const ligne = creer("li", "", titre);
            ligne.append(creer("small", "", `${codeur} · ${modele}`));
            return ligne;
        }));
        $("#chantier-apercu").hidden = false;
        $("#chantier-suivi").hidden = true;
        majChantier();
        return;
    }
    invaliderPreparation();
    const faites = r.etapes.filter((e) => e.ok).length;
    $("#chantier-barre").style.width = `${r.total ? Math.round((faites / r.total) * 100) : 0}%`;
    $("#chantier-etape").textContent = `${r.arrete ? "Arrêté" : r.incomplet ? "Bloqué" : "Terminé"} · ${faites} / ${r.total ?? r.etapes.length} étapes validées · ${chrono(suivi.fin - suivi.debut)}`;
    // Dans l'app, les commandes git du rapport ne servent pas : les boutons Garder et Jeter les remplacent
    $("#chantier-rapport").textContent = r.rapport.split("\n\nLe travail est sur la branche")[0].replace(/^# Rapport du chantier\n+/, "") + (r.changements ? `\n\nFichiers changés :\n${r.changements}` : "");
    $("#chantier-suite").textContent = "";
    $("#chantier-garder").hidden = !faites;
    $("#chantier-reprendre").hidden = !r.incomplet;
    const choix = $("#chantier-nouveau-dev");
    choix.hidden = !r.incomplet;
    choix.replaceChildren(new Option("Même dev", ""), ...equipe.agents.filter((a) => a.type === "codeur").map((a, _, codeurs) => new Option(
        codeurs.filter((c) => c.nom === a.nom).length > 1 ? a.nom + " · " + a.id : a.nom, a.id
    )));
    $("#chantier-fin").hidden = false;
    chantierFini = r.nom;
}

$("#chantier-plan").addEventListener("input", invaliderPreparation);
$("#chantier-lancer").addEventListener("click", () => lancerOuArreter());
$("#chantier-reprendre").addEventListener("click", () => {
    if (!chantierTourne) lancerOuArreter(true);
});

$("#chantier-importer").addEventListener("click", async () => {
    const plan = await window.api.importerPlan();
    if (!plan) return;
    if (plan.erreur) { $("#chantier-statut").textContent = plan.erreur; return; }
    $("#chantier-plan").value = plan.texte;
    invaliderPreparation();
    $("#chantier-statut").textContent = `${plan.nom} chargé.`;
});

$("#chantier-preparer").addEventListener("click", async () => {
    const r = await window.api.preparerChantier();
    if (r.annule) return;
    $("#chantier-statut").textContent = r.ok ? "Dossier prêt." : r.erreur;
    majChantier(await window.api.etatChantier());
});

async function finirChantier(action, fait) {
    if (!chantierFini || chantierTourne) return;
    const r = await action(chantierFini);
    if (r.annule) return;
    if (!r.ok) { $("#chantier-suite").textContent = r.erreur; return; }
    chantierFini = "";
    $("#chantier-fin").hidden = true;
    $("#chantier-statut").textContent = fait;
}
$("#chantier-garder").addEventListener("click", () => finirChantier(window.api.garderChantier, "Le travail est dans ton projet."));
$("#chantier-jeter").addEventListener("click", () => finirChantier(window.api.jeterChantier, "Travail jeté. Ton projet n'a pas changé."));


/* ---------- 12. Page Modèles ---------- */
let catalogue = null;
let installes = [];
let ollamaLa = false;
let enTelechargement = "";
let ouvertureCatalogue = 0;

const MODELES_SELECTION = [
    ["qwen3:0.6b", "Texte simple sur un PC peu puissant", "modeleQwen", 4],
    ["qwen3.5:0.8b", "Texte et images simples avec peu de mémoire", "modeleQwen", 6],
    ["qwen3.5:2b", "Discussion légère et images simples", "modeleQwen", 8, 4],
    ["qwen3:4b", "Discussion et rédaction avec peu de mémoire", "modeleQwen"],
    ["qwen3.5:4b", "Assistant polyvalent pour le texte, le code et les images", "modeleQwen"],
    ["qwen3:8b", "Discussion multilingue et raisonnement", "modeleQwen"],
    ["qwen3.5:9b", "Code et analyse d’images plus poussée", "modeleQwen"],
    ["qwen3:14b", "Rédaction et raisonnement sur des tâches complexes", "modeleQwen"],
    ["qwen2.5-coder:7b", "Écriture, explication et correction de code", "modeleQwen"],
    ["gemma4:e2b", "Lecture de captures et analyse d’images", "modeleGemma"],
    ["gemma4:e4b-it-qat", "Images et texte, très léger (version QAT)", "modeleGemma"],
    ["gemma4:12b-it-qat", "Images et documents, pour une carte de 10 Go", "modeleGemma"],
    ["ministral-3:8b", "Mistral : français, images, long contexte", "modeleMistral"],
    ["gemma4:e4b", "Images et captures, plus précis que e2b", "modeleGemma"],
    ["gemma4:12b", "Images et documents sur une carte de 12 Go", "modeleGemma"],
    ["deepseek-r1:8b", "Maths et raisonnement étape par étape", "modeleDeepSeek"],
    ["gpt-oss:20b", "Raisonnement et tâches avec outils", "modeleOpenAI"],
    ["qwen3.6:27b", "Code avec outils et raisonnement sur une machine puissante", "modeleQwen"],
    ["qwen3.6:35b", "Code avec outils et analyse d’images", "modeleQwen"]
];

// À quoi sert chaque modèle de la sélection, pour les filtres
const USAGE_MODELE = {
    "qwen2.5-coder:7b": "code", "qwen3.5:9b": "code", "qwen3.6:27b": "code", "qwen3.6:35b": "code",
    "gemma4:e2b": "images", "gemma4:e4b": "images", "gemma4:e4b-it-qat": "images", "gemma4:12b-it-qat": "images", "gemma4:12b": "images", "qwen3.5:0.8b": "images",
    "deepseek-r1:8b": "reflexion", "gpt-oss:20b": "reflexion", "qwen3:14b": "reflexion"
};
const USAGES = { tous: "Tous", general: "Général", code: "Code", images: "Images", reflexion: "Réflexion", installes: "Installés" };
let usageChoisi = "tous";

const go = (n) => String(n).replace(".", ",");
const filtreAdaptes = $("#modeles-adaptes");
$("#modeles-recherche").addEventListener("input", () => dessinerModeles());
// Échap vide la recherche
$("#modeles-recherche").addEventListener("keydown", (e) => { if (e.key === "Escape" && e.target.value) { e.target.value = ""; dessinerModeles(); } });

function dessinerUsages() {
    const zone = $("#modeles-usages");
    zone.replaceChildren(...Object.entries(USAGES).map(([id, texte]) => {
        const b = creer("button", "filtre" + (id === usageChoisi ? " is-actif" : ""), texte);
        b.type = "button";
        b.setAttribute("aria-pressed", String(id === usageChoisi));
        b.addEventListener("click", () => { usageChoisi = id; dessinerModeles(); });
        return b;
    }));
}
filtreAdaptes.addEventListener("click", () => {
    const actif = filtreAdaptes.getAttribute("aria-pressed") !== "true";
    filtreAdaptes.setAttribute("aria-pressed", String(actif));
    dessinerModeles();
});

function evaluerModele({ vram, ramCPU, avis, conseille, integre, teste }, { vramGo, ramGo }) {
    if (vramGo >= vram) {
        if (integre) return { label: "Intégré par Cat Ai", classe: "avis--conseille", detail: "Réglé et testé pour Cat Ai", adapte: true };
        if (teste) return { label: "Testé par Cat Ai", classe: "avis--ok", detail: "Essayé dans Cat Ai : français, tableaux et code", adapte: true };
        return conseille
            ? { label: "Conseillé", classe: "avis--conseille", detail: "Bon choix pour ton GPU", adapte: true }
            : { label: "Rapide", classe: "avis--ok", detail: "Tient dans ta VRAM", adapte: true };
    }
    if (ramCPU && ramGo >= ramCPU) {
        return { label: "Lent (CPU)", classe: "avis--lent", detail: "Peut tourner sur le processeur", adapte: !vramGo };
    }
    if (vramGo && avis === "lent") {
        return { label: "Lent", classe: "avis--lent", detail: "Utilise aussi la RAM", adapte: false };
    }
    if (!vramGo && !ramCPU) {
        return { label: "À vérifier", classe: "avis--trop", detail: "GPU non détecté", adapte: false };
    }
    return { label: "Trop lourd", classe: "avis--trop", detail: "Mémoire probablement insuffisante", adapte: false };
}

const etatModele = (texte, classe = "") => creer("span", `modele__etat ${classe}`.trim(), texte);

function boutonTelecharger(modele) {
    const b = creer("button", "bouton-calme", "Télécharger");
    b.type = "button";
    b.addEventListener("click", () => telechargerDepuisPage(modele));
    return b;
}

// Ce qu'il y a au bout de la ligne : un état, ou le bouton. Jamais de bouton grisé : on dit pourquoi à la place.
function actionModele(m) {
    if (m.modele === enTelechargement) return etatModele("En cours");
    if (catalogue.disqueGo !== null && (m.tailleMax ?? m.taille) > catalogue.disqueGo) return etatModele("Espace insuffisant");
    if (!ollamaLa) return etatModele("Ollama hors ligne");
    if (enTelechargement || telechargement) return etatModele("En attente");
    return boutonTelecharger(m.modele);
}

// Toutes les fiches connues, avec leur avis pour ce PC : la sélection et la liste partent des mêmes données
function fichesModeles() {
    const modelesConnus = new Map(catalogue.modeles.map(m => [m.modele, m]));
    // Un modèle absent du catalogue est ignoré au lieu de faire planter la page
    return MODELES_SELECTION.filter(([modele]) => modelesConnus.has(modele)).map(([modele, raison, pictogramme, ramCPU, budgetVRAM]) => {
        const fiche = modelesConnus.get(modele);
        const m = { ...fiche, modele, raison, pictogramme, ramCPU, vram: budgetVRAM ?? fiche.vram };
        return { ...m, evaluation: evaluerModele(m, catalogue) };
    });
}

// Une info du PC avec sa petite icône (carte graphique, RAM, disque)
function infoPc(dessin, texte, aide) {
    const el = creer("span", "info-pc");
    el.title = aide;
    el.innerHTML = icone(dessin);
    el.append(texte);
    return el;
}

function dessinerModeles() {
    if (!catalogue) return;
    const { vramGo, ramGo, disqueGo, modeles } = catalogue;
    $("#infos-pc").replaceChildren(
        infoPc("puce", vramGo ? vramGo + " Go de VRAM" : "VRAM inconnue", "Mémoire de la carte graphique"),
        infoPc("ram", ramGo + " Go de RAM", "Mémoire vive du PC"),
        ...(disqueGo === null ? [] : [infoPc("disque", disqueGo + " Go libres", "Place libre sur le disque")])
    );
    $("#modeles-etat").textContent = ollamaLa ? "" : "Lance Ollama pour utiliser ou télécharger un modèle.";
    const modelesConnus = new Map(modeles.map(m => [m.modele, m]));
    const selection = fichesModeles();
    dessinerSelection(selection);
    // Les modèles installés que la sélection ne connaît pas restent visibles et utilisables
    for (const nom of installes.filter((n) => !modelesConnus.has(n) && !MODELES_SELECTION.some(([m]) => m === n))) {
        selection.push({ modele: nom, raison: "Installé par toi", pictogramme: "puce", taille: null, vram: null, evaluation: { label: "À vérifier", classe: "avis--trop", detail: "Pas dans la sélection : besoin en mémoire inconnu", adapte: false } });
    }
    for (const m of selection) m.usage = USAGE_MODELE[m.modele] || "general";
    filtreAdaptes.hidden = false;
    dessinerUsages();
    const filtre = filtreAdaptes.getAttribute("aria-pressed") === "true";
    const cherche = $("#modeles-recherche").value.trim().toLowerCase();
    const visibles = selection.filter((m) => (!filtre || m.evaluation.adapte)
        && (usageChoisi === "tous" || (usageChoisi === "installes" ? installes.includes(m.modele) : m.usage === usageChoisi))
        && (!cherche || `${m.modele} ${m.raison}`.toLowerCase().includes(cherche)));
    const actifs = [filtre && "adaptés à ton PC", usageChoisi !== "tous" && USAGES[usageChoisi].toLowerCase(), cherche && `« ${cherche} »`].filter(Boolean);
    // Le compteur n'apparaît que si on filtre soi-même (« Adaptés à mon PC » est le réglage de départ)
    const filtreChoisi = usageChoisi !== "tous" || !!cherche;
    $("#modeles-filtre-etat").textContent = filtreChoisi ? `${visibles.length} sur ${selection.length} · ${actifs.join(", ")}` : "";
    const effacer = creer("button", "lien lien--petit", "Tout afficher");
    effacer.type = "button";
    effacer.addEventListener("click", () => { $("#modeles-recherche").value = ""; usageChoisi = "tous"; filtreAdaptes.setAttribute("aria-pressed", "false"); dessinerModeles(); });
    if (filtreChoisi) $("#modeles-filtre-etat").append(" ", effacer);
    // Ce qu'on a d'abord (actif, puis installés), puis ce qui tient sur le PC, du plus léger au plus lourd
    const rang = (m) => (m.modele === modeleActif() ? 0 : installes.includes(m.modele) ? 1 : m.evaluation.adapte ? 2 : 3);
    visibles.sort((a, b) => rang(a) - rang(b) || (a.vram ?? 99) - (b.vram ?? 99));
    $("#modeles-liste").replaceChildren(enteteListe(), ...visibles.map(carteCatalogue));
    if (!visibles.length) $("#modeles-liste").append(creer("li", "modele modele--vide", "Aucun modèle ne correspond. « Tout afficher » enlève les filtres."));
}

// Le modèle Ollama en service, s'il y en a un
const modeleActif = () => (reglages.actif === "ollama" ? modelSel.value : "");

// La liste se lit comme un tableau : une ligne d'en-tête, puis une ligne par modèle
function enteteListe() {
    const li = creer("li", "ligne-modele ligne-modele--entete");
    li.setAttribute("aria-hidden", "true");
    for (const texte of ["", "Modèle", "Poids", "Mémoire", "Sur ton PC", ""]) li.append(creer("span", "", texte));
    return li;
}

function carteCatalogue(m) {
    const ligne = creer("li", "ligne-modele");
    if (m.modele === modeleActif()) ligne.classList.add("is-actif");
    const pictogramme = creer("span", "ligne-modele__icone");
    pictogramme.innerHTML = icone(m.pictogramme);
    const identite = creer("div", "ligne-modele__identite");
    const nom = creer("h4", "ligne-modele__nom");
    nom.append(lienExterne(m.modele, "https://ollama.com/library/" + m.modele, "carte-modele__lien"));
    identite.append(nom);
    ligne.title = m.raison || ""; // la description reste dans l'infobulle : moins de texte à l'écran
    const poids = creer("span", "ligne-modele__chiffre", poidsModele(m) || "—");
    poids.title = "À télécharger";
    const memoire = creer("span", "ligne-modele__chiffre", m.vram ? `${m.vram} Go` : "—");
    memoire.title = m.ramCPU ? `Carte graphique, ou ≈ ${m.ramCPU} Go de RAM sur le processeur` : "Mémoire de la carte graphique pour tourner";
    const action = creer("div", "ligne-modele__action");
    action.append(boutonModele(m));
    ligne.append(pictogramme, identite, poids, memoire, badgeModele(m), action);
    return ligne;
}

// Poids et mémoire demandée : les mêmes lignes dans la liste et dans la sélection
function infosModele(m) {
    const infos = creer('div', 'carte-modele__infos');
    if (m.taille != null) {
        const poids = m.tailleMax ? go(m.taille) + '–' + go(m.tailleMax) : go(m.taille);
        infos.append(creer('span', '', poids + ' Go à télécharger'));
        infos.append(creer('small', '', '≈ ' + m.vram + ' Go de VRAM pour tourner'));
    }
    if (m.ramCPU) infos.append(creer('small', '', 'CPU · ≈ ' + m.ramCPU + ' Go de RAM'));
    return infos;
}

// Le bout de la carte : « Actif », « Utiliser », « Télécharger », ou ce qui empêche de le faire
function boutonModele(m) {
    const installe = installes.includes(m.modele);
    if (installe && reglages.actif === 'ollama' && modelSel.value === m.modele) return etatModele('Actif', 'is-installe');
    if (!installe) return actionModele(m);
    const action = creer('button', 'bouton-calme', 'Utiliser');
    action.type = 'button';
    action.setAttribute('aria-label', 'Utiliser ' + m.modele);
    // Trop gros pour la carte : il déborde en RAM, rame, et peut faire planter le pilote (vu avec gemma4:12b-it-qat sur 8 Go).
    // Le premier clic prévient, le second confirme.
    const tropGros = !!(m.vram && catalogue?.vramGo && m.vram > catalogue.vramGo);
    let prevenu = false;
    action.addEventListener('click', async () => {
        // Une réponse locale en cours garde son modèle ; on attend sa fin pour ne pas recharger Ollama sous ses pieds
        if (fluxLocalEnCours()) { $("#modeles-etat").textContent = 'Attends la fin de la réponse avant de changer de modèle.'; return; }
        if (tropGros && !prevenu) {
            prevenu = true;
            action.textContent = 'Utiliser quand même';
            action.classList.add('is-risque');
            $("#modeles-etat").textContent = `${m.modele} demande environ ${m.vram} Go et ta carte en a ${catalogue.vramGo} : il sera lent, et il peut faire planter le pilote de la carte graphique.`;
            return;
        }
        try {
            const r = await window.api.choisirFournisseur({ id: "ollama", modele: m.modele });
            if (!r.ok) throw new Error(r.erreur || 'Choix impossible.');
            reglages = r.reglages;
            fournisseurSel.value = "ollama";
            await loadModels(m.modele);
            if (modelSel.value !== m.modele) throw new Error("Ce modèle n’est plus disponible dans Ollama.");
            voirPage('discussion');
        } catch (err) { $("#modeles-etat").textContent = err.message; }
    });
    return action;
}

/* La sélection Cat Ai : le modèle conseillé pour ce PC et ce qu'il sait déjà faire, puis les spécialistes
   qui apportent vraiment quelque chose sur ce PC. Chaque spécialiste prend le premier candidat qui tient
   (du plus fort au plus léger). Ce qui demande une plus grosse carte tient en une seule ligne. */
const SPECIALISTES = [
    { id: "code", court: "Coder", pour: "le code", icone: "code", candidats: ["qwen3.6:27b", "qwen3.5:9b", "qwen2.5-coder:7b", "qwen3.5:4b"] },
    { id: "images", court: "Images", pour: "les images", icone: "image", candidats: ["gemma4:12b", "qwen3.5:9b", "gemma4:e4b-it-qat", "qwen3.5:4b", "qwen3.5:2b"] },
    { id: "reflexion", court: "Réfléchir", pour: "réfléchir", icone: "ampoule", candidats: ["gpt-oss:20b", "qwen3:14b", "qwen3.5:9b", "qwen3.5:4b"] },
];
// Pourquoi ce spécialiste, en quelques mots
const RAISON_SPECIALISTE = {
    "code:qwen3.6:27b": "Le plus fort pour le code, avec les outils",
    "code:qwen2.5-coder:7b": "Spécialisé en code",
    "images:gemma4:12b": "Lit bien les captures et les photos",
    "images:gemma4:e4b-it-qat": "Voit les images dans 3 Go de carte",
    "reflexion:gpt-oss:20b": "Réfléchit longtemps avant de répondre",
    "reflexion:qwen3:14b": "Raisonne bien sur les tâches longues",
};

function choisirSpecialiste(specialiste, fiches, principal) {
    const candidats = specialiste.candidats.map((nom) => fiches.find((f) => f.modele === nom)).filter(Boolean);
    const choix = candidats.find((f) => f.evaluation.adapte && f.evaluation.classe !== "avis--lent") || null;
    const plusFort = candidats[0] && candidats[0] !== choix ? candidats[0] : null;
    return { choix, plusFort, deja: !!(choix && principal && choix.modele === principal.modele) };
}

function badgeModele(m) {
    const b = creer("span", "avis " + m.evaluation.classe, m.evaluation.label);
    b.title = m.evaluation.detail;
    return b;
}

function nomModele(m, classe) {
    const nom = creer("h4", classe);
    nom.append(lienExterne(m.modele, "https://ollama.com/library/" + m.modele, "carte-modele__lien"));
    return nom;
}

const poidsModele = (m) => m.taille == null ? "" : (m.tailleMax ? go(m.taille) + "–" + go(m.tailleMax) : go(m.taille)) + " Go";

function dessinerSelection(fiches) {
    const principal = fiches.find((f) => f.modele === catalogue.modeles.find((m) => m.conseille)?.modele);
    const resultats = SPECIALISTES.map((s) => ({ s, ...choisirSpecialiste(s, fiches, principal) }));
    const zone = $("#selection-principal");
    zone.replaceChildren();
    if (principal) {
        const carte = creer("article", "selection__principal");
        const pictogramme = creer("span", "selection__icone");
        pictogramme.innerHTML = icone("etoile");
        const corps = creer("div", "selection__corps");
        const tete = creer("div", "selection__ligne");
        tete.append(creer("span", "selection__etiquette", "Pour ton PC"), badgeModele(principal));
        // Ce que le modèle conseillé couvre déjà : pas besoin d'un autre modèle pour ça
        const usages = creer("ul", "selection__usages");
        usages.setAttribute("aria-label", "Ce qu'il sait faire");
        for (const texte of ["Discuter", ...resultats.filter((r) => r.deja).map((r) => r.s.court)]) {
            const li = creer("li", "selection__usage");
            li.innerHTML = icone("coche");
            li.append(texte);
            usages.append(li);
        }
        corps.append(tete, nomModele(principal, "selection__nom"), usages);
        const action = creer("div", "selection__action");
        action.append(creer("span", "selection__poids", poidsModele(principal)), boutonModele(principal));
        carte.append(pictogramme, corps, action);
        zone.append(carte);
    }
    // Les spécialistes qui tiennent sur ce PC et font mieux que le modèle conseillé
    const utiles = resultats.filter((r) => r.choix && !r.deja);
    const liste = $("#selection-specialistes");
    liste.hidden = !utiles.length;
    liste.replaceChildren(...utiles.map(({ s, choix }) => {
        const li = creer("li", "specialiste");
        const pictogramme = creer("span", "specialiste__icone");
        pictogramme.innerHTML = icone(s.icone);
        const corps = creer("div", "specialiste__corps");
        const ligne = creer("div", "selection__ligne");
        ligne.append(creer("span", "selection__etiquette", s.court), badgeModele(choix));
        corps.append(ligne, nomModele(choix, "specialiste__nom"), creer("p", "specialiste__raison", RAISON_SPECIALISTE[`${s.id}:${choix.modele}`] || choix.raison));
        const action = creer("div", "selection__action");
        action.append(creer("span", "selection__poids", poidsModele(choix)), boutonModele(choix));
        li.append(pictogramme, corps, action);
        return li;
    }));
    // Une seule ligne pour ce qu'une plus grosse carte apporterait
    const plusLoin = resultats.filter((r) => r.plusFort).map((r) => `${r.plusFort.modele} pour ${r.s.pour} (${r.plusFort.vram} Go)`);
    // Ce qu'une plus grosse carte apporterait : dans l'infobulle de la carte principale, pas en texte de plus
    $("#selection-plus-loin").hidden = true;
    const principale = $("#selection-principal .selection__principal");
    if (principale && plusLoin.length) principale.title = "Avec une plus grosse carte : " + plusLoin.join(" · ");
}

async function telechargerDepuisPage(modele) {
    if (enTelechargement || telechargement) return;
    enTelechargement = modele;
    telechargement = true; // la carte de l'accueil ne doit pas se redessiner pendant ce temps
    dessinerModeles();
    let r;
    try { r = await window.api.telechargerModele(modele); }
    catch (err) { r = { ok: false, erreur: err.message }; }
    finally { enTelechargement = ""; telechargement = false; }
    $("#modeles-progression").textContent = r.ok ? `${modele} est installé.` : `Le téléchargement de ${modele} a échoué : ${r.erreur}`;
    await loadModels();
    await ouvrirModeles();
}

// Même progression que sur l'accueil.
window.api.onProgressionOllama(({ fait = 0, total }) => {
    if (enTelechargement) $("#modeles-progression").textContent = `${enTelechargement} · ${total ? Math.floor(fait / total * 100) + ' %' : 'Préparation…'}`;
});

async function ouvrirModeles() {
    const ouverture = ++ouvertureCatalogue;
    $("#modeles-etat").textContent = 'Chargement de la bibliothèque…';
    const [cat, liste] = await Promise.all([window.api.catalogueModeles(), window.api.models("ollama")]);
    if (ouverture !== ouvertureCatalogue) return;
    catalogue = cat;
    ollamaLa = liste.ok;
    installes = liste.ok ? liste.models : [];
    if (pageOuverte === "modeles") dessinerModeles();
}
