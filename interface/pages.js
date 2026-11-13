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


/* ---------- 11. Page Agents ---------- */
const AGENTS = {
    chef: { nom: "Chef", icone: "couronne", role: "Il découpe ton plan en étapes, une par une." },
    ouvrier: { nom: "Ouvrier", icone: "marteau", role: "Il écrit le code de chaque étape, dans une copie à part de ton projet." },
    verificateur: { nom: "Vérificateur", icone: "coche", role: "Après les tests de ton projet, il relit le changement et dit si l'étape est bonne." }
};
const COMME_LE_CHEF = "comme-le-chef";
let roles = null;
let agentOuvert = "chef";
const modelesParFournisseur = {}; // { ollama: ["qwen3:8b", …] }, demandés une fois par ouverture de la page

const nomFournisseur = (id) => reglages.fournisseurs.find((f) => f.id === id)?.nom || id;

async function modelesDe(fournisseurId) {
    if (!modelesParFournisseur[fournisseurId]) {
        const r = await window.api.models(fournisseurId);
        if (!r.ok) return [];
        modelesParFournisseur[fournisseurId] = r.models;
    }
    return modelesParFournisseur[fournisseurId];
}

function dessinerSchema() {
    const schema = $("#schema");
    schema.replaceChildren();
    Object.entries(AGENTS).forEach(([id, agent], i) => {
        if (i) {
            const fleche = document.createElement("span");
            fleche.className = "schema__fleche";
            fleche.innerHTML = icone("fleche");
            schema.appendChild(fleche);
        }
        const choix = roles[id];
        const bouton = document.createElement("button");
        bouton.type = "button";
        bouton.className = "agent" + (id === agentOuvert ? " is-ouvert" : "");
        bouton.setAttribute("aria-pressed", String(id === agentOuvert));
        const qui = id === "verificateur" && roles.verificateurCommeChef ? "Les tests, puis le chef" : `${nomFournisseur(choix.fournisseur)} · ${choix.modele || "aucun modèle"}`;
        bouton.innerHTML = `<span class="agent__nom">${icone(agent.icone)}${escape(agent.nom)}</span><span class="agent__qui">${escape(qui)}</span>`;
        bouton.addEventListener("click", () => { agentOuvert = id; dessinerAgents(); });
        schema.appendChild(bouton);
    });
}

// Le conseil sous les listes : ce que le choix change vraiment pour un chantier de plusieurs heures
function conseilAgent(id) {
    const choix = roles[id];
    if (id === "verificateur" && roles.verificateurCommeChef) return "Le chef relit lui-même : c'est le plus simple.";
    if (!choix.modele) return "Aucun modèle choisi : installe-en un dans la page Modèles.";
    if (choix.fournisseur !== "ollama") return "En ligne : plus malin pour découper et relire. Chaque étape lui coûte quelques messages de ton quota gratuit.";
    if (id === "ouvrier") return "Sur ton PC : aucune limite, il peut coder pendant des heures.";
    if (choix.modele !== roles.ouvrier.modele) return "Deux modèles différents sur ton PC : Ollama les échange à chaque étape, c'est plus lent.";
    return "Sur ton PC : aucune limite, mais il relit moins bien qu'un modèle en ligne.";
}

async function dessinerFiche() {
    const id = agentOuvert;
    const agent = AGENTS[id];
    const choix = roles[id];
    $("#agent-titre").textContent = agent.nom;
    $("#agent-role").textContent = agent.role;
    const selFournisseur = $("#agent-fournisseur");
    const selModele = $("#agent-modele");
    const commeChef = id === "verificateur" && roles.verificateurCommeChef;
    // L'ouvrier reste sur le PC : sinon un long chantier viderait le quota gratuit du jour
    const possibles = reglages.fournisseurs.filter((f) => (id === "ouvrier" ? f.type === "ollama" : true));
    selFournisseur.innerHTML = (id === "verificateur" ? `<option value="${COMME_LE_CHEF}">Comme le chef</option>` : "")
        + possibles.map((f) => `<option value="${escape(f.id)}"${f.aCle ? "" : " disabled"}>${escape(f.nom)}${f.aCle ? "" : " (pas de clé)"}</option>`).join("");
    selFournisseur.value = commeChef ? COMME_LE_CHEF : choix.fournisseur;
    selFournisseur.disabled = id === "ouvrier";
    selModele.disabled = commeChef;
    const modeles = await modelesDe(choix.fournisseur);
    if (id !== agentOuvert) return; // un autre agent a été ouvert pendant la requête
    const liste = choix.modele && !modeles.includes(choix.modele) ? [choix.modele, ...modeles] : modeles;
    selModele.innerHTML = liste.map((m) => `<option value="${escape(m)}">${escape(m)}</option>`).join("");
    selModele.value = choix.modele;
    const conseil = $("#agent-conseil");
    conseil.textContent = conseilAgent(id);
    conseil.className = "conseil";
}

function dessinerAgents() {
    dessinerSchema();
    dessinerFiche();
}

async function changerAgent(choix) {
    const r = await window.api.changerRole(agentOuvert, choix);
    if (r.ok) {
        roles = r.roles;
        dessinerAgents();
    } else {
        $("#agent-conseil").textContent = r.erreur;
        $("#agent-conseil").className = "conseil is-gourmand";
    }
}

$("#agent-fournisseur").addEventListener("change", async (e) => {
    const fournisseur = e.target.value;
    if (fournisseur === COMME_LE_CHEF) return changerAgent(null);
    const modeles = await modelesDe(fournisseur);
    if (!modeles.length) {
        $("#agent-conseil").textContent = `${nomFournisseur(fournisseur)} ne répond pas, ou n'a aucun modèle.`;
        $("#agent-conseil").className = "conseil is-gourmand";
        return dessinerFiche();
    }
    const retenu = reglages.modeles[fournisseur];
    return changerAgent({ fournisseur, modele: modeles.includes(retenu) ? retenu : modeleParDefaut(modeles, fournisseur) });
});

$("#agent-modele").addEventListener("change", (e) => changerAgent({ fournisseur: roles[agentOuvert].fournisseur, modele: e.target.value }));

async function ouvrirAgents() {
    for (const id of Object.keys(modelesParFournisseur)) delete modelesParFournisseur[id];
    roles = await window.api.lireRoles();
    // Un agent sans modèle (rien n'a encore été choisi) prend celui de la discussion, sinon le conseillé
    for (const id of ["chef", "ouvrier"]) {
        const { fournisseur, modele } = roles[id];
        if (modele) continue;
        const modeles = await modelesDe(fournisseur);
        const choisi = fournisseur === reglages.actif && modeles.includes(modelSel.value) ? modelSel.value : modeleParDefaut(modeles, fournisseur);
        if (!choisi) continue;
        const r = await window.api.changerRole(id, { fournisseur, modele: choisi });
        if (r.ok) roles = r.roles;
    }
    dessinerAgents();
}


/* ---------- 12. Page Modèles ---------- */
const AVIS = {
    conseille: { texte: "Conseillé", classe: "avis--conseille" },
    ok: { texte: "Rapide", classe: "avis--ok" },
    lent: { texte: "Lent chez toi", classe: "avis--lent" },
    trop: { texte: "Trop gros", classe: "avis--trop" }
};
let catalogue = null;       // { vramGo, ramGo, disqueGo, modeles }
let installes = [];         // modèles déjà dans Ollama
let ollamaLa = false;
let enTelechargement = "";  // nom du modèle en cours, vide sinon
let ligneEnCours = null;    // { barre, texte } de la ligne qui télécharge

const go = (n) => String(n).replace(".", ",");

function infoPc(texte) {
    const el = document.createElement("span");
    el.className = "info-pc";
    el.textContent = texte;
    return el;
}

function ligneModele({ modele, detail, avis, action }) {
    const li = document.createElement("li");
    li.className = "modele";
    const texte = document.createElement("div");
    texte.className = "modele__texte";
    texte.innerHTML = `<p class="modele__nom">${escape(modele)}</p><p class="modele__detail">${escape(detail)}</p>`;
    li.appendChild(texte);
    if (avis) {
        const badge = document.createElement("span");
        badge.className = `avis ${AVIS[avis].classe}`;
        badge.textContent = AVIS[avis].texte;
        li.appendChild(badge);
    }
    li.appendChild(action);
    if (modele === enTelechargement) {
        const suivi = document.createElement("div");
        suivi.className = "modele__suivi";
        suivi.innerHTML = '<div class="barre"><div class="barre__pleine"></div></div><p class="modele__detail">Ça démarre…</p>';
        li.appendChild(suivi);
        ligneEnCours = { barre: suivi.querySelector(".barre__pleine"), texte: suivi.querySelector("p") };
    }
    return li;
}

function etatModele(texte) {
    const el = document.createElement("span");
    el.className = "modele__etat";
    el.textContent = texte;
    return el;
}

function boutonTelecharger(modele, pourquoiPas) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "bouton bouton--petit";
    b.textContent = "Télécharger";
    b.disabled = !!pourquoiPas || !!enTelechargement || telechargement;
    if (pourquoiPas) b.title = pourquoiPas;
    b.addEventListener("click", () => telechargerDepuisPage(modele));
    return b;
}

function dessinerModeles() {
    ligneEnCours = null;
    const { vramGo, ramGo, disqueGo, modeles } = catalogue;
    $("#infos-pc").replaceChildren(
        infoPc(vramGo ? `Carte graphique : ${vramGo} Go` : "Carte graphique : non détectée"),
        infoPc(`Mémoire : ${ramGo} Go`),
        ...(disqueGo === null ? [] : [infoPc(`Disque libre : ${disqueGo} Go`)])
    );
    $("#modeles-etat").textContent = ollamaLa ? "" : "Ollama ne répond pas : lance-le (ou installe-le depuis l'accueil) pour télécharger un modèle.";
    const liste = $("#modeles-liste");
    liste.replaceChildren();
    // Dans l'ordre utile : le conseillé, les rapides, les lents, puis ceux qui ne tiennent pas
    const rang = (m) => (m.conseille ? 0 : ["ok", "lent", "trop"].indexOf(m.avis) + 1);
    for (const m of [...modeles].sort((a, b) => rang(a) - rang(b))) {
        const installe = installes.includes(m.modele);
        const manquePlace = disqueGo !== null && m.taille > disqueGo;
        const pourquoiPas = !ollamaLa ? "Ollama ne répond pas"
            : m.avis === "trop" ? `Il lui faut ${m.vram} Go de carte graphique`
                : manquePlace ? "Pas assez de place sur le disque" : "";
        liste.appendChild(ligneModele({
            modele: m.modele,
            detail: `${go(m.taille)} Go · ${m.avis === "trop" ? `il lui faut ${m.vram} Go de carte graphique` : m.raison}`,
            avis: m.conseille ? "conseille" : m.avis,
            action: installe ? etatModele("Installé") : m.modele === enTelechargement ? etatModele("En cours") : boutonTelecharger(m.modele, pourquoiPas)
        }));
    }
    // Ceux que l'utilisateur a installés lui-même, hors de la liste connue
    const connus = modeles.map((m) => m.modele);
    for (const nom of [...installes, enTelechargement].filter((n, i, tous) => n && !connus.includes(n) && tous.indexOf(n) === i)) {
        liste.appendChild(ligneModele({ modele: nom, detail: "Ajouté par toi", avis: null, action: etatModele(nom === enTelechargement && !installes.includes(nom) ? "En cours" : "Installé") }));
    }
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
    if (!/^[\w.-]+(:[\w.-]+)?$/.test(nom)) { etat.textContent = "Écris le nom comme sur ollama.com, par exemple « gemma3:4b »."; return; }
    if (installes.includes(nom)) { etat.textContent = `${nom} est déjà installé.`; return; }
    if (!ollamaLa) { etat.textContent = "Ollama ne répond pas."; return; }
    if (enTelechargement || telechargement) { etat.textContent = "Un téléchargement est déjà en cours."; return; }
    etat.textContent = "";
    $("#autre-modele-nom").value = "";
    telechargerDepuisPage(nom);
});

$("#lien-ollama").appendChild(lienExterne("ollama.com", "https://ollama.com/search", "lien lien--texte"));

async function ouvrirModeles() {
    const [cat, liste] = await Promise.all([window.api.catalogueModeles(), window.api.models("ollama")]);
    catalogue = cat;
    ollamaLa = liste.ok;
    installes = liste.ok ? liste.models : [];
    if (pageOuverte === "modeles") dessinerModeles();
}
