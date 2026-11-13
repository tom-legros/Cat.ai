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
    document.querySelectorAll(".nav__lien").forEach((b) => b.classList.toggle("is-actif", b.dataset.page === pageOuverte));
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
    for (const id of Object.keys(modelesParFournisseur)) delete modelesParFournisseur[id];
    equipe = await window.api.lireEquipe();
    if (!agentDe(agentOuvert)) agentOuvert = "chef";
    await donnerModelesManquants();
}


/* ---------- 12. Page Modèles ---------- */
const AVIS = {
    conseille: { texte: "Conseillé", classe: "avis--conseille" },
    ok: { texte: "Rapide", classe: "avis--ok" },
    lent: { texte: "Lent chez toi", classe: "avis--lent" },
    trop: { texte: "Trop gros", classe: "avis--trop" }
};
const USAGES = { tous: "Tous", general: "Général", code: "Code", images: "Images", reflexion: "Réflexion", installes: "Installés" };
let catalogue = null;       // { vramGo, ramGo, disqueGo, modeles }
let installes = [];         // modèles déjà dans Ollama
let ollamaLa = false;
let usageChoisi = "tous";
let enTelechargement = "";  // nom du modèle en cours, vide sinon
let ligneEnCours = null;    // { barre, texte } de la ligne qui télécharge

const go = (n) => String(n).replace(".", ",");

function ligneModele({ modele, detail, avis, action }) {
    const li = creer("li", "modele");
    const texte = creer("div", "modele__texte");
    texte.append(creer("p", "modele__nom", modele), creer("p", "modele__detail", detail));
    li.appendChild(texte);
    if (avis) li.appendChild(creer("span", `avis ${AVIS[avis].classe}`, AVIS[avis].texte));
    li.appendChild(action);
    if (modele === enTelechargement) {
        const suivi = creer("div", "modele__suivi");
        suivi.innerHTML = '<div class="barre"><div class="barre__pleine"></div></div><p class="modele__detail">Ça démarre…</p>';
        li.appendChild(suivi);
        ligneEnCours = { barre: suivi.querySelector(".barre__pleine"), texte: suivi.querySelector("p") };
    }
    return li;
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
    if (installes.includes(m.modele)) return etatModele("Installé", "is-installe");
    if (m.modele === enTelechargement) return etatModele("En cours");
    if (m.avis === "trop") return etatModele(`${m.vram} Go requis`);
    if (catalogue.disqueGo !== null && m.taille > catalogue.disqueGo) return etatModele("Disque plein");
    if (!ollamaLa || enTelechargement || telechargement) return etatModele("");
    return boutonTelecharger(m.modele);
}

function dessinerFiltres() {
    const filtres = $("#filtres");
    filtres.replaceChildren();
    for (const [id, texte] of Object.entries(USAGES)) {
        const b = creer("button", "filtre" + (id === usageChoisi ? " is-actif" : ""), texte);
        b.type = "button";
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", String(id === usageChoisi));
        b.addEventListener("click", () => { usageChoisi = id; dessinerModeles(); });
        filtres.appendChild(b);
    }
}

function dessinerModeles() {
    ligneEnCours = null;
    const { vramGo, ramGo, disqueGo, modeles } = catalogue;
    $("#infos-pc").replaceChildren(
        creer("span", "info-pc", vramGo ? `Carte ${vramGo} Go` : "Pas de carte graphique"),
        creer("span", "info-pc", `Mémoire ${ramGo} Go`),
        ...(disqueGo === null ? [] : [creer("span", "info-pc", `Disque ${disqueGo} Go libres`)])
    );
    dessinerFiltres();
    $("#modeles-etat").textContent = ollamaLa ? "" : "Ollama ne répond pas : lance-le pour télécharger un modèle.";
    const liste = $("#modeles-liste");
    liste.replaceChildren();
    // Dans l'ordre utile : le conseillé, les rapides, les lents, puis ceux qui ne tiennent pas ; les plus gros d'abord
    const rang = (m) => (m.conseille ? 0 : ["ok", "lent", "trop"].indexOf(m.avis) + 1);
    const garde = (m) => usageChoisi === "tous" || (usageChoisi === "installes" ? installes.includes(m.modele) : m.usage === usageChoisi);
    for (const m of modeles.filter(garde).sort((a, b) => rang(a) - rang(b) || b.taille - a.taille)) {
        liste.appendChild(ligneModele({ modele: m.modele, detail: `${go(m.taille)} Go · ${m.raison}`, avis: m.conseille ? "conseille" : m.avis, action: actionModele(m) }));
    }
    // Ceux que l'utilisateur a installés lui-même, hors de la liste connue
    if (usageChoisi === "tous" || usageChoisi === "installes") {
        const connus = modeles.map((m) => m.modele);
        for (const nom of [...installes, enTelechargement].filter((n, i, tous) => n && !connus.includes(n) && tous.indexOf(n) === i)) {
            const enCours = nom === enTelechargement && !installes.includes(nom);
            liste.appendChild(ligneModele({ modele: nom, detail: "Ajouté par toi", avis: null, action: enCours ? etatModele("En cours") : etatModele("Installé", "is-installe") }));
        }
    }
    if (!liste.children.length) liste.appendChild(creer("li", "modele modele--vide", "Rien ici pour l'instant."));
}

async function telechargerDepuisPage(modele) {
    if (enTelechargement || telechargement) return;
    enTelechargement = modele;
    telechargement = true; // la carte de l'accueil ne doit pas se redessiner pendant ce temps
    dessinerModeles();
    const r = await window.api.telechargerModele(modele);
    enTelechargement = "";
    telechargement = false;
    $("#autre-modele-etat").textContent = r.ok ? `${modele} est installé.` : `Le téléchargement de ${modele} a échoué : ${r.erreur}`;
    await loadModels();
    await ouvrirModeles();
}

// Même progression que sur l'accueil, affichée dans la ligne du modèle
window.api.onProgressionOllama(({ statut = "", fait = 0, total }) => {
    if (!ligneEnCours) return;
    const part = total ? Math.floor((fait / total) * 100) : 0;
    if (total) ligneEnCours.barre.style.width = `${part}%`;
    ligneEnCours.texte.textContent = total
        ? `${part} % de ${go((total / 1e9).toFixed(1))} Go`
        : statut === "success" ? "Terminé." : /verif/i.test(statut) ? "Vérification…" : "Préparation…";
});

$("#autre-modele").addEventListener("submit", (e) => {
    e.preventDefault();
    const nom = $("#autre-modele-nom").value.trim().toLowerCase();
    const etat = $("#autre-modele-etat");
    if (!/^[\w.-]+(:[\w.-]+)?$/.test(nom)) { etat.textContent = "Écris le nom comme sur ollama.com, par exemple gemma3:4b."; return; }
    if (installes.includes(nom)) { etat.textContent = `${nom} est déjà installé.`; return; }
    if (!ollamaLa) { etat.textContent = "Ollama ne répond pas."; return; }
    if (enTelechargement || telechargement) { etat.textContent = "Un téléchargement est déjà en cours."; return; }
    etat.textContent = "";
    $("#autre-modele-nom").value = "";
    usageChoisi = "tous";
    telechargerDepuisPage(nom);
});

$("#lien-ollama").appendChild(lienExterne("Voir ollama.com", "https://ollama.com/search", "lien lien--petit"));

async function ouvrirModeles() {
    const [cat, liste] = await Promise.all([window.api.catalogueModeles(), window.api.models("ollama")]);
    catalogue = cat;
    ollamaLa = liste.ok;
    installes = liste.ok ? liste.models : [];
    if (pageOuverte === "modeles") dessinerModeles();
}
