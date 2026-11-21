/* ==========================================================
   Cat Ai — interface
   3. Blocs de code   4. Messages et discussions   5. Envoi   6. Grand chat de l'accueil
   7. Projet   8. Mémoire   9. Démarrage
   Chargés avant ce fichier (dossier interface/) : 1. personnalité et consignes,
   2. rendu Markdown, choix des modèles, calcul de la différence avant / après.
   ========================================================== */

const $ = (s) => document.querySelector(s);
const messagesEl = $("#messages");
const welcomeEl = $("#welcome");
const input = $("#input");
const sendBtn = $("#send");
const majEnvoi = () => sendBtn.classList.toggle("is-pret", !!$("#input").value.trim());
$("#input").addEventListener("input", majEnvoi);
const modelSel = $("#model");
const statusEl = $("#status");
const convList = $("#conv-list");

let perso = {};           // touches personnelles de perso.json (voir appliquerPerso)
let prenom = "";         // demandé au premier lancement, enregistré dans settings.json
let convs = [];
let current = null;
// L'état des réponses est par discussion : fluxParConv/preparations en section « Envoi »
let memory = [];
let project = null;
let knownProjects = [];
let specialDirs = {};
let prof = false;
let pieces = [];          // fichiers glissés, en attente d'envoi : { nom, contenu }
// Chaque discussion garde son brouillon (texte tapé et pièces jointes) quand on en ouvre une autre.
// Clé : la discussion, ou null pour la nouvelle discussion pas encore envoyée.
const brouillons = new Map();
let convDuBrouillon = null; // la discussion à qui appartient ce qui est dans la saisie
let convAffichee = null;    // la discussion dessinée : on n'anime la colonne que si elle change
let messagesEnvoyes = 0;  // depuis l'ouverture de l'app


/* ---------- 3. Blocs de code : copier et enregistrer ---------- */
const NOMS_PAR_LANGAGE = { html: "index.html", css: "style.css", javascript: "script.js", js: "script.js", php: "index.php", python: "main.py", py: "main.py", cpp: "main.cpp", "c++": "main.cpp", gdscript: "script.gd", json: "data.json" };

// Devine le nom du fichier : le dernier nom cité avant le bloc, sinon d'après le langage
function devinerNom(bloc) {
    const avant = bloc.closest(".bulle-msg").textContent.split(bloc.textContent)[0].slice(-300);
    const noms = avant.match(/[\w-]+\.(html|css|js|php|py|cpp|h|gd|json|md|txt)\b/gi);
    return noms ? noms[noms.length - 1] : NOMS_PAR_LANGAGE[bloc.dataset.lang.toLowerCase()] || "fichier.txt";
}

function messageTemporaire(bouton, texte, initial) {
    clearTimeout(bouton._temporaire);
    bouton.textContent = texte;
    bouton._temporaire = setTimeout(() => (bouton.textContent = initial), 1800);
}

messagesEl.addEventListener("click", async (e) => {
    const bloc = e.target.closest(".code");
    if (!bloc) return;

    if (e.target.classList.contains("copier-btn")) {
        try {
            await navigator.clipboard.writeText(bloc.querySelector("code").textContent);
            messageTemporaire(e.target, "Copié", "Copier");
        } catch {
            messageTemporaire(e.target, "Copie impossible", "Copier");
        }
    }

    if (e.target.classList.contains("enregistrer-btn")) {
        if (!project) { messageTemporaire(e.target, "Ouvre un dossier d'abord", "Enregistrer"); return; }
        const tete = bloc.querySelector(".code__tete");
        if (tete.querySelector("form")) return;
        // Un champ apparaît dans l'en-tête pour choisir le nom du fichier
        const form = document.createElement("form");
        form.className = "enregistrer";
        const champ = document.createElement("input");
        champ.value = devinerNom(bloc);
        const ok = document.createElement("button");
        ok.textContent = "OK";
        form.append(champ, ok);
        tete.firstElementChild.replaceWith(form);
        champ.focus();
        champ.select();
        form.onsubmit = async (ev) => {
            ev.preventDefault();
            const res = await window.api.saveCode({ chemin: champ.value.trim(), contenu: bloc.querySelector("code").textContent + "\n" });
            const etiquette = document.createElement("span");
            etiquette.textContent = res.message;
            form.replaceWith(etiquette);
        };
    }
});


/* ---------- 4. Messages et discussions ---------- */
// apercus : vignettes des images, seulement pendant la session (elles ne sont pas enregistrées avec la discussion)
function listePieces(noms, apercus = {}) {
    const ul = document.createElement("ul");
    ul.className = "pieces";
    noms.forEach((nom) => ul.append(etiquettePiece(nom, apercus[nom])));
    return ul;
}

function etiquettePiece(nom, apercu) {
    const li = document.createElement("li");
    li.className = "piece";
    if (apercu) {
        const img = document.createElement("img");
        img.src = apercu;
        img.alt = "";
        li.append(img);
    }
    // Nom tronqué proprement quand il est long, nom complet au survol
    const texte = document.createElement("span");
    texte.className = "piece__nom";
    texte.textContent = nom;
    texte.title = nom;
    li.append(texte);
    return li;
}

function addMessage(role, text, fichiers = [], apercus = {}, message = null, conversation = current) {
    if (conversation === current) { welcomeEl.hidden = true; $(".principal").classList.remove("is-accueil"); }
    const wrap = document.createElement("div");
    wrap.className = `msg ${role}`;
    const bulle = document.createElement("div");
    bulle.className = "bulle-msg";
    let chat = null;

    if (role === "user") {
        bulle.textContent = text;
        if (fichiers.length) wrap.append(listePieces(fichiers, apercus));
        if (text) wrap.append(bulle);
    } else {
        // Le petit chat à côté de chaque réponse
        const toile = document.createElement("canvas");
        toile.className = "msg__chat";
        const corps = document.createElement("div");
        const nom = document.createElement("p");
        nom.className = "msg__nom";
        nom.textContent = NOM_DU_CHAT;
        if (role === "assistant") bulle.innerHTML = renderMarkdown(text);
        else bulle.textContent = text;
        corps.append(nom, bulle);
        wrap.append(toile, corps);
        chat = new ChatNoir(toile, { suitSouris: false });
        if (role === "error") chat.expression("fache");
    }
    if (message) ajouterActionsMessage(wrap, conversation, message);
    if (conversation === current) {
        messagesEl.appendChild(wrap);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }
    return { bulle, chat };
}

// Les durées natives Ollama sont en nanosecondes ; les temps Cat Ai sont en millisecondes.
function texteStatistiquesOllama(appels) {
    const nombre = (n) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
    const secondes = (n, unite = 1e9) => Number.isFinite(n) && n >= 0 ? nombre(n / unite) + " s" : "non fourni";
    return appels.map((m, i) => [
        `Appel ${i + 1} · ${m.requetes} requête(s) HTTP · réflexion ${m.reflexion ? "activée" : "désactivée"}${m.promptBrut ? " · prompt écrit par Cat Ai (petite machine)" : ""}${m.termine ? "" : " · flux incomplet ou abandonné"}`,
        "Chargement : " + secondes(m.load_duration),
        "Traitement du prompt : " + secondes(m.prompt_eval_duration),
        "Génération : " + secondes(m.eval_duration),
        "Tokens générés : " + (Number.isFinite(m.eval_count) ? nombre(m.eval_count) + " tokens" : "non fourni"),
        "Débit : " + (Number.isFinite(m.eval_count) && m.eval_duration > 0 ? nombre(m.eval_count * 1e9 / m.eval_duration) + " tokens/s" : "non fourni"),
        "Durée Ollama : " + secondes(m.total_duration),
        "Premier fragment reçu : " + secondes(m.premierFragmentMs, 1000),
        ...(Number.isFinite(m.reflexionCaracteres) && m.reflexionCaracteres >= 0 ? ["Raisonnement : " + nombre(m.reflexionCaracteres) + " caractères de réflexion, retirés de l’affichage"] : []),
        "Durée de l’envoi Cat Ai : " + secondes(m.dureeMs, 1000),
    ].join("\n")).join("\n\n");
}

// Rubrique « résumé automatique » : durée de bout en bout en millisecondes côté Cat Ai (IPC, HTTP, génération),
// champs natifs Ollama en nanosecondes quand ils sont fournis. Aucun contenu : durées, compteurs, nombre d'appels.
function texteResumeAutomatique(appels, dureeReponse) {
    const nombre = (n) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
    const duree = (n, unite) => Number.isFinite(n) && n >= 0 ? nombre(n / unite) + " s" : "non fourni";
    const blocs = appels.map((m, i) => [
        "Appel " + (i + 1) + " · " + (m.echec ? "échec : aucun résumé obtenu" : "résumé obtenu"),
        "Durée de bout en bout : " + duree(m.dureeMs, 1000),
        "Chargement : " + duree(m.load_duration, 1e9),
        "Traitement du prompt : " + duree(m.prompt_eval_duration, 1e9),
        "Génération : " + duree(m.eval_duration, 1e9),
        "Tokens générés : " + (Number.isFinite(m.eval_count) && m.eval_count >= 0 ? nombre(m.eval_count) + " tokens" : "non fourni"),
        "Débit : " + (Number.isFinite(m.eval_count) && m.eval_duration > 0 ? nombre(m.eval_count * 1e9 / m.eval_duration) + " tokens/s" : "non fourni"),
        "Durée native Ollama : " + duree(m.total_duration, 1e9),
    ].join("\n")).join("\n\n");
    const total = appels.reduce((n, m) => n + (Number.isFinite(m.dureeMs) && m.dureeMs >= 0 ? m.dureeMs : 0), 0);
    const echecs = appels.filter((m) => m.echec).length;
    const bilan = "Nombre d'appels : " + appels.length + " · Durée totale : " + duree(total, 1000)
        + (echecs ? " · dont " + echecs + " sans résumé obtenu" : "");
    const part = Number.isFinite(dureeReponse) && dureeReponse > 0 && total > 0
        ? "Part de la durée de réponse : " + nombre(total / dureeReponse * 100) + " % (réponse : " + nombre(dureeReponse / 1000) + " s)"
        : "Part de la durée de réponse : non fournie";
    return blocs + "\n\n" + bilan + "\n" + part;
}

// Les chiffres qui comptent, additionnés sur tous les appels d'une réponse (un appel par tour d'outils)
function syntheseOllama(appels) {
    const somme = (cle) => appels.reduce((t, m) => t + (Number.isFinite(m[cle]) && m[cle] > 0 ? m[cle] : 0), 0);
    const genere = somme("eval_count");
    const dureeGeneration = somme("eval_duration");
    const premier = appels.find((m) => Number.isFinite(m.premierFragmentMs))?.premierFragmentMs;
    const reflexion = somme("reflexionCaracteres");
    return {
        debit: genere > 0 && dureeGeneration > 0 ? genere * 1e9 / dureeGeneration : null,
        premierMot: Number.isFinite(premier) ? premier / 1000 : null,
        lecture: somme("prompt_eval_duration") / 1e9 || null,
        lectureTokens: somme("prompt_eval_count") || null,
        ecriture: dureeGeneration / 1e9 || null,
        tokens: genere || null,
        chargement: somme("load_duration") / 1e9 || null,
        reflexion: reflexion || null,
        appels: appels.length,
        incomplet: appels.some((m) => !m.termine),
    };
}

// Vitesse habituelle de chaque modèle local (la meilleure vue) : une réponse bien plus lente est signalée.
// Assez de tokens pour que la mesure compte ; moins d'un tiers de l'habitude = la carte ne travaille plus
// (pilote graphique planté, Ollama lancé sans la carte…).
const SEUIL_LENTEUR = 0.35;
function comparerVitesse(vitesses, modele, s) {
    if (!modele || !s?.debit || !(s.tokens >= 40)) return { vitesses, lent: null };
    const habituelle = vitesses[modele] || 0;
    const lent = habituelle >= 8 && s.debit < habituelle * SEUIL_LENTEUR ? { debit: Math.round(s.debit * 10) / 10, habituelle: Math.round(habituelle) } : null;
    return { vitesses: s.debit > habituelle ? { ...vitesses, [modele]: s.debit } : vitesses, lent };
}
function noterVitesse(modele, s) {
    let vitesses = {};
    try { vitesses = JSON.parse(localStorage.getItem("vitessesModeles") || "{}") || {}; } catch {}
    const r = comparerVitesse(vitesses, modele, s);
    if (r.vitesses !== vitesses) try { localStorage.setItem("vitessesModeles", JSON.stringify(r.vitesses)); } catch {}
    return r.lent;
}

// Les statistiques sous une réponse : une ligne de résumé, puis des tuiles lisibles, puis le détail brut
function blocStatistiques(message) {
    const details = document.createElement("details");
    details.className = "msg__stats";
    const resume = document.createElement("summary");
    const contenu = document.createElement("div");
    contenu.className = "stats";
    const nombre = (n, decimales = 1) => n.toLocaleString("fr-FR", { maximumFractionDigits: decimales });
    const tuile = (titre, valeur, aide = "") => {
        if (valeur === null || valeur === undefined) return;
        const el = document.createElement("div");
        el.className = "stats__tuile";
        if (aide) el.title = aide;
        const v = document.createElement("strong");
        v.textContent = valeur;
        const t = document.createElement("span");
        t.textContent = titre;
        el.append(v, t);
        grille.append(el);
    };
    const grille = document.createElement("div");
    grille.className = "stats__grille";
    if (message.statistiquesOllama?.length) {
        const s = syntheseOllama(message.statistiquesOllama);
        resume.textContent = [
            s.debit && `${nombre(s.debit, 0)} tokens/s`,
            s.premierMot !== null && `premier mot en ${nombre(s.premierMot)} s`,
        ].filter(Boolean).join(" · ") || "Statistiques";
        if (message.lenteur) {
            details.classList.add("msg__stats--lent");
            const note = document.createElement("span");
            note.className = "stats__lent";
            note.textContent = "plus lent que d'habitude";
            note.title = `${nombre(message.lenteur.debit)} tokens/s au lieu d'environ ${message.lenteur.habituelle}. La carte graphique ne semble plus travailler : redémarre le PC si ça continue.`;
            resume.append(" · ", note);
        }
        tuile("Vitesse", s.debit && `${nombre(s.debit, 0)} tokens/s`, "Vitesse d'écriture du modèle sur ton PC");
        tuile("Premier mot", s.premierMot !== null ? `${nombre(s.premierMot)} s` : null, "Temps avant que la réponse commence à s'afficher");
        tuile("Lecture de la question", s.lecture && `${nombre(s.lecture)} s`, s.lectureTokens ? `${nombre(s.lectureTokens, 0)} tokens lus (consignes, historique, fichiers)` : "");
        tuile("Écriture", s.ecriture && `${nombre(s.ecriture)} s`, s.tokens ? `${nombre(s.tokens, 0)} tokens écrits` : "");
        tuile("Chargement du modèle", s.chargement && s.chargement >= 0.5 ? `${nombre(s.chargement)} s` : null, "Le modèle n'était pas encore en mémoire");
        tuile("Réflexion", s.reflexion && `${nombre(s.reflexion, 0)} caractères`, "Raisonnement du mode Réflexion, retiré de l'affichage");
        tuile("Outils", message.nombreOutils ? String(message.nombreOutils) : null, "Outils demandés par le modèle pendant la réponse");
        if (s.appels > 1) tuile("Appels", String(s.appels), "Un appel à Ollama par tour d'outils");
        if (s.incomplet) {
            const alerte = document.createElement("p");
            alerte.className = "stats__alerte";
            alerte.textContent = "Réponse interrompue : certains chiffres manquent.";
            contenu.append(alerte);
        }
    } else resume.textContent = "Résumé automatique";
    contenu.prepend(grille);
    // Le détail complet, pour qui veut tout voir (et pour copier dans un rapport de bug)
    const brut = document.createElement("details");
    brut.className = "stats__brut";
    const titreBrut = document.createElement("summary");
    titreBrut.textContent = "Détail technique";
    const texte = document.createElement("p");
    const rubriques = [];
    if (message.statistiquesOllama?.length) rubriques.push(texteStatistiquesOllama(message.statistiquesOllama)
        + "\n\nOutils demandés : " + message.nombreOutils
        + "\nEnvois du chat uniquement ; le préchauffage reste exclu. La durée totale Cat Ai inclut aussi la préparation (dont le résumé automatique, "
        + (message.statistiquesResume?.length ? "détaillé ci-dessous" : "détaillé à part le cas échéant") + ") et l’affichage.");
    if (message.statistiquesResume?.length) {
        const detail = texteResumeAutomatique(message.statistiquesResume, message.dureeReponse);
        rubriques.push(message.statistiquesOllama?.length ? "Résumé automatique\n" + detail : detail);
    }
    texte.textContent = rubriques.join("\n\n");
    brut.append(titreBrut, texte);
    contenu.append(brut);
    details.append(resume, contenu);
    return details;
}

function ajouterActionsMessage(wrap, conv, message) {
    const barre = document.createElement("div");
    barre.className = "msg__actions";
    const retour = document.createElement("span");
    retour.setAttribute("role", "status");
    const action = (nom, dessin, clic) => {
        const bouton = document.createElement("button");
        bouton.type = "button";
        bouton.title = nom;
        bouton.setAttribute("aria-label", nom);
        bouton.innerHTML = icone(dessin);
        bouton.onclick = clic;
        barre.append(bouton);
    };
    action("Copier le message", "copier", async () => {
        try {
            const texte = message.affichage ?? message.content;
            await navigator.clipboard.writeText(message.role === "assistant" ? sansEtiquettes(texte) : texte);
            retour.textContent = "Copié";
        } catch { retour.textContent = "Copie impossible"; }
    });
    // Modifier : réservé aux messages de l'utilisateur ; les réponses gardent Copier, Régénérer et Supprimer
    if (message.role === "user") action("Modifier le message", "stylo", () => ouvrirActionMessage(conv, message, "modifier"));
    if (message.role === "assistant" && conv.messages.at(-1) === message && conv.messages.at(-2)?.role === "user") {
        action("Régénérer la dernière réponse", "relancer", () => regenererReponse(conv, message));
        barre.lastElementChild.classList.add("msg__regenerer");
    }
    action("Supprimer le message", "corbeille", () => ouvrirActionMessage(conv, message, "supprimer"));
    if (Number.isFinite(message.dureeReponse)) {
        const duree = document.createElement("span");
        duree.className = "msg__duree";
        duree.textContent = `Terminé en ${(message.dureeReponse / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`;
        barre.append(duree);
    }
    barre.append(retour);
    (message.role === "assistant" ? wrap.lastElementChild : wrap).append(barre);
    if (message.statistiquesOllama?.length || message.statistiquesResume?.length) {
        wrap.lastElementChild.append(blocStatistiques(message));
    }
}

function ouvrirActionMessage(conv, message, operation) {
    const edition = operation === "modifier";
    // Seuls les messages de l'utilisateur se modifient ; aucune action pendant une génération dans cette discussion
    if (edition && message.role !== "user") return;
    if (conversationOccupee(conv)) return;
    const dialogue = $("#message-dialog");
    const champ = $("#message-dialog-texte");
    const ancienTexte = message.affichage ?? message.content;
    $("#message-dialog-titre").textContent = edition ? "Modifier le message" : "Supprimer ce message ?";
    $("#message-dialog-info").textContent = edition
        ? "Le texte enregistré sera aussi utilisé dans les prochaines réponses."
        : "Ce message sera retiré de la discussion et de son contexte.";
    $("#message-dialog-valider").textContent = edition ? "Enregistrer" : "Supprimer";
    champ.hidden = !edition;
    champ.required = edition;
    champ.value = edition ? ancienTexte : "";
    dialogue.returnValue = "";
    dialogue.showModal();
    if (edition) champ.focus();
    // Electron 45 (Chromium récent) : l'événement close du <dialog> ne part plus, même après un vrai clic
    // sur le bouton — l'édition et la suppression ne s'appliquaient plus du tout. La soumission du
    // formulaire, elle, marche toujours : c'est elle qui applique le changement, une seule fois par
    // ouverture. Échap ferme le dialogue sans soumettre : rien n'est appliqué, comme avant.
    dialogue.onsubmit = (e) => {
        if (e.submitter?.value !== "valider") return;
        const position = conv.messages.indexOf(message);
        if (position < 0 || conversationOccupee(conv)) return;
        if (edition) {
            const texte = champ.value.trim();
            if (!texte || texte === ancienTexte) return;
            if (message.affichage !== undefined) {
                const debutPieces = ancienTexte.length || message.content.indexOf("\n\n");
                message.content = texte + (debutPieces >= 0 ? message.content.slice(debutPieces) : "");
                message.affichage = texte;
            } else message.content = texte;
        } else {
            conv.messages.splice(position, 1);
            // Plus aucun message : la discussion quitte l'historique, retour au nouveau chat
            if (!conv.messages.length) {
                convs = convs.filter((c) => c !== conv);
                erreursEnAttente.delete(conv);
                current = null;
                save();
                renderConv();
                return;
            }
        }
        // Le résumé couvre uniquement les messages avant resumeJusqua.
        // Modifier la partie récente ne change pas ce préfixe déjà résumé.
        if (!Number.isInteger(conv.resumeJusqua) || position < conv.resumeJusqua) {
            delete conv.resume;
            delete conv.resumeJusqua;
        }
        save();
        const scroll = messagesEl.scrollTop;
        renderConv();
        messagesEl.scrollTop = scroll;
        const voisine = messagesEl.querySelectorAll(".msg__actions")[Math.min(position, conv.messages.length - 1)];
        (voisine?.querySelector("button") || input).focus({ preventScroll: true });
    };
}

// Le texte suit la réponse seulement si on est déjà en bas : on peut remonter lire pendant que le chat écrit
const enBas = () => messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;

function renderConv() {
    changerBrouillon();
    void renderBarreCopie();
    // Une autre discussion : la colonne arrive en fondu, d'un bloc (les nouveaux messages gardent leur arrivée)
    if (current !== convAffichee) {
        convAffichee = current;
        messagesEl.classList.remove("is-change");
        void messagesEl.offsetWidth; // relance l'animation
        messagesEl.classList.add("is-change");
    }
    messagesEl.querySelectorAll(".msg").forEach((m) => m.remove());
    // La discussion ouverte n'a plus rien de nouveau à signaler
    if (current?.nonLu) {
        delete current.nonLu;
        save();
    }
    // La réponse en cours (ou en préparation) appartient à cette discussion : sa bulle, toujours vivante, revient à la fin
    const vivante = reponseVivante(current);
    const enCoursIci = !!vivante;
    const erreur = current && erreursEnAttente.get(current);
    welcomeEl.hidden = !!(current && current.messages.length) || enCoursIci || !!erreur;
    // Accueil : le chat, la phrase et la saisie se regroupent au milieu de l'écran
    $(".principal").classList.toggle("is-accueil", !welcomeEl.hidden);
    current?.messages.forEach((m) => addMessage(m.role, m.affichage ?? m.content, m.fichiers, {}, m));
    if (enCoursIci && vivante.wrap) {
        messagesEl.appendChild(vivante.wrap);
        // La bulle vivante peut avoir été redessinée en différé : on force un rendu à l'arrivée
        afficherFlux(vivante, false, true);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }
    if (erreur) {
        erreursEnAttente.delete(current);
        messagesEl.appendChild(erreur.wrap);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        if (erreur.modeleCasse) remplacerModeleCasse(erreur.modeleCasse, erreur.bulle);
    }
    renderList();
    majSaisie();
    majBoutonEnvoi();
}

// Recherche sans accents ni majuscules : « python » trouve « Python », « crepe » trouve « crêpe »
const sansAccents = (texte) => String(texte).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
let indexRecherche = null;

// La requête vient du champ de recherche de l'historique ; vide = tout l'historique
function requeteHistorique() {
    const champ = $("#conv-recherche");
    return sansAccents(champ?.value || "").trim();
}

// Texte cherché dans une discussion : son titre et ses messages (réponses comprises).
// indexRecherche évite de tout recalculer à chaque frappe ; sauvegarderHistorique le vide après un changement.
function texteIndexConversation(c) {
    return sansAccents([c.title || "", ...(c.messages || []).map((m) => m.affichage ?? m.content ?? "")].join("\n"));
}

function conversationsAffichees() {
    const mots = requeteHistorique().split(/\s+/).filter(Boolean);
    if (!mots.length) return convs;
    if (!indexRecherche) indexRecherche = new Map();
    return convs.filter((c) => {
        if (!indexRecherche.has(c)) indexRecherche.set(c, texteIndexConversation(c));
        const texte = indexRecherche.get(c);
        return mots.every((mot) => texte.includes(mot));
    });
}

function renderList() {
    if (!$("#titre-conv").querySelector("input")) $("#titre-conv").textContent = current?.title || "";
    $("#renommer-conv").hidden = !current;
    const champ = $("#conv-recherche");
    const requete = requeteHistorique();
    const visibles = conversationsAffichees();
    const effacer = $("#conv-recherche-effacer");
    if (effacer) effacer.hidden = !champ?.value.trim();
    const statut = $("#conv-statut");
    if (statut) {
        const texte = champ?.value.trim() || "";
        statut.textContent = !requete ? ""
            : visibles.length
                ? `${visibles.length} discussion${visibles.length > 1 ? "s" : ""} trouvée${visibles.length > 1 ? "s" : ""}.`
                : `Aucune discussion ne contient « ${texte} ».`;
    }
    convList.innerHTML = "";
    visibles.forEach((c, place) => {
        const vivante = reponseVivante(c);
        const li = document.createElement("li");
        li.classList.toggle("is-active", c === current);
        li.classList.toggle("is-en-cours", !!vivante);
        li.classList.toggle("is-nouveau", !!c.nonLu && c !== current);

        // La ligne entière est un vrai bouton : tabulation, Entrée et Espace ouvrent la discussion
        const ouvrir = document.createElement("button");
        ouvrir.type = "button";
        ouvrir.className = "conv__ouvrir";
        ouvrir.textContent = c.title;
        if (c === current) ouvrir.setAttribute("aria-current", "page");
        if (vivante) ouvrir.title = "Le chat est en train de répondre ici";
        else if (c.nonLu) ouvrir.title = "Nouvelle réponse";
        ouvrir.onclick = () => { current = c; renderConv(); };
        // Double-clic ou F2 : on renomme directement dans la liste
        ouvrir.ondblclick = () => renommerDansListe(c, li, ouvrir);
        ouvrir.onkeydown = (e) => { if (e.key === "F2") { e.preventDefault(); renommerDansListe(c, li, ouvrir); } };

        const suppr = document.createElement("button");
        suppr.type = "button";
        suppr.className = "suppr";
        suppr.textContent = "×";
        suppr.title = vivante ? "Attends la fin de la réponse pour supprimer" : `Supprimer « ${c.title} »`;
        suppr.setAttribute("aria-label", suppr.title);
        // La réponse en cours a besoin de sa discussion : on le dit, sans retirer la ligne du clavier
        suppr.setAttribute("aria-disabled", String(!!vivante));
        suppr.onclick = (e) => {
            e.stopPropagation();
            if (vivante) return;
            demanderSuppressionDiscussion(c, li, place);
        };
        // Renommer d'un clic, sans connaître le double-clic ni F2
        const renommer = document.createElement("button");
        renommer.type = "button";
        renommer.className = "conv__renommer";
        renommer.title = `Renommer « ${c.title} »`;
        renommer.setAttribute("aria-label", renommer.title);
        renommer.innerHTML = icone("stylo");
        renommer.onclick = (e) => { e.stopPropagation(); renommerDansListe(c, li, ouvrir); };
        li.append(ouvrir, renommer, suppr);
        convList.appendChild(li);
    });
}

// Renommer une discussion : Entrée ou clic ailleurs garde le nouveau titre, Échap annule, un titre vide ne change rien
const TITRE_MAX = 80;
function champTitre(conv, classe, fini) {
    const champ = document.createElement("input");
    champ.type = "text";
    champ.className = classe;
    champ.value = conv.title;
    champ.maxLength = TITRE_MAX;
    champ.setAttribute("aria-label", "Nouveau titre de la discussion");
    let termine = false;
    const finir = (garder) => {
        if (termine) return;
        termine = true;
        const titre = champ.value.replace(/\s+/g, " ").trim().slice(0, TITRE_MAX);
        if (garder && titre && titre !== conv.title) {
            conv.title = titre;
            conv.titreChoisi = true;
            save();
        }
        fini();
    };
    champ.onkeydown = (e) => {
        if (e.key === "Enter") { e.preventDefault(); finir(true); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finir(false); }
    };
    champ.onblur = () => finir(true);
    return champ;
}

function renommerDiscussion(conv = current) {
    if (!conv) return;
    const titre = $("#titre-conv");
    if (titre.querySelector("input")) return;
    const champ = champTitre(conv, "entete__champ", () => {
        titre.textContent = conv.title;
        renderList();
        $("#renommer-conv").focus({ preventScroll: true });
    });
    titre.replaceChildren(champ);
    champ.focus();
    champ.select();
}

function renommerDansListe(conv, li, ouvrir) {
    if (li.querySelector("input")) return;
    const champ = champTitre(conv, "conv__champ", () => {
        renderList();
        if (conv === current) $("#titre-conv").textContent = conv.title;
        [...convList.querySelectorAll(".conv__ouvrir")].find((b) => b.textContent === conv.title)?.focus({ preventScroll: true });
    });
    ouvrir.replaceWith(champ);
    champ.focus();
    champ.select();
}

// Une discussion ne part jamais sur un clic malheureux : la ligne demande confirmation et « Garder » a le focus.
function demanderSuppressionDiscussion(c, li, place) {
    if (reponseVivante(c)) return;
    const contenu = [...li.childNodes];
    const groupe = document.createElement("div");
    groupe.className = "conv__confirmation";
    groupe.setAttribute("role", "group");
    groupe.setAttribute("aria-label", `Supprimer « ${c.title} » ?`);
    const question = document.createElement("span");
    question.className = "conv__confirmation-texte";
    question.textContent = `Supprimer « ${c.title} » ?`;
    const garder = document.createElement("button");
    garder.type = "button";
    garder.className = "lien lien--petit";
    garder.textContent = "Garder";
    const oui = document.createElement("button");
    oui.type = "button";
    oui.className = "lien lien--petit lien--danger";
    oui.textContent = "Supprimer";
    const annuler = () => {
        li.replaceChildren(...contenu);
        li.querySelector(".suppr")?.focus();
    };
    garder.onclick = (e) => { e.stopPropagation(); annuler(); };
    oui.onclick = (e) => {
        e.stopPropagation();
        if (reponseVivante(c)) { annuler(); return; }
        supprimerDiscussion(c, place);
    };
    groupe.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        annuler();
    });
    groupe.append(question, garder, oui);
    li.replaceChildren(groupe);
    garder.focus(); // le choix sûr reçoit le focus
}

// Retire la discussion, choisit celle qui reste et rend le focus à la liste (jamais dans le vide)
function supprimerDiscussion(c, place) {
    if (reponseVivante(c)) return false;
    const etaitCourante = current === c;
    convs = convs.filter((x) => x !== c);
    if (etaitCourante) {
        let restantes = conversationsAffichees();
        // Plus aucun résultat alors que l'historique n'est pas vide : on rend la liste entière
        if (!restantes.length && requeteHistorique() && convs.length) {
            const champ = $("#conv-recherche");
            if (champ) champ.value = "";
            restantes = convs;
        }
        current = restantes[0] || null;
    }
    sauvegarderHistorique();
    renderConv();
    const boutons = [...convList.querySelectorAll(".conv__ouvrir")];
    (boutons[Math.min(place, boutons.length - 1)] || $("#new-chat")).focus();
    return true;
}

// Recherche de l'historique : filtre à la frappe, Échap efface, le × efface aussi
$("#conv-recherche").addEventListener("input", renderList);
$("#conv-recherche").addEventListener("keydown", (e) => {
    if (e.key === "Escape" && e.target.value) {
        e.preventDefault();
        e.target.value = "";
        renderList();
    }
});
// La recherche s'affiche ou se cache avec la loupe (ou Ctrl+F) ; le choix est retenu
function montrerRecherche(oui, focus = true) {
    $(".discussions__recherche").hidden = !oui;
    $("#conv-recherche-ouvrir").setAttribute("aria-expanded", String(oui));
    try { localStorage.setItem("rechercheHistorique", oui ? "1" : "0"); } catch {}
    if (oui && focus) $("#conv-recherche").focus();
    if (!oui && $("#conv-recherche").value) { $("#conv-recherche").value = ""; renderList(); }
}
try { if (localStorage.getItem("rechercheHistorique") === "1") montrerRecherche(true, false); } catch {}
$("#conv-recherche-ouvrir").onclick = () => montrerRecherche($(".discussions__recherche").hidden);
window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "f") return;
    if (document.querySelector(".fenetre:not([hidden])")) return;
    e.preventDefault();
    montrerRecherche(true);
});
$("#conv-recherche-effacer").onclick = () => {
    $("#conv-recherche").value = "";
    renderList();
    $("#conv-recherche").focus();
};

// Les images jointes (lourdes) ne sont pas enregistrées : seuls leurs noms restent avec la discussion.
// Une écriture qui échoue est signalée : sans cela, on pouvait croire l'historique enregistré et le perdre.
let sauvegardeEnEchec = false;
function sauvegarderHistorique() {
    indexRecherche = null;
    const donnees = convs.map((c) => ({ ...c, messages: c.messages.map(({ images, ...m }) => m) }));
    let ecriture;
    try {
        ecriture = window.api.saveConvs(donnees);
    } catch (err) {
        ecriture = Promise.reject(err);
    }
    return Promise.resolve(ecriture).then(() => {
        if (!sauvegardeEnEchec) return;
        sauvegardeEnEchec = false;
        const alerte = $("#historique-alerte");
        if (alerte) alerte.hidden = true;
    }).catch(() => {
        const alerte = $("#historique-alerte");
        if (alerte && alerte.hidden) {
            alerte.textContent = "Impossible d'enregistrer l'historique : tes messages risquent d'être perdus si tu fermes l'app.";
            alerte.hidden = false;
        }
        sauvegardeEnEchec = true;
    });
}
const save = () => sauvegarderHistorique();

function setStreaming(on) {
    sendBtn.title = on ? "Arrêter" : "Envoyer (Entrée)";
    sendBtn.setAttribute("aria-label", on ? "Arrêter" : "Envoyer");
    sendBtn.classList.toggle("is-stop", on);
}

// Le bouton suit la discussion affichée : le carré n'arrête que la réponse qu'on regarde.
// Pendant la préparation (mémoire, projet, résumé), il est désactivé : l'envoi est déjà pris en compte.
function majBoutonEnvoi() {
    const flux = fluxParConv.has(current);
    setStreaming(flux);
    const preparation = !flux && preparations.has(current);
    sendBtn.disabled = preparation;
    if (preparation) {
        sendBtn.title = "Préparation en cours…";
        sendBtn.setAttribute("aria-label", "Préparation en cours");
    }
}


/* ---------- 5. Envoi ---------- */
// Cherche si le message parle d'un dossier : chemin complet, projet connu, ou bureau/documents
async function detectProject(text) {
    const t = text.toLowerCase();
    // Chemin complet : Windows (C:\…), ou Linux et macOS (/home/…, ~/…)
    const abs = text.match(/[a-z]:\\[^\s"'<>|?*]+/i) || text.match(/(?:^|\s)(~\/[^\s"'<>|?*]+|\/(?:home|Users|mnt|media|opt|srv|tmp)\/[^\s"'<>|?*]+)/);
    if (abs) {
        const chemin = (abs[1] || abs[0]).trim().replace(/[\\/.,;:!]+$/, "").replace(/^~(?=\/)/, specialDirs.maison || "~");
        if (await window.api.dirExists(chemin)) return chemin;
    }
    const connu = knownProjects.find((p) => {
        const nom = p.split(/[\\/]/).pop().toLowerCase();
        return nom.length > 2 && new RegExp(`(^|[^a-z0-9])${nom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(t);
    });
    if (connu) return connu;
    const alias = { bureau: ["bureau", "desktop"], documents: ["mes documents"], "téléchargements": ["téléchargements", "telechargements", "downloads"] };
    for (const [cle, mots] of Object.entries(alias)) {
        if (mots.some((m) => t.includes(m))) return specialDirs[cle];
    }
    return null;
}

// Liste des fichiers du projet + contenu des fichiers cités, donnés directement au modèle
async function projectInfo(text) {
    const ctx = await window.api.projectContext(text);
    if (!ctx) return "";
    let p = `\n\nFichiers du dossier ouvert :\n${ctx.files.join("\n") || "(vide)"}`;
    if (ctx.coupee) p += "\n(liste coupée : il y a d'autres fichiers, vois-les avec lister_fichiers)";
    for (const f of ctx.mentioned) p += `\n\nContenu de ${f.path} :\n\`\`\`\n${f.content}\n\`\`\``;
    p += `\n\nBase-toi UNIQUEMENT sur ces fichiers réels. Pour voir un autre fichier, utilise lire_fichier. N'invente jamais le contenu d'un fichier.`;
    return p;
}

// Résumé automatique : au-delà de ce nombre de caractères, le début de la discussion est résumé
// (le modèle a une mémoire de 8192 tokens, il faut garder de la place pour les consignes et la réponse)
const LIMITE_HISTORIQUE = 12000;
const MESSAGES_GARDES = 4; // les derniers messages restent toujours en entier

async function resumerSiBesoin(conv, bulle, statistiquesResume = null, choix = null) {
    const debut = conv.resumeJusqua || 0;
    const recents = conv.messages.slice(debut);
    const taille = recents.reduce((n, m) => n + m.content.length, 0);
    if (taille < LIMITE_HISTORIQUE || recents.length <= MESSAGES_GARDES) return;
    const fin = conv.messages.length - MESSAGES_GARDES;
    bulle.innerHTML = '<p><span class="action">Résume le début de la discussion pour ne pas l\'oublier</span></p>';
    // Instrumentation seule : durée de bout en bout (IPC, HTTP, génération), sans changer le déroulement
    // du résumé ni conserver son contenu. Liste fermée de champs natifs ; sans collecteur, rien de nouveau.
    const debutMesure = statistiquesResume ? performance.now() : null;
    let reponse = null;
    try {
        reponse = await window.api.summarize({
            model: choix?.model ?? modelSel.value,
            fournisseurId: choix?.fournisseurId ?? reglages.actif,
            messages: conv.messages.slice(debut, fin).map(({ role, content }) => ({ role, content: content.slice(0, 4000) })),
            ancienResume: conv.resume,
            avecMesures: true
        });
    } finally {
        if (statistiquesResume) {
            const obtenu = typeof reponse === "string" ? reponse : reponse?.resume;
            const appel = { dureeMs: performance.now() - debutMesure, echec: !obtenu };
            const mesures = typeof reponse === "object" && reponse ? reponse.mesures : null;
            for (const cle of ["total_duration", "load_duration", "prompt_eval_count", "prompt_eval_duration", "eval_count", "eval_duration"]) {
                if (Number.isFinite(mesures?.[cle]) && mesures[cle] >= 0) appel[cle] = mesures[cle];
            }
            statistiquesResume.push(appel);
        }
    }
    const resume = typeof reponse === "string" ? reponse : reponse?.resume;
    if (!resume) return; // pas grave : on envoie quand même, le modèle oubliera juste le tout début
    conv.resume = resume;
    conv.resumeJusqua = fin;
    save();
}

// Les étiquettes d'action sont pour l'utilisateur, pas pour le modèle : s'il les voyait dans l'historique,
// il apprendrait à les recopier et ferait croire qu'il a lu un fichier sans l'avoir fait
// (on retire aussi l'ancien format [[action:…]] des discussions enregistrées avant ce changement)
const sansEtiquettes = (texte) => texte.replace(LIGNE_ACTION, "").replace(/\[\[action:[^\]\n]*\]\]/g, "").replace(/\n{3,}/g, "\n\n").trim();

const MAX_ACTIONS_RAPPELEES = 12;

function messagesPourLeModele(conv, modeProf = prof) {
    const dernierUser = conv.messages.map((m) => m.role).lastIndexOf("user");
    const liste = conv.messages.slice(conv.resumeJusqua || 0).map((m, i) => {
        const message = { role: m.role, content: m.role === "assistant" ? sansEtiquettes(m.content) : m.content };
        // Les images du dernier message seulement : celles d'avant ne seraient que de la place perdue
        if (m.images?.length && i + (conv.resumeJusqua || 0) === dernierUser) message.images = m.images;
        return message;
    });
    if (conv.resume) liste.unshift({ role: "system", content: `Résumé du début de cette discussion :\n${conv.resume}` });
    // Les petits modèles oublient les consignes du début : on rappelle le mode prof juste avant de répondre
    // Ce qu'il a fait dans ses réponses précédentes (lu, cherché, modifié…), une ligne par action, sans le contenu
    // des fichiers : assez pour qu'il ne relise pas tout et n'invente pas, sans remplir les 8 192 tokens d'Ollama.
    // Placé après la question, comme les rappels : c'est la partie que la compaction ne retire jamais.
    const toutes = conv.messages.flatMap((m) => m.actions || []);
    const actions = toutes.filter((a, i) => a !== toutes[i - 1]).slice(-MAX_ACTIONS_RAPPELEES);
    // Un petit modèle confond vite ce qu'il a proposé et ce qu'il a fait : le bilan des fichiers modifiés est dit en clair
    const modifies = [...new Set(toutes.filter((a) => /^a (modifié|créé) /.test(a)).map((a) => a.replace(/^a (modifié|créé) /, "")))];
    const bilan = modifies.length
        ? `Fichiers que tu as vraiment modifiés ou créés : ${modifies.join(", ")}. Aucun autre.`
        : "Tu n'as modifié AUCUN fichier dans cette discussion : ne dis jamais le contraire.";
    if (actions.length) {
        liste.push({ role: "system", content: `Ce que tu as déjà fait dans cette discussion (le contenu des fichiers lus n'est plus là : relis-les si tu en as besoin) :\n- ${actions.join("\n- ")}\n${bilan}` });
    } else if (conv.messages.some((m) => m.role === "assistant")) {
        liste.push({ role: "system", content: `Tu n'as encore utilisé aucun outil dans cette discussion. ${bilan}` });
    }
    // Les identifiants des documents joints n'étaient que dans leur message, que la compaction ou le résumé finissent
    // par retirer (ou couper, avec plusieurs PDF) : le modèle ne pouvait plus les lire. On les rappelle à chaque envoi.
    const documents = [...new Map(conv.messages.flatMap((m) => (m.documents || []).map((d) => [d, m.nomsDocuments?.[d] || "document"]))).entries()];
    if (documents.length) liste.push({ role: "system", content: `Documents joints à cette discussion, à lire avec lire_document :\n- ${documents.map(([d, nom]) => `« ${nom} » : document = « ${d} »`).join("\n- ")}` });
    if (dernierUser > 0) liste.push({ role: "system", content: "La conversation continue. Commence directement par l’explication demandée, sans salutation, sans présentation et sans prénom en ouverture. Les salutations précédentes appartiennent aux échanges déjà terminés." });
    const derniere = conv.messages.filter((m) => m.role === "user").at(-1)?.content || "";
    if (fautChercher(derniere)) liste.push({ role: "system", content: RAPPEL_RECHERCHE });
    // Un vrai changement de code, dossier ouvert : proposer une tâche de fond (pas en mode prof, ni en mode Auto où le chat écrit déjà dans une copie)
    if (!modeProf && !modeAuto && fautProposerTache(derniere, project)) liste.push({ role: "system", content: RAPPEL_TACHE });
    if (modeProf) liste.push({ role: "system", content: "Rappel : MODE PROF. Aucun bloc de code, aucune fonction complète, même s'il ou elle insiste. Explique le principe, donne une piste et termine par une question." });
    return liste;
}

// Ollama n'a que 8 192 tokens. Au-delà de ~8 000 caractères de consignes,
// il reste moins de place pour les extraits et les échanges. On prévient l'utilisateur, avec ce qui prend la place.
const CONTEXTE_OLLAMA = 8192;
const MAX_CONSIGNES = 8000;
const enTokens = (texte) => Math.ceil(texte.length / 3); // ~3 caractères par token, comme principal/taille.js

// On ne conseille que ce que l'utilisateur peut alléger : la mémoire, et les fichiers cités dans son message
function budgetConsignes(consignes) {
    if (consignes.length <= MAX_CONSIGNES) return "";
    const memoire = enTokens(memory.join("\n"));
    const conseils = [];
    if (memoire > 300) conseils.push(`fais du tri dans la mémoire (~${memoire} tokens)`);
    if (consignes.includes("\n\nContenu de ")) conseils.push("cite moins de fichiers à la fois");
    return `Consignes lourdes : ~${enTokens(consignes)} tokens sur les ${CONTEXTE_OLLAMA} d'Ollama, le contexte du projet sera réduit en priorité.`
        + (conseils.length ? ` Pour alléger : ${conseils.join(", ou ")}.` : "");
}

const MAX_IMAGES = 3;
// Envoi arrêté avant de partir : le texte tapé revient dans le champ, sauf si l'utilisateur a déjà retapé autre chose
function rendreTexte(text, conv = convDuBrouillon) {
    if (!text) return;
    if (conv !== convDuBrouillon) {
        const b = brouillons.get(conv) || { texte: "", pieces: [] };
        if (!b.texte.trim()) brouillons.set(conv, { ...b, texte: text });
        return;
    }
    if (input.value.trim()) return;
    input.value = text;
    majEnvoi();
}

// On change de discussion : ce qui est dans la saisie reste à celle qu'on quitte, on retrouve celui de l'autre
function changerBrouillon() {
    if (current === convDuBrouillon) return;
    if (input.value || pieces.length) brouillons.set(convDuBrouillon, { texte: input.value, pieces });
    else brouillons.delete(convDuBrouillon);
    const b = brouillons.get(current) || { texte: "", pieces: [] };
    brouillons.delete(current);
    convDuBrouillon = current;
    input.value = b.texte;
    pieces = b.pieces;
    anciens = null;
    renderPieces();
    majEnvoi();
    input.style.height = "auto";
    if (input.value) input.style.height = input.scrollHeight + "px";
}

// Des pièces jointes qui n'ont pas pu partir reviennent dans le brouillon de leur discussion, même si on l'a quittée
function rendrePiecesA(conv, liste) {
    if (!liste.length) return;
    if (conv === convDuBrouillon) {
        pieces = [...liste, ...pieces.filter((p) => !liste.includes(p))];
        renderPieces();
        return;
    }
    const b = brouillons.get(conv) || { texte: "", pieces: [] };
    brouillons.set(conv, { ...b, pieces: [...liste, ...b.pieces.filter((p) => !liste.includes(p))] });
}

// Une génération par discussion et autant de discussions qu'on veut : chaque réponse garde sa bulle, son flux,
// son annulation. Les handlers retrouvent leur flux par identifiant, pas par un état global unique.
const fluxParConv = new Map();   // discussion → génération { id, el, chat, wrap, conv, remplace, text, actions, … }
const preparations = new Map();  // discussion → envoi en préparation (mémoire, projet, résumé) : { conv, wrap? }
const fluxParId = (id) => { for (const flux of fluxParConv.values()) if (flux.id === id) return flux; return null; };
const conversationOccupee = (conv) => fluxParConv.has(conv) || preparations.has(conv);
const fluxLocalEnCours = () => [...fluxParConv.values()].some((flux) => flux.local);

// Petite machine (peu de RAM, modèle sur le processeur) : l'interface laisse le processeur au modèle.
// Le texte qui arrive est remis en forme 4 fois par seconde au lieu de 60, et les chats ralentissent,
// puis s'immobilisent pendant qu'un modèle local écrit (chat.js).
const RENDU_LEGER = 250;
let machineLegere = false;
window.api.machineLegere?.().then((legere) => {
    machineLegere = legere === true;
    if (!machineLegere) return;
    ChatNoir.intervalle = 100;
    ChatNoir.enPause = fluxLocalEnCours;
}).catch(() => {});
// La réponse vivante d'une discussion (préparation ou streaming) : sa bulle reste attachée à elle si on navigue
const reponseVivante = (conv = current) => fluxParConv.get(conv) ?? preparations.get(conv) ?? null;
// Erreur arrivée dans une discussion qu'on ne regardait pas : sa bulle attend qu'on y revienne
const erreursEnAttente = new Map();

function configurationDuTour() {
    const fournisseur = fournisseurActif();
    return {
        choix: { model: modelSel.value, fournisseurId: reglages.actif, prof, reflexion: reflexion && reflexionPossible },
        local: fournisseur.type === "ollama",
        fournisseur
    };
}

async function send(text, destination = current, configuration = null, piecesPrises = null) {
    text = text.trim();
    if (!text && !(piecesPrises || pieces).length) return;
    if (conversationOccupee(destination)) { if (piecesPrises) rendrePiecesA(destination, piecesPrises); return; }
    if (!modelSel.value) {
        const f = fournisseurActif();
        // Ollama installé mais arrêté : il suffit de relancer. Sinon, l'accueil explique comment avoir un modèle.
        const sansModele = f.type === "ollama" && (!etatOllama.installe || etatOllama.repond);
        addMessage("error", sansModele ? "Il me faut un cerveau pour parler. Clique sur « Nouvelle discussion » : je t'explique comment en avoir un gratuit." : f.type === "ollama" ? REPLIQUES.ollamaOff : `Pas de modèle disponible chez ${f.nom}. ${statusEl.title || "Vérifie ta clé dans « Réglages »."}`);
        return;
    }
    preparations.set(destination, { conv: destination });
    majBoutonEnvoi();
    configuration ||= configurationDuTour();
    if (configuration.choix?.model) retenirRecent(configuration.choix.fournisseurId, configuration.choix.model);
    // Pièces prises tout de suite : deux envois simultanés ne doivent pas prendre deux fois les mêmes
    const piecesDuTour = piecesPrises || [...pieces];
    if (!piecesPrises && piecesDuTour.length) {
        pieces = pieces.filter((p) => !piecesDuTour.includes(p));
        renderPieces();
    }
    let messageAjoute = false;
    const rendrePieces = () => rendrePiecesA(destination, piecesDuTour);
    try {
        const trouve = text && (await detectProject(text));
        if (trouve && trouve !== project) project = await window.api.openProjectPath(trouve);

        // Les images ne partent qu'à un modèle qui les voit : sinon on garde tout et on dit lequel prendre
        const images = piecesDuTour.filter((p) => p.image);
        if (images.length && !(await window.api.modeleVoitImages({ fournisseurId: configuration.choix.fournisseurId, modele: configuration.choix.model }))) {
            addMessage("error", `${configuration.choix.model} ne voit pas les images. Avec Ollama, prends un qwen3.5 (qwen3.5:4b pèse 3,3 Go), ou passe sur Gemini, qui les voit. Tes pièces jointes t'attendent.`, [], {}, null, destination);
            rendreTexte(text, destination);
            rendrePieces();
            return;
        }
        // Chaque image prend ~1 500 tokens : au-delà, Ollama (8 192 tokens) perdait la question ou les consignes
        if (images.length > MAX_IMAGES) {
            addMessage("error", `${MAX_IMAGES} images au plus par message : retire-en ${images.length - MAX_IMAGES}, puis renvoie.`, [], {}, null, destination);
            rendreTexte(text, destination);
            rendrePieces();
            return;
        }
        // Les fichiers glissés sont ajoutés au message envoyé au modèle, mais affichés en petites étiquettes
        const fichiers = piecesDuTour.map((p) => p.nom);
        const apercus = Object.fromEntries(images.map((p) => [p.nom, p.apercu]));
        let contenu = text || (images.length ? "Regarde cette image." : "Regarde ce fichier.");
        for (const p of piecesDuTour) {
            if (p.image) contenu += `\n\n(Image jointe : « ${p.nom} »)`;
            else if (p.document) contenu += `\n\n${p.joint}`;
            else contenu += `\n\nFichier joint « ${p.nom} » (son contenu complet est juste ici, pas besoin de le lire avec un outil) :\n\`\`\`\n${p.contenu}\n\`\`\``;
        }
        const piecesDuMessage = piecesDuTour.flatMap((p) => p.document ? [p.document] : []);
        const pieces0 = piecesDuTour;

        const conv = destination || { id: crypto.randomUUID(), title: (text || fichiers[0]).replace(/\s+/g, " ").slice(0, 40), messages: [] };
        if (!destination) {
            convs.unshift(conv);
            if (current === destination) current = conv;
            // Ce qu'on tape pendant que le chat répond appartient à la discussion qui vient de naître
            if (convDuBrouillon === destination) convDuBrouillon = conv;
            if (convAffichee === destination) convAffichee = conv;
        }
        const message = { role: "user", content: contenu };
        if (fichiers.length) Object.assign(message, { affichage: text, fichiers });
        const documents = piecesDuMessage;
        if (documents.length) Object.assign(message, { documents, nomsDocuments: Object.fromEntries(pieces0.filter((p) => p.document).map((p) => [p.document, p.nom])) });
        if (images.length) message.images = images.map((p) => p.image);
        conv.messages.push(message);
        messageAjoute = true;
        // Une discussion qui reçoit un nouveau message remonte en tête de l'historique
        if (destination) {
            const place = Array.isArray(convs) ? convs.indexOf(conv) : -1;
            if (place > 0) { convs.splice(place, 1); convs.unshift(conv); }
        }
        addMessage("user", text, fichiers, apercus, message, conv);
        renderList();
        save();
        messagesEnvoyes++;

        await lancerReponse(conv, text, conv, null, configuration);
    } catch (err) {
        if (!messageAjoute) rendrePieces();
        const { bulle } = addMessage("error", "Impossible de préparer le message : " + err.message, [], {}, null, destination);
        if (destination !== current) erreursEnAttente.set(destination, { wrap: bulle.closest(".msg"), bulle });
    } finally {
        terminerPreparation(destination);
    }
}

function terminerPreparation(conv) {
    preparations.delete(conv);
    majSaisie();
    majBoutonEnvoi();
}

async function regenererReponse(conv, message) {
    if (current !== conv || conversationOccupee(conv) || conv.messages.at(-1) !== message) return;
    const question = conv.messages.at(-2);
    if (question?.role !== "user") return;
    if (!modelSel.value) {
        addMessage("error", "Choisis un modèle pour régénérer cette réponse.");
        return;
    }
    if (!question.images?.length && question.content.includes("\n\n(Image jointe : « ")) {
        addMessage("error", "L’image n’est plus disponible. Renvoie ton message avec l’image pour obtenir une nouvelle réponse.");
        return;
    }
    preparations.set(conv, { conv });
    majBoutonEnvoi();
    const configuration = configurationDuTour();
    try {
        if (question.images?.length && !(await window.api.modeleVoitImages({ fournisseurId: configuration.choix.fournisseurId, modele: configuration.choix.model }))) {
            if (current === conv) addMessage("error", "Choisis un modèle qui accepte les images pour régénérer cette réponse.");
            return;
        }
        if (current !== conv) return;
        const contexte = { ...conv, messages: conv.messages.slice(0, -1) };
        // La réponse précédente reste enregistrée jusqu'à la réussite de la génération.
        await lancerReponse(conv, question.affichage ?? question.content, contexte, message, configuration);
    } finally {
        terminerPreparation(conv);
    }
}

async function lancerReponse(conv, text, contexte = conv, remplace = null, configuration = null) {
    const debutReponse = performance.now();
    compterMessage();
    const id = crypto.randomUUID();
    const discussionEntamee = contexte.messages.slice(0, -1).some((m) => m.role === "user");
    const { choix, local, fournisseur } = configuration || configurationDuTour();
    const consignes = systemPrompt({ discussionEntamee, modele: choix.model, fournisseur, modeProf: choix.prof });
    const { bulle, chat } = addMessage("assistant", "", [], {}, null, conv);
    bulle.classList.add("is-typing", "is-preparation");
    preparations.set(conv, { conv, wrap: bulle.closest(".msg") });
    renderList();
    chat.reflechit = true;
    const statistiquesResume = [];
    try {
        const contexteProjet = await projectInfo(text);
        if (!remplace) await resumerSiBesoin(conv, bulle, statistiquesResume, choix);
        bulle.innerHTML = "";
        // attend-modele : rien reçu du modèle pour l'instant, « Génération en cours… » reste affiché (même sous l'alerte de budget)
        bulle.classList.remove("is-preparation");
        bulle.classList.add("is-typing", "attend-modele");
        // Avec Ollama, des consignes lourdes réduisent la place disponible : l'utilisateur le voit en haut de la réponse
        const alerteBudget = local ? budgetConsignes(consignes) : "";
        const flux = { id, el: bulle, wrap: preparations.get(conv)?.wrap, conv, chat, remplace, discussionEntamee, text: alerteBudget ? etiquetteAction(alerteBudget) : "", actions: [], statistiquesResume, debut: debutReponse, dernierSignal: Date.now(), local, modele: choix.model };
        fluxParConv.set(conv, flux);
        preparations.delete(conv);
        renderList();
        if (alerteBudget) afficherFlux(flux);
        majBoutonEnvoi();
        majVeille();

        // Mode Auto : retenu sur la réponse, pour ses étiquettes (« Modifie a.js (copie) »)
        flux.auto = !!(modeAuto && project && !choix.prof);
        window.api.chat({
            id,
            ...choix,
            documents: contexte.messages.filter((m) => m.role === "user").flatMap((m) => m.documents || []),
            // Mode Auto : main.js crée ou reprend la copie de cette discussion (seulement avec un dossier, hors mode prof)
            agent: flux.auto ? { auto: true, copie: conv.agentCopie || null } : null,
            messages: [{ role: "system", content: consignes }, { role: "system", name: "contexte_projet", content: contexteProjet }, ...messagesPourLeModele(contexte, choix.prof)]
        });
    } catch (err) {
        const fluxRate = fluxParId(id);
        if (fluxRate) {
            fluxParConv.delete(fluxRate.conv);
            majBoutonEnvoi();
            majVeille();
        }
        chat.reflechit = false;
        bulle.classList.remove("is-typing", "attend-modele", "is-preparation");
        bulle.closest(".msg").classList.add("error");
        bulle.textContent = "Impossible de préparer la réponse : " + err.message;
        if (conv !== current) erreursEnAttente.set(conv, { wrap: bulle.closest(".msg"), bulle });
    }
}

// Les étiquettes de l’app peuvent précéder la réponse. Les garder sans les confondre avec le texte du modèle.
const ACTIONS_EN_TETE = /^(?:\s*[^]*)*/;

function texteDuFlux(flux, termine) {
    if (!flux.discussionEntamee) return flux.text;
    const texte = flux.text.replace(/<think>[\s\S]*?(<\/think>|$)/g, "");
    const entete = texte.match(ACTIONS_EN_TETE)[0];
    const corps = texte.slice(entete.length);
    const suite = sansSalutation(corps, prenom, termine);
    if (suite === corps) return texte;
    return entete && suite ? entete + "\n\n" + suite : entete + suite;
}

function afficherFlux(flux, termine = false, force = false) {
    flux.dernierSignal = Date.now();
    const suivre = enBas();
    // Pendant le streaming, plusieurs fragments peuvent arriver dans le même tour du navigateur :
    // on n'en redessine qu'un, ce qui évite de refaire tout le Markdown et la mise en page à chaque octet.
    // Le rendu final reste synchrone, pour que la réponse complète soit à l'écran avant onDone.
    // force sert aux moments où l'utilisateur change de discussion : on ne veut pas attendre 16 ms.
    const rendre = () => {
        flux.renduPlanifie = false;
        flux.el.innerHTML = renderMarkdown(texteDuFlux(flux, termine));
        if (flux.suivreRendu && flux.conv === current) messagesEl.scrollTop = messagesEl.scrollHeight;
    };
    flux.suivreRendu = suivre;
    if (termine || force) {
        if (flux.renduPlanifie) clearTimeout(flux.idRendu);
        flux.renduPlanifie = false;
        rendre();
        return;
    }
    if (flux.renduPlanifie) return;
    flux.renduPlanifie = true;
    // setTimeout plutôt que requestAnimationFrame : celui-ci peut être suspendu si la fenêtre
    // n'est pas au premier plan (cas des tests et de certaines situations), ce qui retarderait
    // l'affichage sans rien gagner. Le rendu final reste synchrone.
    flux.idRendu = setTimeout(rendre, machineLegere ? RENDU_LEGER : 16);
}

// Ollama n'affiche rien pendant qu'il charge le modèle ou qu'il écrit le contenu d'un fichier (l'appel d'outil
// arrive d'un bloc, à la fin) : sur un PC moyen ça dure une à deux minutes, et on croit que l'app est bloquée.
// Après SILENCE_LONG sans rien recevoir, une ligne sous la réponse dit qu'il travaille, avec le temps écoulé.
const SILENCE_LONG = 15000;
let veilleSilence = null;

function ligneAttente(flux) {
    return flux?.el.parentElement.querySelector(".attente-ollama");
}

window.api.onChatEtat(({ id, etat }) => {
    const flux = fluxParId(id);
    if (!flux) return;
    flux.attenteOllama = etat === "attente-ollama";
    flux.dernierSignal = Date.now();
    if (!flux.attenteOllama) ligneAttente(flux)?.remove();
});

// Une seule minuterie pour toutes les réponses locales en cours : chacune garde son dernier signal
function majVeille() {
    const locales = [...fluxParConv.values()].filter((flux) => flux.local);
    if (!locales.length) { clearInterval(veilleSilence); veilleSilence = null; return; }
    if (veilleSilence) return;
    veilleSilence = setInterval(() => {
        // Pendant la fenêtre avant / après, c'est l'utilisateur qu'on attend, pas Ollama
        const enPause = confirmationEnCours !== null;
        for (const flux of [...fluxParConv.values()].filter((f) => f.local)) {
            if (enPause) { flux.dernierSignal = Date.now(); ligneAttente(flux)?.remove(); continue; }
            const silence = Date.now() - flux.dernierSignal;
            if (silence < SILENCE_LONG && !flux.attenteOllama) { ligneAttente(flux)?.remove(); continue; }
            let ligne = ligneAttente(flux);
            if (!ligne) {
                ligne = document.createElement("p");
                ligne.className = "attente-ollama";
                ligne.append(document.createElement("span"));
                ligne.firstChild.className = "action";
                const suivre = enBas();
                flux.el.after(ligne);
                if (suivre && flux.conv === current) messagesEl.scrollTop = messagesEl.scrollHeight;
            }
            ligne.firstChild.textContent = flux.attenteOllama
                ? "En attente d'Ollama : une autre opération locale est en cours. Tu peux annuler avec le bouton carré."
                : `Ollama travaille sur ton PC depuis ${Math.round(silence / 1000)} s sans rien afficher : `
                + "charger le modèle ou écrire un fichier entier peut prendre une à deux minutes. Tu peux arrêter avec le bouton carré.";
        }
    }, 1000);
}

window.api.onChunk(({ id, text }) => {
    const flux = fluxParId(id);
    if (!flux) return;
    flux.text += text.replace(/[]/g, ""); // le modèle ne peut pas écrire de marqueur d'action
    flux.el.classList.remove("attend-modele", "is-preparation");
    afficherFlux(flux);
});

// Retire le JSON brut d'un appel d'outil écrit en texte par le modèle
window.api.onUndo(({ id, length }) => {
    const flux = fluxParId(id);
    if (!flux) return;
    flux.text = flux.text.slice(0, -length);
    afficherFlux(flux);
});

const ACTIONS = {
    ouvrir_dossier: (a) => `Demande à ouvrir ${a.chemin}`,
    lister_fichiers: (a) => `Regarde les fichiers${a.dossier ? " de " + a.dossier : ""}`,
    lire_fichier: (a) => `Lit ${a.chemin}`,
    chercher: (a) => `Cherche « ${a.texte} »${a.dossier ? " dans " + a.dossier : ""}`,
    ecrire_fichier: (a) => `Veut écrire ${a.chemin}`,
    remplacer_texte: (a) => `Veut modifier ${a.chemin}`,
    "refus-lecture": (a) => `Tu as refusé : ${a.chemin} n'a pas été lu`,
    "refus-page": (a) => `Tu as refusé : la page ${a.url} n'a pas été lue`,
    refus: (a) => `Refusé : ${a.chemin} n'a pas changé (mode prof)`,
    lister_connecteur: () => "Consulte le catalogue du connecteur",
    lire_connecteur: () => "Demande une lecture au connecteur",
    verifier_godot: () => "Propose de vérifier le projet Godot",
    lancer_tests: () => "Demande à lancer les tests du projet",
    proposer_tache: () => "Propose une tâche de fond",
    date_heure: () => "Regarde l'heure",
    bilan_tests: (a) => a.bilan,
    lire_document: (a) => (a.texte ? `Cherche « ${a.texte} » dans le document` : `Lit le document${Number(a.ligne) > 1 ? ` à partir de la ligne ${Math.floor(Number(a.ligne))}` : ""}`),
    chercher_web: (a) => `Cherche sur internet « ${a.requete} »`,
    lire_page_web: (a) => `Lit la page ${a.url}`,
    memoriser: (a) => `Retient : ${a.fait}`,
    pause: (a) => `Pause de ${a.secondes} s : limite par minute du fournisseur, je réessaie tout seul`,
    limite: (a) => `Arrêt après ${a.etapes} étapes d'outils pour ce message : dis-moi « continue » pour que je reprenne`
};
// En mode Auto, l'agent écrit tout de suite dans sa copie : il ne « veut » plus, il fait
const ACTIONS_AUTO = {
    ecrire_fichier: (a) => `Écrit ${a.chemin} (copie)`,
    remplacer_texte: (a) => `Modifie ${a.chemin} (copie)`,
};

window.api.onTool(({ id, name, args }) => {
    const flux = fluxParId(id);
    if (!flux) return;
    const texte = ((flux.auto && ACTIONS_AUTO[name]) || ACTIONS[name] || (() => name))(args || {});
    // Une ligne spéciale, affichée comme une petite étiquette
    flux.text += etiquetteAction(texte);
    afficherFlux(flux);
});

// Action terminée, résumée en une ligne par main.js : gardée avec la réponse, pour les messages suivants
window.api.onAction(({ id, action }) => {
    const flux = fluxParId(id);
    if (flux) flux.actions.push(action);
});

function finirFlux(flux) {
    fluxParConv.delete(flux.conv);
    ligneAttente(flux)?.remove();
    flux.el.classList.remove("is-typing");
    flux.chat.reflechit = false;
    majVeille();
    majBoutonEnvoi();
    renderList();
    majSaisie();
}

window.api.onDone(({ id, interrompu, statistiquesOllama, nombreOutils }) => {
    const flux = fluxParId(id);
    if (!flux) return;
    if (flux.discussionEntamee) afficherFlux(flux, true);
    const texte = texteDuFlux(flux, true).replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    const { conv, remplace, wrap } = flux;
    if ((!remplace || !interrompu) && (texte || flux.actions.length)) {
        const message = { role: "assistant", content: texte };
        if (!interrompu) message.dureeReponse = performance.now() - flux.debut;
        if (!interrompu && statistiquesOllama?.length) {
            message.statistiquesOllama = statistiquesOllama;
            message.nombreOutils = nombreOutils;
            const lent = noterVitesse(flux.modele, syntheseOllama(statistiquesOllama));
            if (lent) message.lenteur = lent;
        }
        if (!interrompu && flux.statistiquesResume?.length) message.statistiquesResume = flux.statistiquesResume;
        if (flux.actions.length) message.actions = flux.actions;
        if (remplace) conv.messages.pop();
        conv.messages.push(message);
        if (!remplace) ajouterActionsMessage(wrap, conv, message);
        if (flux.conv !== current) conv.nonLu = true;
    }
    // Réponse finie : le chat sautille, content
    flux.chat.sautiller(2);
    flux.chat.expression("content", 1400);
    finirFlux(flux);
    if (remplace) {
        wrap.remove();
        if (current === conv) renderConv();
    }
    save();
    void proposerTitre(conv, flux, interrompu);
});

// Après la première réponse, le modèle propose un titre court à la place des premiers mots du message.
// Seulement avec Ollama (gratuit, sans quota), une seule fois, en arrière-plan ; un titre renommé à la main ne bouge plus.
const titresEnCours = new Set(); // hors de la discussion : jamais enregistré
async function proposerTitre(conv, flux, interrompu) {
    if (interrompu || !flux.local || !flux.modele || conv.titreChoisi || conv.titreIA || titresEnCours.has(conv)) return;
    // Après la première réponse ; si Ollama était occupé, on retente aux deux réponses suivantes
    if (conv.messages.filter((m) => m.role === "assistant").length > 3) return;
    const premier = conv.messages.find((m) => m.role === "user");
    const texte = (premier?.affichage || premier?.content || "").trim();
    if (!texte) return;
    titresEnCours.add(conv);
    let titre = null;
    try { titre = await window.api.titreDiscussion({ model: flux.modele, premierMessage: texte }); } catch {}
    titresEnCours.delete(conv);
    if (titre?.occupe) return; // Ollama occupé : pas de tentative comptée
    conv.titreIA = true; // une seule vraie tentative par discussion
    if (typeof titre !== "string" || !titre || conv.titreChoisi || !convs.includes(conv)) return;
    conv.title = titre;
    save();
    renderList();
}


window.api.onError(({ id, error, modeleCasse }) => {
    const flux = fluxParId(id);
    if (!flux) return;

    const { conv, remplace, wrap, actions } = flux;
    const bulle = flux.el;

    const texte = texteDuFlux(flux, true)
        .replace(/<think>[\s\S]*?<\/think>/g, "")
        .trim();

    const contenuPresent = Boolean(texte || actions.length);

    bulle.closest(".msg").classList.add("error");

    if (contenuPresent) {
        afficherFlux(flux, true);

        const avertissement = document.createElement("div");
        avertissement.className = "erreur-generation";
        avertissement.textContent = `Réponse interrompue : ${error}`;
        bulle.appendChild(avertissement);
    } else {
        bulle.textContent = `Aïe, ça a planté : ${error}`;
    }

    // Sauvegarder uniquement les nouvelles réponses incomplètes.
    // En régénération, conserver la réponse précédente.
    if (contenuPresent && !remplace) {
        const message = {
            role: "assistant",
            content: texte,
            affichage: `${texte}\n\n> **Réponse interrompue.**`,
            interrompu: true,
            erreurGeneration: String(error)
        };

        if (actions.length) {
            message.actions = [...actions];
        }

        conv.messages.push(message);
        ajouterActionsMessage(wrap, conv, message);
        save();
    }

    flux.chat.expression("fache");

    const ici = conv === current;

    if (!ici) {
        conv.nonLu = true;

        // Éviter d'afficher deux fois une réponse déjà sauvegardée.
        if (remplace || !contenuPresent) {
            erreursEnAttente.set(conv, {
                wrap,
                bulle,
                modeleCasse
            });
        }
    }

    finirFlux(flux);

    if (modeleCasse && ici) {
        remplacerModeleCasse(modeleCasse, bulle);
    }
});

// Le fournisseur dit que ce modèle n'existe plus : main.js l'a retiré de la liste,
// on recharge les modèles, on en prend un autre et on propose de renvoyer le message
async function remplacerModeleCasse(modele, bulle) {
    reglages = await window.api.lireFournisseurs();
    modelSel.value = ""; // l'ancien modèle n'est plus « avant » : loadModels choisit le meilleur remplaçant
    await loadModels();
    const remplacant = modelSel.value;
    const f = fournisseurActif();
    const info = document.createElement("p");
    info.textContent = remplacant
        ? `${modele} ne marche pas (ou plus) avec l'app chez ${f.nom} : je l'ai retiré de la liste et j'ai pris ${remplacant} à la place.`
        : `${modele} ne marche pas (ou plus) avec l'app chez ${f.nom}, et je n'en trouve pas d'autre : choisis un autre fournisseur.`;
    bulle.append(info);
    if (!remplacant) return;
    await window.api.choisirFournisseur({ id: f.id, modele: remplacant });
    // Renvoyer le dernier message avec le nouveau modèle, sans le doubler dans l'historique
    const dernier = current?.messages.at(-1);
    if (dernier?.role !== "user" || dernier.fichiers?.length) return;
    const bouton = document.createElement("button");
    bouton.className = "lien";
    bouton.textContent = "Renvoyer mon message";
    bouton.onclick = () => {
        if (conversationOccupee(current)) return;
        current.messages.pop();
        const messages = [...messagesEl.querySelectorAll(".msg")];
        messages.at(-1)?.remove(); // l'erreur
        messages.at(-2)?.remove(); // le message de l'utilisateur, renvoyé juste après
        send(dernier.content);
    };
    bulle.append(bouton);
}

$("#composer").addEventListener("submit", (e) => {
    e.preventDefault();
    // Le carré n'arrête que la réponse de la discussion affichée ; les autres continuent
    const fluxIci = fluxParConv.get(current);
    if (fluxIci) { window.api.stop(fluxIci.id); return; }
    if (reponseVivante(current)) return; // envoi en préparation (résumé, projet) : on garde le texte tapé
    const texte = input.value;
    if (!texte.trim() && !pieces.length) return;
    // Une commande « / » s'exécute au lieu de partir au chat ; les pièces jointes restent en place
    const commande = trouverCommande(texte);
    if (commande) { viderSaisie(); executerCommande(commande.commande, commande.argument); return; }
    const destination = current;
    const configuration = configurationDuTour();
    // Les pièces partent avec ce message : changer de discussion pendant la vérification ne les mélange pas
    const piecesPrises = pieces;
    pieces = [];
    renderPieces();
    preparations.set(destination, { conv: destination });
    majSaisie();
    window.api.demandeMemoire(texte).then((resultat) => {
        terminerPreparation(destination);
        if (resultat.traitee) {
            addMessage('info', resultat.message, [], {}, null, destination);
            rendrePiecesA(destination, piecesPrises);
        } else void send(texte, destination, configuration, piecesPrises);
    }, () => {
        terminerPreparation(destination);
        rendrePiecesA(destination, piecesPrises);
        addMessage('error', 'Impossible de vérifier la demande de mémoire.', [], {}, null, destination);
    });
    input.value = "";
    majEnvoi();
    input.style.height = "auto";
});

input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (reponseVivante(current)) return;
        $("#composer").requestSubmit();
        return;
    }
    // Flèche du haut au début de la saisie : le message d'avant. Flèche du bas à la fin : le suivant, puis le brouillon.
    const haut = e.key === "ArrowUp" && input.selectionStart === 0 && input.selectionEnd === 0;
    const bas = e.key === "ArrowDown" && anciens && input.selectionStart === input.value.length;
    if (!haut && !bas) return;
    const etat = parcourirAnciens(anciensMessages(current?.messages), anciens, haut ? -1 : 1, input.value);
    if (!etat) return;
    e.preventDefault();
    input.value = etat.texte;
    input.dispatchEvent(new Event("input"));
    anciens = etat.position === anciensMessages(current?.messages).length ? null : etat; // l'évènement input l'a remis à zéro
    const curseur = haut ? 0 : input.value.length;
    input.setSelectionRange(curseur, curseur);
});
let anciens = null; // où on en est dans les anciens messages (interface/saisie.js) ; null : on tape un nouveau message

input.addEventListener("input", () => {
    anciens = null;
    input.style.height = "auto";
    input.style.height = input.scrollHeight + "px";
});

document.querySelectorAll(".suggestions button").forEach((b) => (b.onclick = () => send(b.dataset.prompt)));

/* ---------- Commandes « / » (interface/commandes.js) ---------- */
// On tape /, un menu propose les commandes ; flèches pour choisir, Entrée ou Tab pour valider, Échap pour fermer.
// Le focus reste dans la saisie : le menu suit le texte tapé.
const menuCommandes = $("#menu-commandes");
let commandeActive = 0;

function majMenuCommandes() {
    const liste = filtrerCommandes(input.value);
    if (!liste.length) { fermerCommandes(); return; }
    commandeActive = Math.min(commandeActive, liste.length - 1);
    menuCommandes.replaceChildren(...liste.map((c, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.tabIndex = -1;
        b.id = "commande-" + c.nom;
        b.className = "menu-modeles__choix menu-choix menu-commande" + (i === commandeActive ? " is-actif" : "");
        b.setAttribute("role", "option");
        b.setAttribute("aria-selected", String(i === commandeActive));
        const pictogramme = document.createElement("span");
        pictogramme.className = "menu-choix__icone";
        pictogramme.innerHTML = icone(c.icone);
        const nom = document.createElement("span");
        nom.className = "menu-commande__nom";
        nom.textContent = "/" + c.nom + (c.argument ? ` [${c.argument}]` : "");
        const texte = document.createElement("span");
        texte.className = "menu-choix__nom";
        texte.textContent = c.texte;
        b.append(pictogramme, nom, texte);
        b.onmousedown = (e) => e.preventDefault(); // la saisie garde le focus
        b.onclick = () => choisirCommande(c);
        return b;
    }));
    menuCommandes.hidden = false;
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-activedescendant", "commande-" + liste[commandeActive].nom);
    menuCommandes.querySelector(".is-actif")?.scrollIntoView({ block: "nearest" });
}

function fermerCommandes() {
    menuCommandes.hidden = true;
    commandeActive = 0;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
}

function viderSaisie() {
    input.value = "";
    input.dispatchEvent(new Event("input"));
    majEnvoi();
}

// Une commande qui attend un texte (/renommer, /modele…) se complète dans la saisie ; les autres partent tout de suite
function choisirCommande(c) {
    if (c.argument) {
        input.value = "/" + c.nom + " ";
        input.dispatchEvent(new Event("input"));
        input.focus();
        return;
    }
    viderSaisie();
    executerCommande(c, "");
}

// Une petite réponse à une commande, dans le champ vide, quelques secondes
let minuterieNote = null;
function noteSaisie(texte) {
    clearTimeout(minuterieNote);
    input.placeholder = texte;
    minuterieNote = setTimeout(majSaisie, 3500);
}

function exporterDiscussion(conv) {
    const lien = document.createElement("a");
    lien.href = URL.createObjectURL(new Blob([discussionEnMarkdown(conv, NOM_DU_CHAT)], { type: "text/markdown;charset=utf-8" }));
    lien.download = nomDeFichier(conv.title);
    lien.click();
    setTimeout(() => URL.revokeObjectURL(lien.href), 1000);
}

function executerCommande(c, argument) {
    fermerCommandes();
    input.focus();
    switch (c.nom) {
        case "nouveau": $("#new-chat").click(); break;
        case "modele": {
            $("#modele-raccourci").click();
            const recherche = $("#menu-modeles .menu-modeles__recherche");
            if (recherche && argument) { recherche.value = argument; recherche.dispatchEvent(new Event("input")); }
            recherche?.focus();
            break;
        }
        case "rapide":
        case "reflexion":
            if (!reflexionPossible) { noteSaisie("Ce modèle répond toujours sans réfléchir"); break; }
            choisirReflexion(c.nom === "reflexion");
            noteSaisie(c.nom === "reflexion" ? "Réflexion : il réfléchit avant de répondre" : "Rapide : il répond tout de suite");
            break;
        case "prof": boutonProf.click(); break;
        case "joindre": ajouterFichiers(); break;
        case "dossier": choisirProjet(); break;
        case "renommer":
            if (!current) { noteSaisie("Pas encore de discussion à renommer"); break; }
            if (!argument) { renommerDiscussion(); break; }
            current.title = argument.slice(0, 80);
            current.titreChoisi = true;
            $("#titre-conv").textContent = current.title;
            save();
            renderList();
            break;
        case "garder":
        case "jeter":
            agirSurCopie(c.nom);
            break;
        case "agent": {
            // Sans texte : la page Tâches, le champ prêt ; avec : la tâche part en fond (interface/taches.js)
            if (!argument) { document.querySelector('[data-page="taches"]')?.click(); break; }
            ajouterTache(argument).then((r) => noteSaisie(r.ok ? "Tâche ajoutée : elle tourne en fond (page Tâches)" : r.erreur));
            break;
        }
        case "chantier": {
            // Le mode Équipe : le chef découpe le plan, les codeurs le font, le relecteur vérifie (en fond aussi)
            if (!argument) { document.querySelector('[data-page="taches"]')?.click(); break; }
            ajouterTache(argument, "equipe").then((r) => noteSaisie(r.ok ? "Chantier ajouté : l'équipe travaille en fond (page Tâches)" : r.erreur));
            break;
        }
        case "taches": document.querySelector('[data-page="taches"]')?.click(); break;
        case "exporter":
            if (!current?.messages?.length) { noteSaisie("Pas encore de discussion à exporter"); break; }
            exporterDiscussion(current);
            break;
        case "recherche":
            montrerRecherche(true);
            if (argument) { $("#conv-recherche").value = argument; $("#conv-recherche").dispatchEvent(new Event("input")); }
            break;
        case "memoire": $("#open-memory").click(); break;
        case "modeles": document.querySelector('[data-page="modeles"]')?.click(); break;
        case "reglages": ouvrirFournisseurs(); break;
        case "terminal": $("#ouvrir-terminal").click(); break;
    }
}

input.setAttribute("aria-controls", "menu-commandes");
input.setAttribute("aria-expanded", "false");
input.addEventListener("input", majMenuCommandes);
input.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== input) fermerCommandes(); }, 0));
// En capture : passe avant Entrée = envoyer et avant les flèches = anciens messages
input.addEventListener("keydown", (e) => {
    if (menuCommandes.hidden) return;
    const boutons = [...menuCommandes.querySelectorAll(".menu-commande")];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        commandeActive = (commandeActive + (e.key === "ArrowDown" ? 1 : boutons.length - 1)) % boutons.length;
        majMenuCommandes();
    } else if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        boutons[commandeActive]?.click();
    } else if (e.key === "Escape") {
        fermerCommandes();
    } else return;
    e.preventDefault();
    e.stopImmediatePropagation();
}, true);

messagesEl.addEventListener("animationend", (e) => { if (e.target === messagesEl) messagesEl.classList.remove("is-change"); });
$("#renommer-conv").innerHTML = icone("stylo");
$("#renommer-conv").onclick = () => renommerDiscussion();
$("#titre-conv").ondblclick = () => renommerDiscussion();
// F2 renomme la discussion ouverte, sauf si on est en train d'écrire ailleurs
window.addEventListener("keydown", (e) => {
    if (e.key !== "F2" || e.defaultPrevented || !current || e.target.closest?.("input, textarea, select, .conv__ouvrir")) return;
    e.preventDefault();
    renommerDiscussion();
});

$("#new-chat").onclick = () => {
    current = null;
    renderConv();
    input.focus();
};


/* ---------- 6. Grand chat de l'accueil ---------- */
const mascotte = $("#mascotte");
const bulle = $("#bulle");
const bulleTexte = $("#bulle-texte");
const grandChat = new ChatNoir($("#grand-chat"));

let minuterieFrappe = null;
let derniereReplique = "";
const auHasard = (liste) => {
    // Évite de répéter la dernière réplique, sauf s'il n'y a qu'elle
    const autres = liste.filter((r) => r !== derniereReplique);
    const choix = autres.length ? autres : liste;
    return choix[Math.floor(Math.random() * choix.length)];
};

// La réplique reste visible tant que le chat est éveillé.
function dire(texte) {
    if (!texte) return;
    derniereReplique = texte;
    clearInterval(minuterieFrappe);
    bulle.classList.remove("is-hidden");
    let n = 0;
    minuterieFrappe = setInterval(() => {
        bulleTexte.textContent = texte.slice(0, ++n);
        if (n >= texte.length) {
            clearInterval(minuterieFrappe);
        }
    }, 24);
}

$("#mascotte-bouton").addEventListener("click", () => {
    if (grandChat.endormi) { reveiller(); return; }
    grandChat.sauter();
    dire(auHasard(REPLIQUES.clics));
});

// Sommeil : pas d'activité depuis un moment
let minuterieSommeil = null;
function endormir() {
    if (grandChat.endormi || fluxParConv.size) return;
    ChatNoir.tous.forEach((c) => (c.endormi = true));
    clearInterval(minuterieFrappe);
    bulle.classList.add("is-hidden");
    mascotte.classList.add("is-asleep");
}
function reveiller() {
    if (!grandChat.endormi) return;
    ChatNoir.tous.forEach((c) => (c.endormi = false));
    mascotte.classList.remove("is-asleep");
    grandChat.etirer();
    if (!welcomeEl.hidden) dire(REPLIQUES.reveil);
}
function surActivite() {
    clearTimeout(minuterieSommeil);
    minuterieSommeil = setTimeout(endormir, SOMMEIL_APRES);
    if (grandChat.endormi) reveiller();
}
["pointermove", "pointerdown", "keydown"].forEach((type) => window.addEventListener(type, surActivite, { passive: true }));



/* ---------- 7. Projet ---------- */
function renderProject() {
    // Le dossier ouvert s'affiche comme un état ; sans dossier, c'est le menu + qui propose d'en ouvrir un
    $("#projet-groupe").hidden = !project;
    $("#project-name").textContent = project ? project.split(/[\\/]/).pop() : "Dossier";
    $("#open-project").title = project || "Ouvrir un dossier pour que le chat lise son contenu";
    $("#open-project").classList.toggle("is-on", !!project);
    $("#close-project").hidden = !project;
    renderModeAgent();
}

async function choisirProjet() {
    project = await window.api.openProject();
    renderProject();
}

$("#open-project").onclick = choisirProjet;
$("#close-project").onclick = async () => { project = await window.api.closeProject(); renderProject(); };
window.api.onProjectChanged((p) => {
    const change = p && p !== project;
    project = p;
    renderProject();
    // Sur l'accueil, le chat commente le projet qu'on vient d'ouvrir
    if (change && !welcomeEl.hidden) {
        const cle = Object.keys(REPLIQUES.projets).find((k) => p.split(/[\\/]/).pop().toLowerCase().includes(k));
        if (cle) dire(REPLIQUES.projets[cle]);
    }
});


/* ---------- 7b. Mode prof et rôles ---------- */
const boutonProf = $("#mode-prof");

function renderProf() {
    boutonProf.setAttribute("aria-checked", String(prof));
    // Yeux bleus et lunettes pour tous les chats
    document.body.classList.toggle("mode-prof", prof);
    ChatNoir.lunettes = prof;
    ChatNoir.rafraichirCouleurs();
    majSaisie();
    renderModeAgent();
}

// La saisie n'est bloquée que si c'est la discussion affichée qui prépare ou génère :
// les autres discussions peuvent envoyer pendant ce temps
function majSaisie() {
    messagesEl.classList.toggle("is-occupe", !!reponseVivante(current));
    input.placeholder = prof ? "Mode prof : pose ta question, il t'aide à trouver par toi-même" : "Écris au chat…";
}

boutonProf.onclick = () => {
    prof = !prof;
    try { localStorage.setItem("modeProf", prof ? "1" : "0"); } catch {}
    renderProf();
    if (!welcomeEl.hidden) dire(prof ? REPLIQUES.prof : REPLIQUES.normal);
};

/* Mode de génération : Rapide (think:false, par défaut) ou Réflexion (think:true).
   Le bouton n'apparaît que pour un modèle Ollama qui sait réfléchir ; chez les fournisseurs en ligne
   et les modèles sans réflexion, le comportement reste inchangé. */
let reflexion = false;        // préféré de l'utilisateur, retenu entre les sessions
let reflexionPossible = false; // le modèle choisi sait réfléchir (réponse d'Ollama /api/show)
const boutonReflexion = $("#mode-reflexion");

function renderReflexion() {
    boutonReflexion.hidden = !reflexionPossible;
    const actif = reflexion && reflexionPossible;
    boutonReflexion.classList.toggle("is-reflexion", actif);
    boutonReflexion.querySelector(".pastille__etiquette").textContent = actif ? "Réflexion" : "Rapide";
    // Même icône que dans le menu : un éclair pour Rapide, une ampoule pour Réflexion
    boutonReflexion.firstElementChild.innerHTML = icone(actif ? "ampoule" : "eclair");
    boutonReflexion.title = actif
        ? "Réflexion : le modèle raisonne avant de répondre, plus lent mais plus solide"
        : "Rapide : réponse directe. Clique pour choisir le niveau de réflexion";
}

// Modifications des fichiers avec un dossier ouvert : Demander ou Auto (voir « Mode Auto » plus bas).
// var : renderProject et renderProf l'utilisent dès le démarrage.
var modeAuto = (() => { try { return localStorage.getItem("modeAgent") === "auto"; } catch { return false; } })();
function renderModeAgent() {
    const bouton = $("#mode-agent");
    bouton.hidden = !project || prof;
    bouton.classList.toggle("is-on", !!modeAuto);
    bouton.querySelector(".pastille__etiquette").textContent = modeAuto ? "Auto" : "Demander";
    bouton.firstElementChild.innerHTML = icone(modeAuto ? "route" : "stylo");
    bouton.title = modeAuto
        ? "Auto : l'agent modifie une copie du projet sans demander ; à la fin, tu gardes ou tu jettes"
        : "Demander : tu valides chaque modification de fichier";
}

// Le menu du bouton choisit le niveau ; le choix est retenu pour les prochaines fois
function choisirReflexion(oui) {
    reflexion = oui;
    try { localStorage.setItem("modeReflexion", reflexion ? "1" : "0"); } catch {}
    renderReflexion();
}

// Une seule vérification par modèle choisi : /api/show est interrogé au changement, et re-demandé si Ollama ne répondait pas
let modeleReflexionVu = "";
async function majModeReflexion(f) {
    const cle = `${f.id}:${modelSel.value}`;
    if (cle === modeleReflexionVu) return;
    if (f.type !== "ollama" || !modelSel.value) {
        modeleReflexionVu = cle;
        reflexionPossible = false;
        renderReflexion();
        return;
    }
    try {
        const c = await window.api.capacitesModele({ fournisseurId: f.id, modele: modelSel.value });
        reflexionPossible = !!c.reflexion;
        modeleReflexionVu = cle;
    } catch {
        reflexionPossible = false; // Ollama ne répond pas : le bouton attend, on retentera au prochain tour
    }
    renderReflexion();
}

/* ---------- 7c. Fichiers glissés dans la fenêtre ---------- */
const depot = $("#depot");
const listePiecesEl = $("#pieces");

function renderPieces() {
    listePiecesEl.innerHTML = "";
    listePiecesEl.hidden = !pieces.length;
    pieces.forEach((p, i) => {
        const li = etiquettePiece(p.pages ? `${p.nom} · ${p.pages} p.` : p.nom, p.apercu);
        const retirer = document.createElement("button");
        retirer.type = "button";
        retirer.title = "Retirer";
        retirer.textContent = "×";
        retirer.onclick = () => { pieces.splice(i, 1); renderPieces(); };
        li.append(retirer);
        listePiecesEl.append(li);
    });
}

let profondeurGlisser = 0; // dragenter / dragleave se déclenchent aussi sur les enfants
window.addEventListener("dragenter", (e) => { e.preventDefault(); profondeurGlisser++; depot.hidden = false; });
window.addEventListener("dragleave", () => { if (--profondeurGlisser <= 0) { profondeurGlisser = 0; depot.hidden = true; } });
window.addEventListener("dragover", (e) => e.preventDefault());
// Une pièce jointe, quel que soit le chemin choisi : glisser-déposer, bouton + (fichier ou image).
// La lecture passe toujours par readDropped : mêmes vérifications (fichier sensible, format, taille, document).
async function joindreChemin(choix) {
    // Une pièce « lecture… » s'affiche tout de suite : un gros PDF peut prendre un moment
    const nom = typeof choix === "string" ? choix.split(/[\\/]/).pop() : choix.name || "fichier";
    const pourConv = convDuBrouillon; // la lecture peut finir après un changement de discussion
    const attente = etiquettePiece(`${nom} · lecture…`);
    attente.classList.add("piece--attente");
    listePiecesEl.append(attente);
    listePiecesEl.hidden = false;
    let res;
    try {
        res = await window.api.readDropped(choix);
    } catch (err) {
        attente.remove();
        addMessage("error", "Lecture impossible : " + err.message);
        return;
    }
    attente.remove();
    if (res.dossier) { project = await window.api.openProjectPath(res.chemin); return; }
    if (res.erreur) { addMessage("error", res.erreur); return; }
    const memeFichier = (p) => p.chemin === res.chemin;
    if (pourConv === convDuBrouillon) { if (!pieces.some(memeFichier)) pieces.push(res); return; }
    const b = brouillons.get(pourConv) || { texte: "", pieces: [] };
    if (!b.pieces.some(memeFichier)) brouillons.set(pourConv, { ...b, pieces: [...b.pieces, res] });
}

window.addEventListener("drop", async (e) => {
    e.preventDefault(); // sinon Electron ouvre le fichier à la place de l'app
    profondeurGlisser = 0;
    depot.hidden = true;
    for (const fichier of e.dataTransfer.files) await joindreChemin(fichier);
    renderPieces();
    input.focus();
});


/* ---------- 7d. Fenêtre avant / après ---------- */
const CONTEXTE = 3; // lignes inchangées gardées autour de chaque modification

function afficherDifference(lignes) {
    const zone = $("#diff-contenu");
    zone.innerHTML = "";
    const proches = lignes.map((l, k) => l.type !== "pareil" || lignes.slice(Math.max(0, k - CONTEXTE), k + CONTEXTE + 1).some((x) => x.type !== "pareil"));
    let saute = 0;
    const sauter = () => {
        if (!saute) return;
        const div = document.createElement("div");
        div.className = "diff__saut";
        div.textContent = `… ${saute} ligne${saute > 1 ? "s" : ""} inchangée${saute > 1 ? "s" : ""}`;
        zone.append(div);
        saute = 0;
    };
    lignes.forEach((l, k) => {
        if (!proches[k]) { saute++; return; }
        sauter();
        const div = document.createElement("div");
        div.className = "diff__ligne" + (l.type === "ajout" ? " is-ajout" : l.type === "retrait" ? " is-retrait" : "");
        const cases = [l.na ?? "", l.nb ?? "", l.type === "ajout" ? "+" : l.type === "retrait" ? "-" : " ", l.t];
        cases.forEach((texte, n) => {
            const span = document.createElement("span");
            span.className = ["diff__num", "diff__num", "diff__signe", ""][n];
            span.textContent = texte;
            div.append(span);
        });
        zone.append(div);
    });
    sauter();
}

let confirmationEnCours = null;
let confirmationRequeteId = null; // la génération qui a demandé la confirmation (plusieurs peuvent tourner)

window.api.onConfirmWrite(({ id, requeteId, chemin, ancien, nouveau, existe }) => {
    confirmationEnCours = id;
    confirmationRequeteId = requeteId ?? null;
    const lignes = difference(ancien, nouveau);
    const ajouts = lignes.filter((l) => l.type === "ajout").length;
    const retraits = lignes.filter((l) => l.type === "retrait").length;
    $("#diff-type").textContent = existe ? "Modification de fichier" : "Nouveau fichier";
    $("#diff-chemin").textContent = chemin;
    $("#diff-stats").textContent = !existe
        ? `${ajouts} ligne${ajouts > 1 ? "s" : ""}`
        : ajouts + retraits === 0 ? "Aucun changement" : `+${ajouts}  -${retraits}`;
    afficherDifference(lignes);
    $("#diff-modal").hidden = false;
    // Boutons bloqués un court instant : un clic ou Entrée tapé juste avant ne valide rien par accident
    const boutons = [$("#diff-accepter"), $("#diff-refuser")];
    boutons.forEach((b) => (b.disabled = true));
    setTimeout(() => {
        if (confirmationEnCours !== id) return;
        boutons.forEach((b) => (b.disabled = false)); $("#diff-refuser").focus();
    }, 600);
});

function repondreConfirmation(ok) {
    if (confirmationEnCours === null) return;
    window.api.replyConfirmWrite(confirmationEnCours, ok);
    // Le refus apparaît aussi dans la réponse qui l'a demandée, pour qu'on ne puisse pas croire que le fichier a changé
    if (!ok) {
        const flux = fluxParId(confirmationRequeteId);
        if (flux) {
            flux.text += etiquetteAction("Tu as refusé : le fichier n'a pas changé");
            afficherFlux(flux);
        }
    }
    confirmationEnCours = null;
    $("#diff-modal").hidden = true;
}

$("#diff-accepter").onclick = () => repondreConfirmation(true);
$("#diff-refuser").onclick = () => repondreConfirmation(false);
window.api.onConfirmCancel(({ id }) => {
    if (confirmationEnCours !== id) return;
    confirmationEnCours = null; $("#diff-modal").hidden = true;
});
window.addEventListener("keydown", (e) => { if (e.key === "Escape" && confirmationEnCours !== null) repondreConfirmation(false); });


/* ---------- 8. Mémoire ---------- */
function renderMemory() {
    $("#memory-count").textContent = memory.length;
    const list = $("#memory-list");
    list.innerHTML = "";
    if (!memory.length) list.innerHTML = '<li class="discret">Rien pour l\'instant.</li>';
    memory.forEach((fait, i) => {
        const li = document.createElement("li");
        const texte = document.createElement("span");
        texte.textContent = fait;

        // Modifier un souvenir sur place : Ctrl+Entrée enregistre, Échap annule. main.js nettoie le texte.
        const modifier = document.createElement("button");
        modifier.textContent = "Modifier";
        modifier.onclick = () => {
            const boite = document.createElement("div");
            boite.className = "memoire-edition";
            const champ = document.createElement("textarea");
            champ.value = fait;
            champ.rows = 2;
            champ.maxLength = 200;
            const actions = document.createElement("div");
            actions.className = "memoire-edition__actions";
            const enregistrer = document.createElement("button");
            enregistrer.textContent = "Enregistrer";
            enregistrer.className = "bouton";
            enregistrer.onclick = async () => {
                const nouveau = champ.value.trim();
                if (!nouveau) return champ.focus();
                memory[i] = nouveau;
                memory = await window.api.saveMemory(memory);
                renderMemory();
            };
            const annuler = document.createElement("button");
            annuler.textContent = "Annuler";
            annuler.className = "lien";
            annuler.onclick = () => renderMemory();
            champ.onkeydown = (e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) enregistrer.click();
                if (e.key === "Escape") {
                    e.preventDefault();
                    annuler.click();
                }
            };
            actions.append(annuler, enregistrer);
            boite.append(champ, actions);
            li.replaceChildren(boite);
            champ.focus();
            champ.select();
        };

        const oublier = document.createElement("button");
        oublier.textContent = "Oublier";
        oublier.onclick = () => { memory.splice(i, 1); window.api.saveMemory(memory); renderMemory(); };
        li.append(texte, modifier, oublier);
        list.appendChild(li);
    });
}

$("#memory-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("#memory-input").value.trim();
    if (!v) return;
    memory.push(v);
    $("#memory-input").value = "";
    window.api.saveMemory(memory);
    renderMemory();
});

// La mémoire s'ouvre depuis les Réglages ; en la fermant, on revient aux Réglages
$("#open-memory").onclick = () => { $("#reglages-modal").hidden = true; $("#prenom-actuel").textContent = prenom; $("#memory-modal").hidden = false; $("#close-memory").focus(); };
$("#changer-prenom").onclick = async () => { $("#memory-modal").hidden = true; await demanderPrenom(); };

// Fenêtre du prénom : au premier lancement, ou depuis « Mémoire ». Elle ne se ferme qu'avec un prénom.
function demanderPrenom() {
    const modal = $("#prenom-modal");
    const champ = $("#prenom-input");
    champ.value = prenom;
    modal.hidden = false;
    champ.focus();
    return new Promise((resolve) => {
        $("#prenom-form").onsubmit = async (e) => {
            e.preventDefault();
            if (!champ.value.trim()) return champ.focus();
            prenom = await window.api.setPrenom(champ.value);
            renderSalutation(); // le titre de l'accueil dit tout de suite le prénom
            modal.hidden = true;
            resolve();
        };
    });
}

// Un souvenir en train d'être modifié n'est pas effacé : seul le compteur change, la liste suivra à l'enregistrement
window.api.onMemoryChanged((m) => {
    memory = m;
    if ($("#memory-list .memoire-edition")) $("#memory-count").textContent = memory.length;
    else renderMemory();
});

// Ce que le chat vient de retenir tout seul : affiché un moment sous « Mémoire », avec un bouton pour l'annuler
const memoireAjoutEl = $("#memoire-ajout");
let minuterieMemoireAjout = null;

window.api.onMemoireAjout(({ fait, remplace }) => {
    memoireAjoutEl.textContent = `Retenu : « ${fait} » `;
    const annuler = document.createElement("button");
    annuler.type = "button";
    annuler.className = "lien lien--petit";
    annuler.textContent = "Annuler";
    annuler.onclick = () => {
        // Si le fait en remplaçait un autre, l'ancien revient à sa place
        memory = memory.flatMap((f) => (f === fait ? (remplace ? [remplace] : []) : [f]));
        window.api.saveMemory(memory);
        renderMemory();
        memoireAjoutEl.textContent = "";
    };
    memoireAjoutEl.append(annuler);
    clearTimeout(minuterieMemoireAjout);
    minuterieMemoireAjout = setTimeout(() => (memoireAjoutEl.textContent = ""), 20000);
});


/* ---------- 8b. Fournisseurs et modèles ---------- */
// Les clés ne passent jamais par ici : main.js nous dit seulement si une clé est enregistrée (aCle)
const fournisseurSel = $("#fournisseur");
let reglages = { actif: "ollama", modeles: {}, fournisseurs: [] };
const fournisseurActif = () => reglages.fournisseurs.find((f) => f.id === reglages.actif) || { id: "ollama", type: "ollama", nom: "Ollama" };

function renderFournisseurs() {
    fournisseurSel.innerHTML = reglages.fournisseurs
        .map((f) => `<option value="${escape(f.id)}">${escape(f.nom)}${f.aCle ? "" : " (pas de clé)"}</option>`)
        .join("");
    fournisseurSel.value = reglages.actif;
}

// Avec Ollama, le modèle choisi est chargé sur la carte graphique tout de suite, avec les consignes du prochain
// message déjà lues (main.js). loadModels repasse toutes les 10 s : on ne recommence que si le modèle ou les
// consignes ont changé (mode prof, rôle, dossier, mémoire), et jamais pendant une réponse, qu'Ollama oublierait.
let dejaPrechauffe = "";
async function prechauffer() {
    if (fournisseurActif().type !== "ollama" || !modelSel.value || conversationOccupee(current) || fluxLocalEnCours()) return;
    let infoProjet;
    try {
        infoProjet = await projectInfo("");
    } catch {
        return; // sans la liste du dossier, les consignes ne seraient pas celles du chat : rien à précharger
    }
    const consignes = systemPrompt();
    const cle = `${modelSel.value}\n${prof}\n${consignes}\n${infoProjet}`;
    if (cle === dejaPrechauffe || conversationOccupee(current) || fluxLocalEnCours()) return;
    dejaPrechauffe = cle;
    window.api.prechaufferOllama({ modele: modelSel.value, consignes, contexteProjet: infoProjet, prof });
}

// Le réveil du chat (main.js) : pendant qu'Ollama charge le modèle et lit les consignes (~20 s la première fois
// sur une petite carte graphique), un compteur remplace « Ollama connecté » ; ensuite, « Ollama prêt ».
let reveil = null;
let chatPret = false;
let minuteurReveil = null;
function majReveil({ enCours, debut, ok }) {
    clearInterval(minuteurReveil);
    if (enCours) {
        reveil = { debut };
        const maj = () => { statusEl.textContent = `Le chat se réveille… ${Math.max(0, Math.round((Date.now() - debut) / 1000))} s`; };
        statusEl.title = "Ollama charge le modèle et lit les consignes du chat : ensuite, tes messages partent tout de suite.";
        maj();
        minuteurReveil = setInterval(maj, 1000);
        return;
    }
    reveil = null;
    chatPret = !!ok;
    statusEl.title = "";
    if (fournisseurActif().type === "ollama") statusEl.textContent = ok ? "Ollama prêt" : "Ollama connecté";
}
window.api.onPrechauffage(majReveil);
window.api.etatPrechauffage().then((etat) => { if (etat.enCours) majReveil(etat); });

// Listes de modèles déjà reçues : le sélecteur unique s'ouvre sans attendre chaque fournisseur
const cacheModeles = new Map();
const DUREE_CACHE_MODELES = 30_000;
function modelesEnCache(id) {
    const garde = cacheModeles.get(id);
    return garde && Date.now() - garde.quand < DUREE_CACHE_MODELES ? garde.models : null;
}

async function loadModels(modeleDemande) {
    const f = fournisseurActif();
    renderAccueil(f);
    const { ok, models, erreur } = await window.api.models(f.id);
    if (f.id !== reglages.actif) return; // on a changé de fournisseur pendant la requête
    if (!ok) dejaPrechauffe = ""; // Ollama arrêté : quand il reviendra, sa mémoire sera vide, on préchargera à nouveau
    if (ok) cacheModeles.set(f.id, { models: [...models], quand: Date.now() });
    else cacheModeles.delete(f.id);
    const avant = modelSel.value;
    // Le conseillé en premier avec une étoile, les gourmands repérés par un ▲
    conseille = modeleConseille(models, f.id);
    const ordre = conseille ? [conseille, ...models.filter((m) => m !== conseille)] : models;
    modelSel.innerHTML = ordre
        .map((m) => {
            const repere = m === conseille ? "★ " : estGourmand(m, f.id) ? "▲ " : "";
            return `<option value="${escape(m)}">${repere}${escape(m)}</option>`;
        })
        .join("");
    const retenu = reglages.modeles[f.id];
    if (models.includes(modeleDemande)) modelSel.value = modeleDemande;
    else if (models.includes(avant)) modelSel.value = avant;
    else if (models.includes(retenu)) modelSel.value = retenu;
    else if (models.length) modelSel.value = modeleParDefaut(models, f.id);
    afficherConseil();
    prechauffer();
    majModeReflexion(f);
    statusEl.className = "statut" + (ok && models.length ? " is-ok" : " is-erreur");
    statusEl.title = erreur || "";
    if (!ok) chatPret = false;
    // Pendant le réveil, c'est le compteur qui parle (majReveil)
    if (f.type === "ollama") {
        if (!(ok && reveil)) statusEl.textContent = !ok ? "Ollama ne répond pas" : models.length ? (chatPret ? "Ollama prêt" : "Ollama connecté") : "Aucun modèle installé";
    } else statusEl.textContent = ok ? `${f.nom} connecté · en ligne` : (erreur || "").split("\n")[0] || `${f.nom} ne répond pas`;
    await renderDemarrage(f, ok ? models : []);
}


/* ---------- Premier lancement : avoir un modèle ---------- */

const LIEN_OLLAMA = "https://ollama.com/download";
let etatOllama = { installe: true, repond: true };
let telechargement = false; // pendant un téléchargement, la carte Ollama n'est pas redessinée

function lienExterne(texte, url, classe) {
    const a = document.createElement("a");
    a.className = classe;
    a.href = url;
    a.target = "_blank"; // ouvert dans le navigateur par main.js
    a.textContent = texte;
    return a;
}

function boutonAction(texte, classe, action) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = classe;
    b.textContent = texte;
    b.onclick = action;
    return b;
}

// Qwen conseillé selon la carte graphique (principal/materiel.js) : demandé une seule fois
let conseil = null;

// Sans aucun modèle pour le fournisseur choisi, les suggestions laissent la place aux deux façons d'en avoir un
async function renderDemarrage(f, models) {
    const bloc = $("#demarrage");
    bloc.hidden = models.length > 0;
    $(".suggestions").hidden = !bloc.hidden || !$(".suggestions").children.length;
    if (bloc.hidden) return;
    etatOllama = await window.api.etatOllama();

    if (!telechargement) {
        conseil = conseil || await window.api.conseilMateriel();
        const modele = conseil.modele;
        const actions = $("#demarrage-ollama-actions");
        actions.replaceChildren();
        if (etatOllama.repond) {
            const carte = conseil.vramGo ? `ta carte graphique (${conseil.vramGo} Go)` : "un PC sans carte graphique dédiée";
            $("#demarrage-ollama-texte").textContent = `Ollama est là, il lui manque un modèle. Pour ${carte}, je conseille ${modele} : ${conseil.raison}. `
                + `Environ ${String(conseil.taille).replace(".", ",")} Go à télécharger une seule fois.`
                + (conseil.geminiMieux ? " Ton PC est un peu juste : Gemini sera plus rapide." : "");
            actions.append(boutonAction(`Télécharger ${modele}`, "bouton", () => telechargerModele(modele)));
        } else if (etatOllama.installe) {
            $("#demarrage-ollama-texte").textContent = "Ollama est installé mais ne répond pas. Relance l'app, ou lance Ollama toi-même.";
        } else {
            $("#demarrage-ollama-texte").textContent = "Gratuit, sans limite, et rien ne sort de ton PC. Mais il demande un PC puissant, type PC gamer récent : sur un PC portable classique, il sera très lent. Dans le doute, prends Gemini.";
            if (etatOllama.installationWindows) actions.append(boutonAction("Installer Ollama", "bouton", installerOllama));
            actions.append(lienExterne("Télécharger Ollama", LIEN_OLLAMA, etatOllama.installationWindows ? "lien" : "bouton"));
        }
    }

    const gemini = reglages.fournisseurs.find((x) => x.id === "gemini");
    const actions = $("#demarrage-gemini-actions");
    actions.replaceChildren();
    if (f.id === "gemini" && gemini?.aCle) {
        $("#demarrage-gemini-texte").textContent = `Gemini ne répond pas : ${statusEl.title.split("\n")[0] || "vérifie ta connexion"}.`;
        actions.append(boutonAction("Changer la clé", "lien", ouvrirFournisseurs));
    } else if (gemini?.aCle) {
        $("#demarrage-gemini-texte").textContent = "Ta clé Gemini est enregistrée.";
        actions.append(boutonAction("Utiliser Gemini", "bouton", () => { fournisseurSel.value = "gemini"; fournisseurSel.dispatchEvent(new Event("change")); }));
    } else {
        // Clé guidée pas à pas, sans passer par le panneau « Clés API »
        $("#demarrage-gemini-texte").textContent = "Gratuit, avec un compte Google. Tes messages et les fichiers que je lis partent chez Google.";
        const etapes = document.createElement("ol");
        etapes.innerHTML = "<li>Ouvre Google AI Studio et clique sur « Create API key ».</li><li>Copie la clé et colle-la ici.</li>";
        const champ = document.createElement("input");
        champ.type = "password";
        champ.placeholder = "Colle ta clé ici";
        champ.autocomplete = "off";
        const message = document.createElement("p");
        message.className = "conseil";
        const valider = boutonAction("C'est prêt", "bouton", async () => {
            const cle = champ.value.trim();
            champ.value = ""; // la clé ne reste pas dans la page
            if (!cle) return champ.focus();
            const r = await window.api.enregistrerFournisseur({ id: "gemini", cle });
            if (!r.ok) { message.textContent = r.erreur; return; }
            reglages = r.reglages;
            renderFournisseurs();
            fournisseurSel.value = "gemini";
            fournisseurSel.dispatchEvent(new Event("change"));
        });
        actions.append(etapes, lienExterne("Ouvrir Google AI Studio", LIENS_CLES.gemini, "lien"), champ, valider, message);
    }
}

async function installerOllama() {
    if (telechargement) return;
    telechargement = true;
    const texte = $("#demarrage-ollama-texte");
    const avant = texte.textContent;
    const bouton = $("#demarrage-ollama-actions button");
    if (bouton) bouton.disabled = true;
    texte.textContent = "Installation d’Ollama en cours…";
    let resultat;
    try { resultat = await window.api.installerOllama(); }
    catch { resultat = { erreur: "Impossible de lancer l’installation d’Ollama." }; }
    finally { telechargement = false; if (bouton) bouton.disabled = false; }
    if (resultat.ok) await loadModels();
    else texte.textContent = resultat.erreur || avant;
}

async function telechargerModele(modele) {
    telechargement = true;
    $("#demarrage-ollama-actions").replaceChildren();
    $("#demarrage-progression").textContent = "Ça démarre…";
    const r = await window.api.telechargerModele(modele);
    telechargement = false;
    $("#demarrage-progression").textContent = r.ok ? "" : `Le téléchargement a échoué : ${r.erreur}`;
    loadModels();
}

// Ollama envoie des étapes en anglais : on ne garde que la progression
window.api.onProgressionOllama(({ statut = "", fait = 0, total }) => {
    $("#demarrage-progression").textContent = total
        ? `Téléchargement : ${Math.floor((fait / total) * 100)} % de ${(total / 1e9).toFixed(1)} Go`
        : statut === "success" ? "Terminé." : /verif/i.test(statut) ? "Vérification…" : "Préparation…";
});

// Change de fournisseur, avec parfois un modèle précis choisi dans le sélecteur unique
async function changerFournisseur(id, modeleDemande) {
    // Le choix est figé pendant la génération affichée ; les autres discussions peuvent continuer
    if (conversationOccupee(current)) { fournisseurSel.value = reglages.actif; return; }
    const r = await window.api.choisirFournisseur({ id, modele: modeleDemande });
    if (!r.ok) { fournisseurSel.value = reglages.actif; return; }
    reglages = r.reglages;
    fournisseurSel.value = reglages.actif;
    modelSel.innerHTML = "";
    statusEl.textContent = "Connexion…";
    statusEl.className = "statut";
    await loadModels(modeleDemande);
    if (fournisseurActif().type !== "ollama" && !fournisseurActif().aCle) ouvrirFournisseurs();
}

fournisseurSel.addEventListener("change", () => changerFournisseur(fournisseurSel.value));

// Sous la liste : pourquoi le modèle choisi est conseillé, ou pourquoi il est gourmand
let conseille = null;
const conseilEl = $("#conseil-modele");

function afficherConseil() {
    renderRaccourci();
    const id = fournisseurActif().id;
    const choisi = modelSel.value;
    conseilEl.innerHTML = "";
    conseilEl.className = "conseil";
    if (!choisi) return;
    if (choisi === conseille) {
        conseilEl.classList.add("is-conseille");
        conseilEl.textContent = `★ Conseillé : ${RAISON_CONSEIL[id] || "le meilleur choix ici"}`;
        return;
    }
    if (estGourmand(choisi, id)) {
        conseilEl.classList.add("is-gourmand");
        conseilEl.textContent = `▲ Gourmand : ${GOURMANDS[id].raison}. `;
    }
    if (conseille) {
        const bouton = document.createElement("button");
        bouton.type = "button";
        bouton.className = "lien lien--petit";
        bouton.textContent = `Prendre le conseillé (${conseille})`;
        bouton.addEventListener("click", () => {
            modelSel.value = conseille;
            modelSel.dispatchEvent(new Event("change"));
        });
        conseilEl.append(bouton);
    }
}

/* ---------- Raccourci du modèle, sous la saisie ---------- */

// Messages envoyés aujourd'hui, par fournisseur (sur ce PC seulement)
const cleQuota = () => `quota-${fournisseurActif().id}-${new Date().toISOString().slice(0, 10)}`;
function messagesDuJour() {
    try { return Number(localStorage.getItem(cleQuota())) || 0; } catch { return 0; }
}
function compterMessage() {
    try { localStorage.setItem(cleQuota(), String(messagesDuJour() + 1)); } catch {}
    renderRaccourci();
}

const nomCourt = (m) => m.split("/").pop().replace(/:free$/, "");

function renderRaccourci() {
    const f = fournisseurActif();
    const modele = modelSel.value;
    const nomFournisseur = f.nom.replace(/ \(local\)$/, "");
    $("#fournisseur-nom").textContent = nomFournisseur;
    const affichage = FOURNISSEURS_AFFICHAGE[f.id] || FOURNISSEURS_AFFICHAGE.perso;
    $("#fournisseur-icone").className = `menu-icone menu-icone--petite menu-icone--${affichage.couleur}`;
    $("#fournisseur-icone").innerHTML = icone(affichage.icone);
    $("#modele-nom").textContent = modele ? nomCourt(modele) : "aucun";
    const resume = $("#reglages-cerveau");
    if (resume) resume.textContent = `${nomFournisseur} · ${modele ? nomCourt(modele) : "aucun modèle"}`;
    const limite = quotaDuJour(f.id, modele);
    const faits = messagesDuJour();
    // Le rond est plein quand il reste tout le quota, et se vide au fil des messages.
    // Sans limite (Ollama) ou quota inconnu (serveur perso), il ne veut rien dire : caché, le titre suffit.
    const arc = $("#quota-arc");
    const rond = arc.closest("svg");
    if (limite === Infinity || !limite) {
        rond.style.display = "none";
    } else {
        rond.style.display = "";
        const reste = Math.max(0, 1 - faits / limite);
        const tour = 2 * Math.PI * 7;
        arc.style.strokeDasharray = `${tour * reste} ${tour}`;
        arc.classList.toggle("is-bas", reste < 0.15);
    }
    const cerveau = modele ? `${nomFournisseur} · ${modele}` : `${nomFournisseur} · aucun modèle`;
    $("#modele-raccourci").title = limite === Infinity
        ? `${cerveau} : sur ton PC, sans limite`
        : limite
            ? `${cerveau} : ${faits} message${faits > 1 ? "s" : ""} aujourd'hui, sur environ ${limite} gratuits par jour`
            : `${cerveau} : ${faits} message${faits > 1 ? "s" : ""} aujourd'hui · quota du serveur inconnu`;
}

// Un choix dans un menu de raccourci
function choixMenu(menu, texte, actif, action, classe = "", deco = null) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `menu-modeles__choix ${classe}${actif ? " is-on" : ""}`;
    b.setAttribute("role", "menuitem");
    if (deco) {
        // Icône en couleur, nom, et petit conseil en dessous
        const pastille = document.createElement("span");
        pastille.className = `menu-icone menu-icone--${deco.couleur}`;
        pastille.innerHTML = icone(deco.icone);
        const textes = document.createElement("span");
        textes.className = "menu-textes";
        const nom = document.createElement("span");
        nom.textContent = texte;
        textes.append(nom);
        if (deco.conseil) {
            const petit = document.createElement("small");
            petit.textContent = deco.conseil;
            textes.append(petit);
        }
        b.append(pastille, textes);
    } else b.textContent = texte;
    b.onclick = () => { fermerMenus(); action(); };
    menu.append(b);
}

// Un modèle dans le menu : son nom, une étiquette courte à droite (Intégré, Gourmand…), une coche s'il est en service.
// La phrase complète du conseil reste dans l'infobulle : pas de petit texte gris sous chaque modèle.
function choixModele(menu, texte, actif, action, deco, fournisseur = "") {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "menu-modeles__choix menu-modele" + (actif ? " is-on" : "");
    b.setAttribute("role", "menuitemradio");
    b.setAttribute("aria-checked", String(!!actif));
    const nom = document.createElement("span");
    nom.className = "menu-modele__nom";
    nom.textContent = texte;
    b.append(nom);
    if (fournisseur) {
        const qui = document.createElement("span");
        qui.className = "menu-modele__fournisseur";
        qui.textContent = fournisseur;
        nom.append(qui);
    }
    // « Sans limite » sur chaque modèle d'Ollama n'apprend rien : seules les étiquettes utiles restent
    const etiquette = (deco?.conseil || "").split(" · ")[0].replace(/^Environ (\d+) messages par jour$/, "≈ $1 / jour");
    if (deco?.conseil) b.title = deco.conseil;
    if (etiquette && etiquette !== "Sans limite") {
        const tag = document.createElement("span");
        tag.className = `menu-modele__tag menu-modele__tag--${deco.couleur || "gris"}`;
        tag.textContent = etiquette.replace(/^Intégré par Cat Ai$/, "Intégré");
        b.append(tag);
    }
    if (actif) {
        const coche = document.createElement("span");
        coche.className = "menu-choix__coche";
        coche.innerHTML = icone("coche");
        b.append(coche);
    }
    b.onclick = () => { fermerMenus(); action(); };
    menu.append(b);
}

// Une ligne discrète dans un menu : chargement, liste vide, ou erreur d'un fournisseur
function noteMenu(conteneur, texte, erreur = false) {
    const note = document.createElement("p");
    note.className = "menu-modeles__vide" + (erreur ? " menu-modeles__vide--erreur" : "");
    note.textContent = texte;
    conteneur.append(note);
}

let generationMenuModeles = 0;

// Les derniers modèles utilisés, tous fournisseurs confondus : en tête du menu, comme dans OpenCode
const MAX_RECENTS = 3;
function lireRecents() {
    try { return JSON.parse(localStorage.getItem("modelesRecents") || "[]").filter((r) => r?.f && r?.m).slice(0, MAX_RECENTS); } catch { return []; }
}
function retenirRecent(fournisseurId, modele) {
    const liste = [{ f: fournisseurId, m: modele }, ...lireRecents().filter((r) => !(r.f === fournisseurId && r.m === modele))].slice(0, MAX_RECENTS);
    try { localStorage.setItem("modelesRecents", JSON.stringify(liste)); } catch {}
}

// Sélecteur unique, sobre : une ligne de recherche, les récents, puis un groupe par fournisseur qui se déroule.
// Les modèles de chaque fournisseur prêt sont chargés en arrière-plan (mis en cache 30 s).
function ouvrirMenuModeles() {
    const menu = $("#menu-modeles");
    const generation = ++generationMenuModeles;
    menu.replaceChildren();

    // En haut : la loupe, la recherche, et « + » pour ajouter un fournisseur
    const tete = document.createElement("div");
    tete.className = "menu-modeles__tete";
    const loupe = document.createElement("span");
    loupe.className = "menu-modeles__loupe";
    loupe.innerHTML = icone("loupe");
    const recherche = document.createElement("input");
    recherche.type = "search";
    recherche.className = "menu-modeles__recherche";
    recherche.placeholder = "Rechercher un modèle";
    recherche.setAttribute("aria-label", "Chercher un fournisseur ou un modèle");
    recherche.autocomplete = "off";
    recherche.spellcheck = false;
    const ajouter = document.createElement("button");
    ajouter.type = "button";
    ajouter.className = "menu-modeles__ajouter";
    ajouter.title = "Ajouter un fournisseur";
    ajouter.setAttribute("aria-label", "Ajouter un fournisseur");
    ajouter.innerHTML = icone("plus");
    ajouter.onclick = () => { fermerMenus(); ouvrirFournisseurs(); };
    tete.append(loupe, recherche, ajouter);

    const liste = document.createElement("div");
    liste.className = "menu-modeles__liste";
    liste.id = "menu-modeles-liste";
    recherche.setAttribute("aria-controls", liste.id);
    menu.append(tete, liste);

    // Le fournisseur actif d'abord : c'est celui qu'on change le plus souvent
    const fournisseurs = reglages.fournisseurs
        .filter((f) => f.type === "ollama" || f.aCle)
        .sort((a, b) => (a.id === reglages.actif ? -1 : b.id === reglages.actif ? 1 : 0));

    const groupes = fournisseurs.map((f) => ({
        f,
        models: f.id === reglages.actif && modelSel.options.length
            ? [...modelSel.options].map((o) => o.value)
            : modelesEnCache(f.id),
        chargement: false,
        erreur: null,
    }));
    const nomDe = (f) => f.nom.replace(/ \(local\)$/, "");
    const estActif = (f, m) => f.id === reglages.actif && m === modelSel.value;
    const choisir = (f, m) => () => { retenirRecent(f.id, m); choisirCerveau(f, m); };

    // Chaque fournisseur se replie : seul celui en service est ouvert au départ
    const ouverts = new Set([reglages.actif]);

    const dessiner = () => {
        if (generation !== generationMenuModeles) return; // menu rouvert depuis
        const q = sansAccents(recherche.value.trim());
        liste.replaceChildren();
        let trouves = 0;

        // Récents : seulement sans recherche (pendant une recherche, une seule liste, sans doublon)
        const recents = q ? [] : lireRecents()
            .map((r) => ({ r, g: groupes.find((g) => g.f.id === r.f) }))
            .filter(({ r, g }) => g && (g.models || []).includes(r.m));
        if (recents.length) {
            const section = document.createElement("section");
            section.className = "menu-modeles__groupe menu-modeles__groupe--recents";
            section.setAttribute("role", "group");
            section.setAttribute("aria-label", "Récents");
            const titre = document.createElement("p");
            titre.className = "menu-modeles__section";
            titre.textContent = "Récents";
            section.append(titre);
            for (const { r, g } of recents) {
                choixModele(section, nomCourt(r.m), estActif(g.f, r.m), choisir(g.f, r.m), conseilModele(r.m, g.f.id, modeleConseille(g.models, g.f.id)), nomDe(g.f));
            }
            liste.append(section);
        }

        for (const g of groupes) {
            const nom = nomDe(g.f);
            const fournisseurCorrespond = sansAccents(`${nom} ${g.f.id}`).includes(q);
            const visibles = (g.models || []).filter((m) => fournisseurCorrespond || sansAccents(m).includes(q));
            if (q && !fournisseurCorrespond && !visibles.length) continue;
            trouves++;
            const groupe = document.createElement("section");
            groupe.className = "menu-modeles__groupe";
            groupe.setAttribute("role", "group");
            groupe.setAttribute("aria-label", nom);
            // Une recherche ouvre tous les fournisseurs où elle trouve quelque chose
            const ouvert = !!q || ouverts.has(g.f.id);
            groupe.classList.toggle("is-ouvert", ouvert);
            const entete = document.createElement("button");
            entete.type = "button";
            entete.className = "menu-modeles__titre menu-modeles__titre--fournisseur";
            entete.setAttribute("aria-expanded", String(ouvert));
            const affichage = FOURNISSEURS_AFFICHAGE[g.f.id] || FOURNISSEURS_AFFICHAGE.perso;
            const pastille = document.createElement("span");
            pastille.className = `menu-icone menu-icone--petite menu-icone--${affichage.couleur}`;
            pastille.innerHTML = icone(affichage.icone);
            const fleche = document.createElement("span");
            fleche.className = "menu-modeles__fleche";
            fleche.innerHTML = icone("chevron");
            entete.append(pastille, document.createTextNode(nom), fleche);
            // Le groupe se déroule en douceur : on bascule une classe, sans redessiner le menu
            entete.onclick = (e) => {
                e.stopPropagation();
                const ouvre = !groupe.classList.contains("is-ouvert");
                if (ouvre) ouverts.add(g.f.id); else ouverts.delete(g.f.id);
                groupe.classList.toggle("is-ouvert", ouvre);
                entete.setAttribute("aria-expanded", String(ouvre));
            };
            const contenu = document.createElement("div");
            contenu.className = "menu-modeles__contenu";
            const interieur = document.createElement("div");
            interieur.className = "menu-modeles__interieur";
            contenu.append(interieur);
            groupe.append(entete, contenu);
            if (g.chargement) noteMenu(interieur, "Chargement des modèles…");
            else if (g.erreur) noteMenu(interieur, g.erreur, true);
            else if (!g.models?.length) noteMenu(interieur, "Aucun modèle disponible");
            else {
                const conseilleF = modeleConseille(g.models, g.f.id);
                for (const m of visibles) choixModele(interieur, nomCourt(m), estActif(g.f, m), choisir(g.f, m), conseilModele(m, g.f.id, conseilleF));
            }
            liste.append(groupe);
        }
        if (!trouves) noteMenu(liste, q ? "Aucun modèle ne correspond." : "Aucun fournisseur prêt : ajoute une clé.");
    };

    const charger = (g) => {
        if (g.models || g.chargement) return;
        g.chargement = true;
        dessiner();
        window.api.models(g.f.id).then(({ ok, models, erreur }) => {
            if (generation !== generationMenuModeles) return;
            g.chargement = false;
            g.models = ok ? models || [] : [];
            g.erreur = ok ? null : (erreur || "Le fournisseur ne répond pas.");
            if (ok) cacheModeles.set(g.f.id, { models: g.models, quand: Date.now() });
            dessiner();
        }).catch((err) => {
            if (generation !== generationMenuModeles) return;
            g.chargement = false;
            g.models = [];
            g.erreur = err?.message || "Le fournisseur ne répond pas.";
            dessiner();
        });
    };
    groupes.forEach(charger);

    recherche.addEventListener("input", dessiner);
    recherche.addEventListener("keydown", (e) => {
        // Entrée ne doit jamais envoyer le message : elle prend le premier modèle trouvé
        if (e.key !== "Enter") return;
        e.preventDefault();
        liste.querySelector(".menu-modeles__groupe:not(.menu-modeles__groupe--recents) .menu-modeles__choix")?.click();
    });

    dessiner();
    menu.hidden = false;
    recherche.focus();
}


// Choisit un modèle : même fournisseur, changement direct ; autre fournisseur, on le charge d'abord
function choisirCerveau(f, modele) {
    if (f.id !== reglages.actif) { changerFournisseur(f.id, modele); return; }
    if (modele === modelSel.value) return;
    modelSel.value = modele;
    modelSel.dispatchEvent(new Event("change"));
}

// Un titre en haut d'un menu : la liste reste lisible quand elle grandit
function titreMenu(menu, texte) {
    const t = document.createElement("div");
    t.className = "menu-modeles__titre";
    t.textContent = texte;
    menu.append(t);
}

function fermerMenus() {
    document.querySelectorAll(".menu-modeles").forEach((m) => (m.hidden = true));
    document.querySelectorAll('.raccourci .pastille[aria-expanded="true"]').forEach((b) => b.setAttribute("aria-expanded", "false"));
}

// Flèches pour passer d'un choix à l'autre, Échap pour fermer — comme un vrai menu
function naviguerMenu(e) {
    const menu = e.currentTarget;
    if (e.key === "Escape") {
        e.preventDefault();
        const declencheur = menu.closest(".raccourci")?.querySelector(".pastille");
        fermerMenus();
        declencheur?.focus();
        return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const choix = [...menu.querySelectorAll(".menu-modeles__choix")];
    if (!choix.length) return;
    const i = choix.indexOf(document.activeElement);
    if (i === -1) { (e.key === "ArrowDown" ? choix[0] : choix[choix.length - 1]).focus(); return; }
    choix[Math.min(choix.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))].focus();
}

// Une ligne de menu sobre, comme dans Claude : une icône, une phrase claire, le raccourci à droite,
// une coche sur le choix en cours. L'explication reste dans l'infobulle, pas en petit gris sous le texte.
function choixSimple(menu, texte, dessin, action, { actif = null, raccourci = "", aide = "" } = {}) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "menu-modeles__choix menu-choix" + (actif ? " is-on" : "");
    b.setAttribute("role", actif === null ? "menuitem" : "menuitemradio");
    if (actif !== null) b.setAttribute("aria-checked", String(actif));
    if (aide) b.title = aide;
    const pictogramme = document.createElement("span");
    pictogramme.className = "menu-choix__icone";
    pictogramme.innerHTML = icone(dessin);
    const nom = document.createElement("span");
    nom.className = "menu-choix__nom";
    nom.textContent = texte;
    b.append(pictogramme, nom);
    if (raccourci) {
        const touche = document.createElement("kbd");
        touche.className = "menu-choix__raccourci";
        touche.textContent = raccourci;
        b.append(touche);
    }
    if (actif) {
        const coche = document.createElement("span");
        coche.className = "menu-choix__coche";
        coche.innerHTML = icone("coche");
        b.append(coche);
    }
    b.onclick = () => { fermerMenus(); action(); };
    menu.append(b);
}

// Fichiers ou photos : un seul sélecteur, plusieurs fichiers d'un coup. La lecture passe toujours par
// readDropped, qui applique les mêmes vérifications que le glisser-déposer (sensible, format, taille).
async function ajouterFichiers() {
    const chemins = await window.api.choisirFichier({ plusieurs: true });
    if (!chemins?.length) return; // annulé : rien n'est joint
    for (const chemin of chemins) await joindreChemin(chemin);
    renderPieces();
}

// Menu du bouton + : des fichiers ou des photos, ou un dossier entier
function ouvrirMenuJoindre() {
    const menu = $("#menu-joindre");
    menu.replaceChildren();
    choixSimple(menu, "Ajouter des fichiers ou des photos", "trombone", ajouterFichiers, { aide: "Texte, code, PDF, Word, images… (Ctrl+U)" });
    choixSimple(menu, "Ajouter un dossier", "dossier", choisirProjet, { aide: "Le chat lira son contenu" });
    menu.hidden = false;
}

// Menu du niveau de réflexion : Rapide (réponse directe) ou Réflexion (le modèle raisonne d'abord)
function ouvrirMenuReflexion() {
    const menu = $("#menu-reflexion");
    menu.replaceChildren();
    choixSimple(menu, "Rapide", "eclair", () => choisirReflexion(false), { actif: !reflexion, aide: "Répond tout de suite" });
    choixSimple(menu, "Réflexion", "ampoule", () => choisirReflexion(true), { actif: reflexion, aide: "Réfléchit avant de répondre : plus lent, plus solide" });
    menu.hidden = false;
}

const basculer = (id, ouvrir) => (e) => {
    e.stopPropagation();
    const menu = $(`#${id}`);
    const etaitOuvert = !menu.hidden;
    const focusDedans = menu.contains(document.activeElement);
    fermerMenus();
    if (etaitOuvert) {
        // Fermé au clavier (ou depuis la recherche) : le focus revient au bouton, jamais dans un menu caché
        if (focusDedans || e.detail === 0) e.currentTarget.focus();
        return;
    }
    ouvrir();
    e.currentTarget.setAttribute("aria-expanded", "true");
};
$("#modele-raccourci").onclick = basculer("menu-modeles", ouvrirMenuModeles);
$("#joindre").onclick = basculer("menu-joindre", ouvrirMenuJoindre);
boutonReflexion.onclick = basculer("menu-reflexion", ouvrirMenuReflexion);
["menu-modeles", "menu-joindre", "menu-reflexion", "menu-agent"].forEach((id) => $(`#${id}`).addEventListener("keydown", naviguerMenu));

/* ---------- Mode Auto : l'agent écrit sur une copie git du projet (main.js, principal/copie-agent.js) ---------- */
// Demander (par défaut) : une fenêtre avant / après pour chaque fichier. Auto : l'agent écrit sans demander dans sa
// copie ; la barre au-dessus de la saisie montre ce qui a changé, avec Voir, Garder et Jeter.
$("#mode-agent").onclick = basculer("menu-agent", ouvrirMenuAgent);
renderModeAgent();

function choisirModeAgent(auto) {
    modeAuto = auto;
    try { localStorage.setItem("modeAgent", auto ? "auto" : "demander"); } catch {}
    renderModeAgent();
}

function ouvrirMenuAgent() {
    const menu = $("#menu-agent");
    menu.replaceChildren();
    choixSimple(menu, "Demander avant de modifier", "stylo", () => choisirModeAgent(false), { actif: !modeAuto, aide: "Une fenêtre avant / après pour chaque fichier" });
    choixSimple(menu, "Auto, sur une copie", "route", () => choisirModeAgent(true), { actif: modeAuto, aide: "L'agent écrit sans demander dans une copie git du projet ; à la fin, tu gardes ou tu jettes" });
    menu.hidden = false;
}

// var : renderConv peut appeler renderBarreCopie au démarrage, avant cette ligne
var etatsCopie = new Map(); // discussion → { fichiers, ajouts, retraits } (null : inconnu ou en erreur)
const resumeCopie = (e) => `${e.fichiers} fichier${e.fichiers > 1 ? "s" : ""} modifié${e.fichiers > 1 ? "s" : ""} · +${e.ajouts} −${e.retraits}`;

window.api.onAgent(({ id, erreur, nom, base, fichiers, ajouts, retraits }) => {
    const flux = fluxParId(id);
    if (!flux) return;
    const conv = flux.conv;
    // Le dossier ne peut pas avoir de copie (pas de git…) : la réponse continue en mode Demander
    if (!nom) { if (erreur && conv === current) alerteCopie(erreur); return; }
    conv.agentCopie = { nom, base };
    etatsCopie.set(conv, erreur ? null : { fichiers: fichiers.length, ajouts, retraits });
    save();
    if (conv === current) renderBarreCopie();
});

var minuterieAlerteCopie = null;
async function renderBarreCopie() {
    if (!etatsCopie) return;
    const barre = $("#agent-barre");
    const conv = current;
    if (minuterieAlerteCopie) return; // une alerte est affichée pour quelques secondes
    barre.classList.remove("is-alerte");
    if (!conv?.agentCopie) { barre.hidden = true; return; }
    let etat = etatsCopie.get(conv);
    if (etat === undefined) {
        const r = await window.api.agentChangements(conv.agentCopie);
        if (conv !== current) return;
        if (r.perdue) { delete conv.agentCopie; save(); barre.hidden = true; return; }
        etat = r.ok ? { fichiers: r.fichiers.length, ajouts: r.ajouts, retraits: r.retraits } : null;
        etatsCopie.set(conv, etat);
    }
    barre.hidden = !etat?.fichiers;
    if (etat?.fichiers) $("#agent-resume").textContent = resumeCopie(etat);
}

// Un message court dans la barre, puis elle revient à son état
function alerteCopie(texte) {
    const barre = $("#agent-barre");
    clearTimeout(minuterieAlerteCopie);
    $("#agent-resume").textContent = texte;
    barre.classList.add("is-alerte");
    barre.hidden = false;
    minuterieAlerteCopie = setTimeout(() => { minuterieAlerteCopie = null; renderBarreCopie(); }, 7000);
}

async function agirSurCopie(action) {
    const conv = current;
    if (!conv?.agentCopie) { noteSaisie("L'agent n'a pas de changements en attente"); return; }
    const r = await (action === "garder" ? window.api.agentGarder(conv.agentCopie) : window.api.agentJeter(conv.agentCopie));
    if (r.annule) return;
    if (r.ok || r.perdue) {
        delete conv.agentCopie;
        etatsCopie.delete(conv);
        save();
        clearTimeout(minuterieAlerteCopie);
        minuterieAlerteCopie = null;
        if (conv === current) renderBarreCopie();
        noteSaisie(action === "garder" ? "Changements gardés dans ton projet" : "Changements jetés");
        return;
    }
    alerteCopie(r.erreur || "Impossible pour le moment.");
}

// Le patch de la copie, fichier par fichier, avec les mêmes couleurs que la fenêtre avant / après
function lignesPatch(patch) {
    const lignes = [];
    const bloc = (classe, texte) => { const el = document.createElement("div"); el.className = classe; el.textContent = texte; lignes.push(el); };
    for (const ligne of String(patch || "").split("\n")) {
        if (ligne.startsWith("diff --git ")) { bloc("diff__saut diff__fichier", ligne.replace(/^diff --git a\/(.+?) b\/.*$/, "$1")); continue; }
        if (ligne.startsWith("Binary files")) { bloc("diff__saut", "Fichier binaire modifié"); continue; }
        if (ligne.startsWith("@@") || ligne.startsWith("…")) { bloc("diff__saut", ligne); continue; }
        if (!ligne || /^(index |--- |\+\+\+ |new file mode|deleted file mode|similarity|rename |old mode|new mode|\\ )/.test(ligne)) continue;
        const el = document.createElement("div");
        el.className = "diff__ligne" + (ligne[0] === "+" ? " is-ajout" : ligne[0] === "-" ? " is-retrait" : "");
        for (const [classe, texte] of [["diff__num", ""], ["diff__num", ""], ["diff__signe", ligne[0] === " " ? "" : ligne[0]], ["diff__texte", ligne.slice(1)]]) {
            const s = document.createElement("span");
            s.className = classe;
            s.textContent = texte;
            el.append(s);
        }
        lignes.push(el);
    }
    return lignes;
}

async function voirChangementsCopie() {
    const conv = current;
    if (!conv?.agentCopie) return;
    const r = await window.api.agentChangements({ ...conv.agentCopie, patch: true });
    if (!r.ok) { alerteCopie(r.erreur || "Cette copie n'existe plus."); return; }
    $("#agent-diff-stats").textContent = resumeCopie({ fichiers: r.fichiers.length, ajouts: r.ajouts, retraits: r.retraits });
    $("#agent-diff-contenu").replaceChildren(...lignesPatch(r.patch));
    $("#agent-diff-modal").hidden = false;
    $("#agent-diff-fermer").focus();
}
const fermerChangementsCopie = () => { $("#agent-diff-modal").hidden = true; $("#agent-voir").focus(); };
$("#agent-voir").onclick = voirChangementsCopie;
$("#agent-garder").onclick = () => agirSurCopie("garder");
$("#agent-jeter").onclick = () => agirSurCopie("jeter");
$("#agent-diff-fermer").onclick = fermerChangementsCopie;
$("#agent-diff-modal").addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); fermerChangementsCopie(); return; }
    bouclerFocus($("#agent-diff-modal"), e);
});
renderBarreCopie();
document.addEventListener("click", (e) => { if (!e.target.closest(".raccourci")) fermerMenus(); });

// Ctrl+U (Cmd+U sur Mac) : ajouter des fichiers ou des photos, comme dans le menu +
window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "u") return;
    if (document.querySelector(".fenetre:not([hidden]), dialog[open]")) return;
    e.preventDefault();
    fermerMenus();
    ajouterFichiers();
});

// Ctrl+K (Cmd+K sur Mac) ouvre ou ferme le choix du fournisseur et du modèle.
// Une fenêtre ouverte garde la main : le raccourci ne va pas chercher un menu derrière elle.
window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "k") return;
    if (document.querySelector(".fenetre:not([hidden]), dialog[open]")) return;
    e.preventDefault();
    $("#modele-raccourci").click();
});

// Le modèle choisi est retenu pour chaque fournisseur
modelSel.addEventListener("change", async () => {
    afficherConseil();
    prechauffer();
    majModeReflexion(fournisseurActif());
    const r = await window.api.choisirFournisseur({ id: reglages.actif, modele: modelSel.value });
    if (r.ok) reglages = r.reglages;
});

// Le panneau : une carte par fournisseur en ligne, avec un champ password jamais pré-rempli
function renderPanneauFournisseurs() {
    const liste = $("#fournisseurs-liste");
    liste.innerHTML = "";
    // Le serveur personnalisé est réservé aux connaisseurs : rangé dans « Avancé »
    const avance = $("#fournisseurs-avance");
    if (avance) avance.innerHTML = "";
    reglages.fournisseurs.filter((f) => f.type !== "ollama").forEach((f) => {
        const carte = document.createElement("form");
        carte.className = "fournisseur" + (f.modifiable ? " fournisseur--perso" : "");
        carte.dataset.fournisseur = f.id;

        const tete = document.createElement("div");
        tete.className = "fournisseur__tete";
        const nom = document.createElement("span");
        nom.className = "fournisseur__nom";
        nom.textContent = f.nom;
        const etat = document.createElement("span");
        etat.className = "fournisseur__etat" + (f.aCle && !f.formatDouteux ? " is-ok" : "");
        etat.textContent = !f.aCle ? "Pas de clé" : f.formatDouteux ? "Format inhabituel" : "Clé enregistrée";
        tete.append(nom, etat);
        carte.append(tete);

        let champNom = null;
        let champUrl = null;
        if (f.modifiable) {
            // Personnalisé : nom et adresse saisis par l'utilisateur
            champNom = document.createElement("input");
            champNom.placeholder = "Nom (ex : LM Studio)";
            champNom.setAttribute("aria-label", "Nom du fournisseur personnalisé");
            champNom.value = f.nom === "Personnalisé" ? "" : f.nom;
            champUrl = document.createElement("input");
            // Seules les adresses gratuites sont acceptées par main.js (serveur local, Groq, OpenRouter, Gemini)
            champUrl.placeholder = "Serveur sur ton PC (ex : http://localhost:1234/v1)";
            champUrl.setAttribute("aria-label", "Adresse du serveur local");
            champUrl.value = f.baseUrl || "";
            carte.append(champNom, champUrl);
        }

        const rangee = document.createElement("div");
        rangee.className = "rangee";
        const champCle = document.createElement("input");
        champCle.type = "password";
        champCle.autocomplete = "off";
        champCle.spellcheck = false;
        champCle.placeholder = f.aCle ? "Clé enregistrée" : "Colle ta clé ici";
        champCle.setAttribute("aria-label", f.aCle ? `Nouvelle clé pour ${f.nom}, facultative` : `Clé API pour ${f.nom}`);
        const ok = document.createElement("button");
        ok.type = "submit";
        ok.className = "bouton";
        ok.textContent = "Enregistrer";
        rangee.append(champCle, ok);
        carte.append(rangee);

        // Les erreurs s'affichent ici, sans remplacer le lien « Obtenir une clé »
        const retour = document.createElement("p");
        retour.className = "fournisseur__message";
        retour.setAttribute("aria-live", "polite");

        const bas = document.createElement("div");
        bas.className = "rangee rangee--entre";
        if (LIENS_CLES[f.id]) {
            const message = document.createElement("p");
            message.className = "fournisseur__message";
            const lien = document.createElement("a");
            lien.href = LIENS_CLES[f.id];
            lien.target = "_blank"; // s'ouvre dans le navigateur (voir main.js)
            lien.className = "lien lien--petit";
            lien.textContent = "Obtenir une clé";
            message.append(lien);
            bas.append(message);
        }
        // Clé qui ne commence pas comme celles de ce fournisseur (main.js ne nous dit que vrai / faux)
        if (f.avertissement) {
            const alerte = document.createElement("p");
            alerte.className = "fournisseur__alerte";
            alerte.textContent = f.avertissement;
            carte.insertBefore(alerte, retour);
        }
        carte.append(retour);
        if (f.aCle) {
            const oublier = document.createElement("button");
            oublier.type = "button";
            oublier.className = "lien lien--petit fournisseur__oublier";
            oublier.textContent = "Supprimer la clé";
            oublier.onclick = () => {
                // Deuxième étape explicite : une clé ne disparaît jamais sur un clic malheureux
                const garde = document.createElement("span");
                garde.className = "fournisseur__confirmation";
                garde.setAttribute("role", "group");
                garde.setAttribute("aria-label", `Supprimer la clé de ${f.nom} ?`);
                const question = document.createElement("span");
                question.textContent = `Supprimer la clé de ${f.nom} ?`;
                const oui = document.createElement("button");
                oui.type = "button";
                oui.className = "lien lien--petit lien--danger";
                oui.textContent = "Oui, supprimer";
                const non = document.createElement("button");
                non.type = "button";
                non.className = "lien lien--petit";
                non.textContent = "Garder";
                oui.onclick = async () => {
                    oui.disabled = true;
                    const r = await window.api.enregistrerFournisseur({ id: f.id, cle: "" });
                    if (!r.ok) { retour.textContent = r.erreur; oui.disabled = false; return; }
                    reglages = r.reglages;
                    renderFournisseurs();
                    renderPanneauFournisseurs();
                    $("#reglages-statut").textContent = `Clé de ${f.nom} supprimée.`;
                    document.querySelector(`.fournisseur[data-fournisseur="${f.id}"] .bouton`)?.focus();
                    loadModels();
                };
                non.onclick = () => {
                    renderPanneauFournisseurs();
                    // Retour sur la commande d'origine, pas sur l'action dangereuse
                    document.querySelector(`.fournisseur[data-fournisseur="${f.id}"] .fournisseur__oublier`)?.focus();
                };
                garde.append(question, oui, non);
                bas.replaceWith(garde); // la confirmation prend sa propre ligne, sans se mêler aux liens
                non.focus(); // le choix sûr reçoit le focus
            };
            bas.append(oublier);
        }
        carte.append(bas);

        carte.onsubmit = async (e) => {
            e.preventDefault();
            const nouvelleCle = champCle.value.trim();
            const envoi = { id: f.id };
            if (nouvelleCle) envoi.cle = nouvelleCle;
            if (champNom) envoi.nom = champNom.value;
            if (champUrl) envoi.baseUrl = champUrl.value;
            champCle.value = ""; // la clé ne reste pas dans la page
            const r = await window.api.enregistrerFournisseur(envoi);
            if (!r.ok) { retour.textContent = r.erreur; return; }
            reglages = r.reglages;
            renderFournisseurs();
            renderPanneauFournisseurs();
            const nom = r.reglages.fournisseurs.find((x) => x.id === f.id)?.nom || f.nom;
            // Un retour durable, sans inventer : seule une vraie clé envoyée est annoncée comme enregistrée
            $("#reglages-statut").textContent = nouvelleCle
                ? `Clé de ${nom} enregistrée.`
                : f.modifiable ? `Réglages de ${nom} enregistrés.` : "";
            document.querySelector(`.fournisseur[data-fournisseur="${f.id}"] .bouton`)?.focus();
            if (f.id === reglages.actif) loadModels();
        };
        (f.id === "perso" && avance ? avance : liste).append(carte);
    });
}

function ouvrirFournisseurs() {
    // Qui protège vraiment les clés, selon le système (main.js le sait : Windows, trousseau de Linux…)
    $("#protection-cles").textContent = reglages.chiffrementDispo
        ? "Elle reste secrète sur ton PC."
        : `Ici, ton PC ne peut pas garder une clé secrète (${reglages.protection} indisponible) : utilise plutôt Ollama.`;
    $("#reglages-statut").textContent = "";
    renderPanneauFournisseurs();
    majCommandeCatai();
    $("#reglages-modal").hidden = false;
    $("#close-reglages").focus();
}

// La commande catai (Réglages › Avancé) : installée en un clic, sans npm link (principal/installer-catai.js)
let cataiInstallee = false;
async function majCommandeCatai(message = "") {
    try {
        const etat = await window.api.cataiEtat();
        cataiInstallee = !!etat.installee;
        $("#catai-installer").textContent = cataiInstallee ? "Retirer" : "Installer";
        $("#catai-etat").textContent = message || (cataiInstallee ? "Installée : tape catai dans un terminal." : "Cat Ai dans n'importe quel terminal : tape catai.");
    } catch { /* l'état reste celui d'avant */ }
}
$("#catai-installer").onclick = async () => {
    const bouton = $("#catai-installer");
    bouton.disabled = true;
    try {
        const r = cataiInstallee ? await window.api.cataiRetirer() : await window.api.cataiInstaller();
        await majCommandeCatai(r.ok ? r.message : r.erreur);
    } finally { bouton.disabled = false; }
};


// Le texte de l'accueil dit la vérité : tout reste sur le PC seulement avec Ollama ou un serveur local
// Ollama, ou un serveur sur le PC (LM Studio…) : rien ne sort du PC
const fournisseurLocal = (f) => f.type === "ollama" || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(f.baseUrl || "");

// Le titre de l'accueil change avec l'heure : quelques phrases par moment de la journée, une tirée au hasard.
// {p} est remplacé par le prénom (ou disparaît s'il n'y en a pas).
const SALUTATIONS = [
    { de: 5, a: 10, phrases: ["C'est l'heure du café{, p}", "Bien dormi{, p} ?", "Café et Cat Ai ?", "On commence doucement{, p} ?"] },
    { de: 10, a: 12, phrases: ["On s'y met{, p} ?", "Qu'est-ce qu'on apprend ce matin ?", "Prêt à bosser{, p} ?"] },
    { de: 12, a: 14, phrases: ["Pause déj{, p} ?", "On mange d'abord, ou on code ?", "Le chat a déjà mangé. Et toi ?"] },
    { de: 14, a: 18, phrases: ["On fait quoi cet après-midi ?", "Un coup de main{, p} ?", "Prêt pour l'après-midi{, p} ?"] },
    { de: 18, a: 22, phrases: ["Bonsoir{, p}", "On continue ce soir ?", "Une dernière idée avant ce soir ?"] },
    { de: 22, a: 29, phrases: ["Encore debout{, p} ?", "Les chats sortent la nuit", "Une idée de minuit ?"] },
];
function salutation(heure = new Date().getHours(), nom = "", hasard = Math.random) {
    const h = heure < 5 ? heure + 24 : heure;
    const moment = SALUTATIONS.find((s) => h >= s.de && h < s.a) || SALUTATIONS[3];
    const phrase = moment.phrases[Math.floor(hasard() * moment.phrases.length) % moment.phrases.length];
    return phrase.replace(/\{, p\}/g, nom ? `, ${nom}` : "");
}
// La phrase est tirée une fois par moment de la journée (renderAccueil repasse toutes les 10 s : elle ne doit pas changer sous les yeux)
let salutationRetenue = null;
function renderSalutation() {
    const heure = new Date().getHours();
    const h = heure < 5 ? heure + 24 : heure;
    const cle = SALUTATIONS.findIndex((m) => h >= m.de && h < m.a) + "|" + prenom;
    if (salutationRetenue?.cle !== cle) salutationRetenue = { cle, texte: salutation(heure, prenom) };
    $(".accueil__titre").textContent = salutationRetenue.texte;
}

// Sous le titre : rien avec un modèle local (tout reste sur le PC). Avec un fournisseur en ligne, on prévient
// que les messages passent par ses serveurs : c'est une information de confidentialité, pas une décoration.
function renderAccueil(f) {
    const texte = $("#accueil-texte");
    texte.hidden = fournisseurLocal(f);
    texte.textContent = fournisseurLocal(f) ? "" : `Modèle en ligne, chez ${f.nom} : tes messages passent par ses serveurs.`;
    renderSalutation();
}


/* ---------- 9. Démarrage ---------- */

// Un fichier de données abîmé a été réparé (readJson dans main.js) : l'utilisateur doit le savoir.
// Pendant le démarrage, les alertes attendent : renderConv() effacerait celles déjà affichées.
const alertesEnAttente = [];
let interfacePrete = false;

function afficherAlertes(alertes) {
    alertesEnAttente.push(...alertes);
    if (!interfacePrete) return;
    alertesEnAttente.splice(0).forEach((alerte) => addMessage("error", alerte));
}
window.api.onAlertesStockage(afficherAlertes);

// Le nom affiché dans la fenêtre vient de NOM_DU_CHAT
function appliquerNom() {
    document.title = NOM_DU_CHAT;
    // Le logo est dessiné en pixels (lettres nettes) ; le texte reste pour les lecteurs d'écran
    const logo = document.querySelector(".logo__nom");
    const dessin = motEnPixels(NOM_DU_CHAT);
    // Le logo : le vrai petit chat de la mascotte, vivant (il cligne, bouge la queue, suit la souris)
    if (!$("#logo-marque canvas")) {
        const toile = document.createElement("canvas");
        toile.className = "logo__chat";
        $("#logo-marque").replaceChildren(toile);
        new ChatNoir(toile);
    }
    if (dessin) { logo.innerHTML = dessin; logo.setAttribute("aria-label", NOM_DU_CHAT); }
    else logo.textContent = NOM_DU_CHAT;
    document.querySelector(".bulle__nom").textContent = NOM_DU_CHAT;
    $("#mascotte-bouton").setAttribute("aria-label", `${NOM_DU_CHAT} : cliquer pour qu'il parle`);
}

// Touches personnelles, dans perso.json à côté des données : jamais dans le code partagé, donc le chat
// des autres n'en sait rien. Tout est facultatif :
// { "origine": "la mascotte de son portfolio", "suggestions": [{ "titre": "…", "message": "…" }],
//   "repliquesProjets": { "morceau du nom du dossier": "réplique" } }
function appliquerPerso() {
    const texte = (v) => (typeof v === "string" ? v.trim().slice(0, 300) : "");
    perso.origine = texte(perso.origine);
    const suggestions = (Array.isArray(perso.suggestions) ? perso.suggestions : []).filter((s) => texte(s?.titre) && texte(s?.message)).slice(0, 4);
    if (suggestions.length) {
        $(".suggestions").replaceChildren(...suggestions.map((s) => {
            const b = document.createElement("button");
            b.className = "suggestion";
            const badge = document.createElement("span");
            badge.className = "suggestion__icone";
            badge.innerHTML = icone("etincelle");
            const titre = document.createElement("strong");
            titre.textContent = texte(s.titre);
            const bloc = document.createElement("span");
            bloc.className = "suggestion__texte";
            bloc.append(titre);
            b.append(badge, bloc);
            b.onclick = () => send(texte(s.message));
            return b;
        }));
        $(".suggestions").hidden = !$("#demarrage").hidden;
    }
    const repliques = perso.repliquesProjets && typeof perso.repliquesProjets === "object" ? perso.repliquesProjets : {};
    for (const [cle, replique] of Object.entries(repliques)) if (texte(replique)) REPLIQUES.projets[cle.toLowerCase()] = texte(replique);
}

// Fenêtre Réglages : fournisseur, modèle et clés
$("#reglages-voir-modeles").addEventListener("click", () => { $("#close-reglages").click(); document.querySelector('[data-page="modeles"]')?.click(); });
$("#open-reglages").onclick = ouvrirFournisseurs;
// Terminal : catai (le CLI) s'ouvre dans une console, sur le dossier ouvert. Les commandes / viendront aussi dans le chat.
$("#ouvrir-terminal").onclick = async () => {
    const r = await window.api.ouvrirTerminal();
    if (!r.ok) addMessage("error", r.erreur);
};
window.api.lireAdresseMcp().then((adresse) => { if (!$("#mcp-adresse").value) $("#mcp-adresse").value = adresse; });
$("#mcp-form").onsubmit = async (e) => {
    e.preventDefault();
    const champ = $("#mcp-adresse");
    const statut = $("#mcp-statut");
    try {
        const resultat = await window.api.enregistrerAdresseMcp(champ.value.trim());
        statut.textContent = resultat.erreur || (resultat.adresse ? "Connecteur enregistré." : "Connecteur désactivé.");
        if (!resultat.erreur) {
            champ.value = resultat.adresse;
            dejaPrechauffe = "";
            prechauffer();
        }
    } catch { statut.textContent = "Impossible d’enregistrer le connecteur."; }
};
// Une fenêtre ouverte garde le clavier : Tab et Maj+Tab bouclent entre ses commandes visibles
function bouclerFocus(modal, e) {
    if (e.key !== "Tab") return;
    const focusables = [...modal.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!focusables.length) return;
    const premier = focusables[0];
    const dernier = focusables[focusables.length - 1];
    if (e.shiftKey && (document.activeElement === premier || !modal.contains(document.activeElement))) {
        e.preventDefault();
        dernier.focus();
    } else if (!e.shiftKey && (document.activeElement === dernier || !modal.contains(document.activeElement))) {
        e.preventDefault();
        premier.focus();
    }
}

for (const nom of ["reglages", "memory"]) {
    const modal = $(`#${nom}-modal`);
    const fermer = () => {
        modal.hidden = true;
        if (nom === "memory") $("#reglages-modal").hidden = false; // la mémoire vit dans les Réglages
        $(`#open-${nom}`).focus();
    };
    $(`#close-${nom}`).onclick = fermer;
    modal.onclick = (e) => { if (e.target === modal) fermer(); };
    modal.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !e.defaultPrevented) fermer();
        else bouclerFocus(modal, e);
    });
}

// Le prénom se demande au premier lancement : il ne se ferme qu'avec un prénom, mais le clavier y reste
$("#prenom-modal").addEventListener("keydown", (e) => bouclerFocus($("#prenom-modal"), e));

// Confirmation d'écriture et mise à jour : même boucle de focus, Échap ferme la mise à jour (pas la confirmation)
$("#diff-modal").addEventListener("keydown", (e) => bouclerFocus($("#diff-modal"), e));
$("#maj-modal").addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !e.defaultPrevented) { $("#maj-modal").hidden = true; return; }
    bouclerFocus($("#maj-modal"), e);
});

// Mise à jour : main.js prévient quand une version plus récente existe sur GitHub (principal/miseajour.js).
// Une fenêtre l'annonce avec ses nouveautés ; rien ne se télécharge sans un clic, et « Redémarrer » installe
// puis relance l'app (les discussions sont gardées). « Plus tard » ferme : une version téléchargée
// s'installera de toute façon à la fermeture de l'app.
$("#maj-plus-tard").onclick = () => ($("#maj-modal").hidden = true);

window.api.onMiseAJour(({ etat, version, pourcent, notes }) => {
    const titre = $("#maj-titre");
    const texte = $("#maj-texte");
    const bouton = $("#maj-bouton");
    const etaitFermee = $("#maj-modal").hidden;
    $("#maj-modal").hidden = false;
    // À l'ouverture seulement : le clavier entre dans la fenêtre, sans le reprendre à chaque progression
    if (etaitFermee) $("#maj-plus-tard").focus();
    bouton.hidden = false;
    bouton.disabled = false;
    if (etat === "dispo") {
        titre.textContent = `Cat Ai ${version} est sortie`;
        texte.textContent = "Une nouvelle version du chat t'attend. La mise à jour garde tes discussions, ta mémoire et tes réglages.";
        // Les notes viennent de la page de la release sur GitHub : nettoyées, et sans images (elles ne chargeraient pas)
        $("#maj-notes").innerHTML = notes ? DOMPurify.sanitize(notes, { FORBID_TAGS: ["img", "style", "form", "input", "button"], FORBID_ATTR: ["style"] }) : "";
        $("#maj-notes").hidden = !notes;
        bouton.textContent = "Mettre à jour";
        bouton.onclick = () => { bouton.disabled = true; texte.textContent = "Téléchargement…"; window.api.telechargerMiseAJour(); };
    } else if (etat === "telechargement") {
        texte.textContent = `Téléchargement… ${pourcent} %`;
        bouton.hidden = true;
    } else if (etat === "prete") {
        titre.textContent = `Cat Ai ${version} est prête`;
        texte.textContent = "Redémarre l'app pour l'installer, ça prend quelques secondes. Sinon, elle s'installera quand tu fermeras Cat Ai.";
        bouton.textContent = "Redémarrer maintenant";
        bouton.onclick = () => window.api.installerMiseAJour();
    } else {
        titre.textContent = "La mise à jour a échoué";
        texte.textContent = "Elle n'a pas pu se télécharger. Vérifie ta connexion, ou prends-la à la main sur la page GitHub de Cat Ai.";
        bouton.hidden = true;
    }
});

(async () => {
    appliquerNom();
    perso = await window.api.perso();
    appliquerPerso();
    prenom = await window.api.getPrenom();
    if (!prenom) await demanderPrenom();
    memory = await window.api.loadMemory();
    project = await window.api.getProject();
    knownProjects = await window.api.knownProjects();
    specialDirs = await window.api.specialDirs();
    try { prof = localStorage.getItem("modeProf") === "1"; } catch {}
    try { reflexion = localStorage.getItem("modeReflexion") === "1"; } catch {}
    renderMemory();
    renderProject();
    renderProf();
    convs = await window.api.loadConvs();
    current = null; // on arrive toujours sur l'accueil, avec le chat
    renderConv();
    reglages = await window.api.lireFournisseurs();
    renderFournisseurs();
    interfacePrete = true;
    afficherAlertes(await window.api.alertesStockage());
    await loadModels();
    // Ollama est revérifié toutes les 10 s ; un fournisseur en ligne seulement toutes les 2 min (ses limites de requêtes)
    let tours = 0;
    setInterval(() => { if (fournisseurActif().type === "ollama" || ++tours % 12 === 0) loadModels(); }, 10000);
    surActivite();
    input.focus();
})();
