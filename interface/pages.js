/* ==========================================================
   Cat Ai — les pages : Discussion, Agents, Modèles.
   Chargé après renderer.js : il se sert de $, reglages, icone, loadModels…
   10. Navigation   11. Page Agents   12. Page Modèles
   ========================================================== */

/* ---------- 10. Navigation ---------- */
const PAGES = { agents: $("#page-agents"), modeles: $("#page-modeles") };
let pageOuverte = "discussion";

document.querySelectorAll("[data-icone]").forEach((el) => { el.innerHTML = icone(el.dataset.icone); });

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
    relecteur: { icone: "lunettes", couleur: "rose", role: "Compare le changement à la consigne : il accepte ou refuse." }
};
let equipe = null;          // { agents: [{ id, type, nom, parent, fournisseur, modele, ajouts… }], types }
let agentOuvert = "chef";
let menuAjout = "";         // id de l'agent dont le menu « + » est ouvert
const modelesParFournisseur = {}; // demandés une fois par ouverture de la page

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
    const genre = GENRES[agent.type];
    const carte = creer("div", "noeud" + (agent.id === agentOuvert ? " is-ouvert" : ""));
    const bouton = creer("button", "noeud__carte");
    bouton.type = "button";
    bouton.title = `${agent.nom} · ${sousTitre(agent)}`;
    bouton.setAttribute("aria-pressed", String(agent.id === agentOuvert));
    bouton.innerHTML = `<span class="menu-icone menu-icone--${genre.couleur}">${icone(genre.icone)}</span>`
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
                choix.innerHTML = `<span class="menu-icone menu-icone--petite menu-icone--${GENRES[type].couleur}">${icone(GENRES[type].icone)}</span>${escape(equipe.types[type])}`;
                choix.title = GENRES[type].role;
                choix.addEventListener("click", () => changerEquipe(window.api.ajouterAgent(agent.id, type), true));
                menu.appendChild(choix);
            }
            carte.appendChild(menu);
        }
    }
    li.appendChild(carte);
    const dessous = equipe.agents.filter((a) => a.parent === agent.id);
    if (dessous.length) {
        const ul = creer("ul");
        dessous.forEach((a) => ul.appendChild(dessinerNoeud(a)));
        li.appendChild(ul);
    }
    return li;
}

function dessinerToile() {
    const arbre = creer("ul", "arbre");
    arbre.appendChild(dessinerNoeud(equipe.agents.find((a) => a.type === "chef")));
    $("#toile").replaceChildren(arbre);
}

// Une ligne de conseil, seulement quand le choix a une conséquence
function conseilAgent(agent) {
    if (!agent.avecModele) return "";
    if (!agent.modele) return "Aucun modèle : installe-en un dans la page Modèles.";
    if (agent.fournisseur !== "ollama") return "En ligne : plus malin, mais chaque étape prend sur ton quota gratuit.";
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
    const genre = GENRES[agent.type];
    const fiche = $("#fiche");
    const tete = creer("div", "fiche__tete");
    tete.innerHTML = `<span class="menu-icone menu-icone--${genre.couleur}">${icone(genre.icone)}</span><span><span class="fiche__genre">${escape(equipe.types[agent.type])}</span><span class="fiche__role">${escape(genre.role)}</span></span>`;
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
        // Un codeur reste sur le PC : sinon un long chantier viderait le quota gratuit du jour
        const possibles = reglages.fournisseurs.filter((f) => !agent.local || f.type === "ollama");
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
    dessinerFiche();
}

// Applique la réponse de l'app à une demande de changement. Renvoie true, ou le message d'erreur.
async function changerEquipe(demande, ouvrirNouveau = false) {
    const r = await demande;
    if (!r.ok) return r.erreur || "Ça n'a pas marché.";
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
const JOURNAL_MAX = 300;

function majChantier(etat) {
    $("#chantier-lancer").textContent = chantierTourne ? "Arrêter" : "Lancer";
    $("#chantier-lancer").classList.toggle("is-stop", chantierTourne);
    $("#chantier-importer").hidden = chantierTourne;
    $("#chantier-plan").readOnly = chantierTourne;
    if (!etat) return;
    const dossier = $("#chantier-dossier");
    dossier.textContent = etat.projet ? `Dans ${etat.projet}` : "Ouvre d'abord le dossier de ton projet, avec le bouton Dossier sous la saisie.";
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

window.api.onChantier((e) => {
    if (e.type === "etape") {
        $("#chantier-etape").textContent = `Étape ${e.i} sur ${e.n} · ${e.titre}`;
        $("#chantier-barre").style.width = `${Math.round(((e.i - 1) / e.n) * 100)}%`;
        ligneJournal(`Étape ${e.i} : ${e.titre}`, "is-etape");
    } else if (e.type === "info") ligneJournal(e.texte, /échec|refusée|abandonnée|indisponible|Attention/.test(e.texte) ? "is-alerte" : "");
});

async function lancerOuArreter() {
    const statut = $("#chantier-statut");
    if (chantierTourne) { statut.textContent = "Arrêt demandé…"; window.api.arreterChantier(); return; }
    chantierTourne = true;
    statut.textContent = "";
    $("#chantier-fin").hidden = true;
    $("#chantier-suivi").hidden = false;
    $("#chantier-journal").replaceChildren();
    $("#chantier-etape").textContent = "Le chef découpe le plan…";
    $("#chantier-barre").style.width = "0%";
    majChantier();
    const r = await window.api.lancerChantier($("#chantier-plan").value);
    chantierTourne = false;
    majChantier(await window.api.etatChantier());
    if (!r.ok) {
        statut.textContent = r.erreur;
        if (!$("#chantier-journal").children.length) $("#chantier-suivi").hidden = true;
        return;
    }
    const faites = r.etapes.filter((e) => e.ok).length;
    $("#chantier-barre").style.width = `${r.etapes.length ? Math.round((faites / r.etapes.length) * 100) : 0}%`;
    $("#chantier-etape").textContent = `${r.arrete ? "Arrêté" : "Terminé"} en ${r.minutes} min · ${faites} étape${faites > 1 ? "s" : ""} faite${faites > 1 ? "s" : ""}`;
    // Dans l'app, les commandes git du rapport ne servent pas : les boutons Garder et Jeter les remplacent
    $("#chantier-rapport").textContent = r.rapport.split("\n\nLe travail est sur la branche")[0].replace(/^# Rapport du chantier\n+/, "") + (r.changements ? `\n\nFichiers changés :\n${r.changements}` : "");
    $("#chantier-suite").textContent = "";
    $("#chantier-garder").hidden = !faites;
    $("#chantier-fin").hidden = false;
    chantierFini = r.nom;
}

$("#chantier-lancer").addEventListener("click", lancerOuArreter);

$("#chantier-importer").addEventListener("click", async () => {
    const plan = await window.api.importerPlan();
    if (!plan) return;
    if (plan.erreur) { $("#chantier-statut").textContent = plan.erreur; return; }
    $("#chantier-plan").value = plan.texte;
    $("#chantier-statut").textContent = `${plan.nom} chargé.`;
});

$("#chantier-preparer").addEventListener("click", async () => {
    const r = await window.api.preparerChantier();
    if (r.annule) return;
    $("#chantier-statut").textContent = r.ok ? "Dossier prêt." : r.erreur;
    majChantier(await window.api.etatChantier());
});

async function finirChantier(action, fait) {
    if (!chantierFini) return;
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
    ["deepseek-r1:8b", "Maths et raisonnement étape par étape", "modeleDeepSeek"],
    ["gpt-oss:20b", "Raisonnement et tâches avec outils", "modeleOpenAI"],
    ["qwen3.6:27b", "Code avec outils et raisonnement sur une machine puissante", "modeleQwen"],
    ["qwen3.6:35b", "Code avec outils et analyse d’images", "modeleQwen"]
];

const go = (n) => String(n).replace(".", ",");
const filtreAdaptes = $("#modeles-adaptes");
filtreAdaptes.addEventListener("click", () => {
    const actif = filtreAdaptes.getAttribute("aria-pressed") !== "true";
    filtreAdaptes.setAttribute("aria-pressed", String(actif));
    dessinerModeles();
});

function evaluerModele({ vram, ramCPU, avis, conseille }, { vramGo, ramGo }) {
    if (vramGo >= vram) {
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

function dessinerModeles() {
    if (!catalogue) return;
    const { vramGo, ramGo, disqueGo, modeles } = catalogue;
    $("#infos-pc").replaceChildren(
        creer("span", "info-pc", vramGo ? vramGo + " Go de VRAM" : "VRAM inconnue"),
        creer("span", "info-pc", ramGo + " Go de RAM"),
        ...(disqueGo === null ? [] : [creer("span", "info-pc", disqueGo + " Go libres")])
    );
    $("#modeles-etat").textContent = ollamaLa ? "" : "Lance Ollama pour utiliser ou télécharger un modèle.";
    const modelesConnus = new Map(modeles.map(m => [m.modele, m]));
    const selection = MODELES_SELECTION.map(([modele, raison, pictogramme, ramCPU, budgetVRAM]) => {
        const fiche = modelesConnus.get(modele);
        const m = { ...fiche, modele, raison, pictogramme, ramCPU, vram: budgetVRAM ?? fiche.vram };
        return { ...m, evaluation: evaluerModele(m, catalogue) };
    });
    filtreAdaptes.hidden = false;
    const filtre = filtreAdaptes.getAttribute("aria-pressed") === "true";
    const visibles = filtre ? selection.filter(m => m.evaluation.adapte) : selection;
    $("#modeles-filtre-etat").textContent = filtre ? visibles.length + " modèles adaptés sur " + selection.length + "." : "";
    $("#modeles-liste").replaceChildren(...visibles.map(carteCatalogue));
    if (!visibles.length) {
        $("#modeles-liste").append(creer("li", "modele", "Aucun modèle adapté détecté. Désactive le filtre pour tout voir."));
    }
}

function carteCatalogue(m) {
    const installe = installes.includes(m.modele);
    const carte = creer('li', 'modele carte-modele');
    const identite = creer('div', 'carte-modele__identite');
    const pictogramme = creer('span', 'carte-modele__icone');
    pictogramme.innerHTML = icone(m.pictogramme);
    identite.append(pictogramme);
    const description = creer('div', 'carte-modele__description');
    const titre = creer('div', 'carte-modele__titre');
    const nom = creer('h3', 'carte-modele__nom');
    nom.append(lienExterne(m.modele, 'https://ollama.com/library/' + m.modele, 'carte-modele__lien'));
    titre.append(nom);
    const avis = creer('span', 'avis ' + m.evaluation.classe, m.evaluation.label);
    avis.title = m.evaluation.detail;
    titre.append(avis);
    const actif = installe && reglages.actif === 'ollama' && modelSel.value === m.modele;
    description.append(titre, creer('p', 'carte-modele__specialite', m.raison));
    identite.append(description);
    carte.append(identite);
    const pied = creer('div', 'carte-modele__pied');
    const infos = creer('div', 'carte-modele__infos');
    const poids = m.tailleMax ? go(m.taille) + '–' + go(m.tailleMax) : go(m.taille);
    infos.append(creer('span', '', poids + ' Go à télécharger'));
    infos.append(creer('small', '', '≈ ' + m.vram + ' Go de VRAM'));
    if (m.ramCPU) infos.append(creer('small', '', 'CPU · ≈ ' + m.ramCPU + ' Go de RAM'));
    let action;
    if (actif) action = etatModele('Actif', 'is-installe');
    else if (installe) {
        action = creer('button', 'bouton-calme', 'Utiliser');
        action.type = 'button';
        action.setAttribute('aria-label', 'Utiliser ' + m.modele);
        action.addEventListener('click', async () => {
            if (streaming) { $("#modeles-etat").textContent = 'Attends la fin de la réponse avant de changer de modèle.'; return; }
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
    } else action = actionModele(m);
    pied.append(infos, action);
    carte.append(pied);
    return carte;
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
