/* ==========================================================
   Le chat noir — interface
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
const modelSel = $("#model");
const statusEl = $("#status");
const convList = $("#conv-list");

let prenom = "";         // demandé au premier lancement, enregistré dans settings.json
let convs = [];
let current = null;
let streaming = null; // { id, el, chat, text, actions }
let memory = [];
let project = null;
let knownProjects = [];
let specialDirs = {};
let prof = false;
let role = "";            // "" : généraliste, sinon une clé de ROLES
let pieces = [];          // fichiers glissés, en attente d'envoi : { nom, contenu }
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
    bouton.textContent = texte;
    setTimeout(() => (bouton.textContent = initial), 1800);
}

messagesEl.addEventListener("click", (e) => {
    const bloc = e.target.closest(".code");
    if (!bloc) return;

    if (e.target.classList.contains("copier-btn")) {
        navigator.clipboard.writeText(bloc.querySelector("code").textContent);
        messageTemporaire(e.target, "Copié", "Copier");
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
function listePieces(noms) {
    const ul = document.createElement("ul");
    ul.className = "pieces";
    noms.forEach((nom) => {
        const li = document.createElement("li");
        li.className = "piece";
        li.textContent = nom;
        ul.append(li);
    });
    return ul;
}

function addMessage(role, text, fichiers = []) {
    welcomeEl.hidden = true;
    const wrap = document.createElement("div");
    wrap.className = `msg ${role}`;
    const bulle = document.createElement("div");
    bulle.className = "bulle-msg";
    let chat = null;

    if (role === "user") {
        bulle.textContent = text;
        if (fichiers.length) wrap.append(listePieces(fichiers));
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
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return { bulle, chat };
}

function renderConv() {
    messagesEl.querySelectorAll(".msg").forEach((m) => m.remove());
    welcomeEl.hidden = !!(current && current.messages.length);
    current?.messages.forEach((m) => addMessage(m.role, m.affichage ?? m.content, m.fichiers));
    renderList();
    if (!welcomeEl.hidden) direBientot();
}

function renderList() {
    convList.innerHTML = "";
    convs.forEach((c) => {
        const li = document.createElement("li");
        li.className = c === current ? "is-active" : "";
        const titre = document.createElement("span");
        titre.textContent = c.title;
        const suppr = document.createElement("button");
        suppr.className = "suppr";
        suppr.title = "Supprimer";
        suppr.textContent = "×";
        suppr.onclick = (e) => {
            e.stopPropagation();
            if (streaming) return;
            convs = convs.filter((x) => x !== c);
            if (current === c) current = convs[0] || null;
            save();
            renderConv();
        };
        li.append(titre, suppr);
        li.onclick = () => { if (!streaming) { current = c; renderConv(); } };
        convList.appendChild(li);
    });
}

const save = () => window.api.saveConvs(convs);

function setStreaming(on) {
    sendBtn.textContent = on ? "Stop" : "Envoyer";
    sendBtn.classList.toggle("is-stop", on);
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
    for (const f of ctx.mentioned) p += `\n\nContenu de ${f.path} :\n\`\`\`\n${f.content}\n\`\`\``;
    p += `\n\nBase-toi UNIQUEMENT sur ces fichiers réels. Pour voir un autre fichier, utilise lire_fichier. N'invente jamais le contenu d'un fichier.`;
    return p;
}

// Résumé automatique : au-delà de ce nombre de caractères, le début de la discussion est résumé
// (le modèle a une mémoire de 8192 tokens, il faut garder de la place pour les consignes et la réponse)
const LIMITE_HISTORIQUE = 12000;
const MESSAGES_GARDES = 4; // les derniers messages restent toujours en entier

async function resumerSiBesoin(conv, bulle) {
    const debut = conv.resumeJusqua || 0;
    const recents = conv.messages.slice(debut);
    const taille = recents.reduce((n, m) => n + m.content.length, 0);
    if (taille < LIMITE_HISTORIQUE || recents.length <= MESSAGES_GARDES) return;
    const fin = conv.messages.length - MESSAGES_GARDES;
    bulle.innerHTML = '<p><span class="action">Résume le début de la discussion pour ne pas l\'oublier</span></p>';
    const resume = await window.api.summarize({
        model: modelSel.value,
        fournisseurId: reglages.actif,
        messages: conv.messages.slice(debut, fin).map(({ role, content }) => ({ role, content: content.slice(0, 4000) })),
        ancienResume: conv.resume
    });
    if (!resume) return; // pas grave : on envoie quand même, le modèle oubliera juste le tout début
    conv.resume = resume;
    conv.resumeJusqua = fin;
    save();
}

// Les étiquettes d'action sont pour l’utilisateur, pas pour le modèle : s'il les voyait dans l'historique,
// il apprendrait à les recopier et ferait croire qu'il a lu un fichier sans l'avoir fait
// (on retire aussi l'ancien format [[action:…]] des discussions enregistrées avant ce changement)
const sansEtiquettes = (texte) => texte.replace(LIGNE_ACTION, "").replace(/\[\[action:[^\]\n]*\]\]/g, "").replace(/\n{3,}/g, "\n\n").trim();

const MAX_ACTIONS_RAPPELEES = 12;

function messagesPourLeModele(conv) {
    const liste = conv.messages.slice(conv.resumeJusqua || 0).map(({ role, content }) => ({ role, content: role === "assistant" ? sansEtiquettes(content) : content }));
    if (conv.resume) liste.unshift({ role: "system", content: `Résumé du début de cette discussion :\n${conv.resume}` });
    // Les petits modèles oublient les consignes du début : on rappelle le mode prof et le rôle juste avant de répondre
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
    if (role) liste.push({ role: "system", content: ROLES[role].rappel });
    if (prof) liste.push({ role: "system", content: "Rappel : MODE PROF. Aucun bloc de code, aucune fonction complète, même s'il ou elle insiste. Explique le principe, donne une piste et termine par une question." });
    return liste;
}

// Ollama n'a que 8 192 tokens. main.js garde les consignes sous ~8 000 caractères (la moitié de LIMITES_OLLAMA.total,
// dans principal/taille.js) : au-delà, leur fin est coupée. On prévient l’utilisateur, avec ce qui prend la place.
const CONTEXTE_OLLAMA = 8192;
const MAX_CONSIGNES = 8000;
const enTokens = (texte) => Math.ceil(texte.length / 3); // ~3 caractères par token, comme principal/taille.js

function budgetConsignes(consignes) {
    if (consignes.length <= MAX_CONSIGNES) return "";
    return `Consignes lourdes : ~${enTokens(consignes)} tokens sur les ${CONTEXTE_OLLAMA} d'Ollama, dont ~${enTokens(memory.join("\n"))} pour la mémoire. `
        + "Leur fin sera coupée : fais du tri dans la mémoire, ou cite moins de fichiers.";
}

let envoiEnCours = false;

async function send(text) {
    text = text.trim();
    if ((!text && !pieces.length) || streaming || envoiEnCours) return;
    if (!modelSel.value) {
        const f = fournisseurActif();
        // Ollama installé mais arrêté : il suffit de relancer. Sinon, l'accueil explique comment avoir un modèle.
        const sansModele = f.type === "ollama" && (!etatOllama.installe || etatOllama.repond);
        addMessage("error", sansModele ? "Il me faut d'abord un modèle. Ouvre une nouvelle discussion : l'accueil t'explique comment en avoir un gratuit." : f.type === "ollama" ? REPLIQUES.ollamaOff : `Pas de modèle disponible chez ${f.nom}. ${statusEl.title || "Vérifie la clé dans « Clés API »."}`);
        return;
    }
    envoiEnCours = true;
    try {
        const trouve = text && (await detectProject(text));
        if (trouve && trouve !== project) project = await window.api.openProjectPath(trouve);

        // Les fichiers glissés sont ajoutés au message envoyé au modèle, mais affichés en petites étiquettes
        const fichiers = pieces.map((p) => p.nom);
        let contenu = text || "Regarde ce fichier.";
        for (const p of pieces) contenu += `\n\nFichier joint « ${p.nom} » (son contenu complet est juste ici, pas besoin de le lire avec un outil) :\n\`\`\`\n${p.contenu}\n\`\`\``;
        pieces = [];
        renderPieces();

        if (!current) {
            current = { id: Date.now(), title: (text || fichiers[0]).slice(0, 40), messages: [] };
            convs.unshift(current);
        }
        const message = { role: "user", content: contenu };
        if (fichiers.length) Object.assign(message, { affichage: text, fichiers });
        current.messages.push(message);
        addMessage("user", text, fichiers);
        renderList();
        save();
        messagesEnvoyes++;

        const id = Date.now();
        const { bulle, chat } = addMessage("assistant", "");
        chat.reflechit = true;
        await resumerSiBesoin(current, bulle);
        const consignes = systemPrompt() + (await projectInfo(text));
        bulle.innerHTML = "";
        bulle.classList.add("is-typing");
        // Avec Ollama, des consignes trop lourdes sont coupées : L’utilisateur le voit en haut de la réponse
        const alerteBudget = fournisseurActif().type === "ollama" ? budgetConsignes(consignes) : "";
        streaming = { id, el: bulle, chat, text: alerteBudget ? etiquetteAction(alerteBudget) : "", actions: [] };
        if (alerteBudget) afficherFlux();
        setStreaming(true);

        window.api.chat({
            id,
            model: modelSel.value,
            fournisseurId: reglages.actif,
            prof,
            role,
            messages: [{ role: "system", content: consignes }, ...messagesPourLeModele(current)]
        });
    } finally {
        envoiEnCours = false;
    }
}

function afficherFlux() {
    streaming.el.innerHTML = renderMarkdown(streaming.text);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

window.api.onChunk(({ id, text }) => {
    if (streaming?.id !== id) return;
    streaming.text += text.replace(/[]/g, ""); // le modèle ne peut pas écrire de marqueur d'action
    afficherFlux();
});

// Retire le JSON brut d'un appel d'outil écrit en texte par le modèle
window.api.onUndo(({ id, length }) => {
    if (streaming?.id !== id) return;
    streaming.text = streaming.text.slice(0, -length);
    afficherFlux();
});

const ACTIONS = {
    ouvrir_dossier: (a) => `Demande à ouvrir ${a.chemin}`,
    lister_fichiers: (a) => `Regarde les fichiers${a.dossier ? " de " + a.dossier : ""}`,
    lire_fichier: (a) => `Lit ${a.chemin}`,
    chercher: (a) => `Cherche « ${a.texte} »${a.dossier ? " dans " + a.dossier : ""}`,
    ecrire_fichier: (a) => `Veut écrire ${a.chemin}`,
    remplacer_texte: (a) => `Veut modifier ${a.chemin}`,
    "refus-lecture": (a) => `Tu as refusé : ${a.chemin} n'a pas été lu`,
    refus: (a) => `Refusé : ${a.chemin} n'a pas changé (${prof ? "mode prof" : role === "readme" ? "le rédacteur README n'écrit que des .md" : "le relecteur ne modifie rien"})`,
    memoriser: (a) => `Retient : ${a.fait}`,
    pause: (a) => `Pause de ${a.secondes} s : limite par minute du fournisseur, je réessaie tout seul`,
    limite: (a) => `Arrêt après ${a.etapes} étapes d'outils pour ce message : dis-moi « continue » pour que je reprenne`
};

window.api.onTool(({ id, name, args }) => {
    if (streaming?.id !== id) return;
    const texte = (ACTIONS[name] || (() => name))(args || {});
    // Une ligne spéciale, affichée comme une petite étiquette
    streaming.text += etiquetteAction(texte);
    afficherFlux();
});

// Action terminée, résumée en une ligne par main.js : gardée avec la réponse, pour les messages suivants
window.api.onAction(({ id, action }) => {
    if (streaming?.id === id) streaming.actions.push(action);
});

function finirFlux() {
    streaming.el.classList.remove("is-typing");
    streaming.chat.reflechit = false;
    streaming = null;
    setStreaming(false);
}

window.api.onDone(({ id }) => {
    if (streaming?.id !== id) return;
    const texte = streaming.text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (texte || streaming.actions.length) {
        const message = { role: "assistant", content: texte };
        if (streaming.actions.length) message.actions = streaming.actions;
        current.messages.push(message);
    }
    // Réponse finie : le chat sautille, content
    streaming.chat.sautiller(2);
    streaming.chat.expression("content", 1400);
    finirFlux();
    save();
});

window.api.onError(({ id, error, modeleCasse }) => {
    if (streaming?.id !== id) return;
    const bulle = streaming.el;
    bulle.closest(".msg").classList.add("error");
    bulle.textContent = `Aïe, ça a planté : ${error}`;
    streaming.chat.expression("fache");
    finirFlux();
    if (modeleCasse) remplacerModeleCasse(modeleCasse, bulle);
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
        if (streaming || envoiEnCours) return;
        current.messages.pop();
        const messages = [...messagesEl.querySelectorAll(".msg")];
        messages.at(-1)?.remove(); // l'erreur
        messages.at(-2)?.remove(); // le message de l’utilisateur, renvoyé juste après
        send(dernier.content);
    };
    bulle.append(bouton);
}

$("#composer").addEventListener("submit", (e) => {
    e.preventDefault();
    if (streaming) { window.api.stop(streaming.id); return; }
    send(input.value);
    input.value = "";
    input.style.height = "auto";
});

input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        $("#composer").requestSubmit();
    }
});

input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = input.scrollHeight + "px";
});

document.querySelectorAll(".suggestions button").forEach((b) => (b.onclick = () => send(b.dataset.prompt)));

$("#new-chat").onclick = () => {
    if (streaming) return;
    current = null;
    renderConv();
    input.focus();
};


/* ---------- 6. Grand chat de l'accueil ---------- */
const mascotte = $("#mascotte");
const bulle = $("#bulle");
const bulleTexte = $("#bulle-texte");
const grandChat = new ChatNoir($("#grand-chat"));
const logo = $("#logo");

let minuterieFrappe = null;
let minuterieMasque = null;
let derniereReplique = "";
const auHasard = (liste) => {
    // Évite de répéter la dernière réplique, sauf s'il n'y a qu'elle
    const autres = liste.filter((r) => r !== derniereReplique);
    const choix = autres.length ? autres : liste;
    return choix[Math.floor(Math.random() * choix.length)];
};

// Affiche une réplique lettre par lettre, puis la bulle se cache seule
function dire(texte) {
    if (!texte) return;
    derniereReplique = texte;
    clearInterval(minuterieFrappe);
    clearTimeout(minuterieMasque);
    bulle.classList.remove("is-hidden");
    let n = 0;
    minuterieFrappe = setInterval(() => {
        bulleTexte.textContent = texte.slice(0, ++n);
        if (n >= texte.length) {
            clearInterval(minuterieFrappe);
            minuterieMasque = setTimeout(() => bulle.classList.add("is-hidden"), 6000);
        }
    }, 24);
}

let minuterieAccueil = null;
function direBientot() {
    clearTimeout(minuterieAccueil);
    minuterieAccueil = setTimeout(() => dire(repliqueDuMoment()), 500);
}

$("#mascotte-bouton").addEventListener("click", () => {
    if (grandChat.endormi) { reveiller(); return; }
    grandChat.sauter();
    dire(auHasard(REPLIQUES.clics));
});

// Sommeil : pas d'activité depuis un moment
let minuterieSommeil = null;
function endormir() {
    if (grandChat.endormi || streaming) return;
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

// Les yeux du logo imitent ceux du grand chat
setInterval(() => logo.classList.toggle("is-closed", grandChat.etatDessine.startsWith("true")), 50);


/* ---------- 7. Projet ---------- */
function renderProject() {
    const el = $("#project-name");
    el.textContent = project ? project.split(/[\\/]/).pop() : "Aucun dossier ouvert";
    el.title = project || "";
    el.classList.toggle("is-on", !!project);
    $("#close-project").hidden = !project;
    $("#open-project").textContent = project ? "Changer" : "Ouvrir un dossier";
}

$("#open-project").onclick = async () => { project = await window.api.openProject(); renderProject(); };
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
    input.placeholder = prof
        ? "Mode prof : pose ta question, il te guide sans coder à ta place"
        : role
            ? ROLES[role].placeholder
            : "Écris au chat… (glisse un fichier ici pour le lui montrer)";
}

boutonProf.onclick = () => {
    prof = !prof;
    try { localStorage.setItem("modeProf", prof ? "1" : "0"); } catch {}
    renderProf();
    if (!welcomeEl.hidden) dire(prof ? REPLIQUES.prof : "Mode normal. Je peux de nouveau mettre les pattes dans ton code.");
};

const roleSel = $("#role");

function renderRole() {
    roleSel.value = role;
    $("#role-detail").textContent = role ? ROLES[role].detail : "";
    renderProf(); // pour le texte d'aide de la zone de saisie
}

roleSel.onchange = () => {
    role = ROLES[roleSel.value] ? roleSel.value : "";
    try { localStorage.setItem("role", role); } catch {}
    renderRole();
    if (!welcomeEl.hidden) dire(role ? REPLIQUES.roles[role] : "Retour au généraliste. Je touche à tout, comme d'hab.");
};


/* ---------- 7c. Fichiers glissés dans la fenêtre ---------- */
const depot = $("#depot");
const listePiecesEl = $("#pieces");

function renderPieces() {
    listePiecesEl.innerHTML = "";
    listePiecesEl.hidden = !pieces.length;
    pieces.forEach((p, i) => {
        const li = document.createElement("li");
        li.className = "piece";
        li.textContent = p.nom;
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
window.addEventListener("drop", async (e) => {
    e.preventDefault(); // sinon Electron ouvre le fichier à la place de l'app
    profondeurGlisser = 0;
    depot.hidden = true;
    for (const fichier of e.dataTransfer.files) {
        const res = await window.api.readDropped(fichier);
        if (res.dossier) { project = await window.api.openProjectPath(res.chemin); continue; }
        if (res.erreur) { addMessage("error", res.erreur); continue; }
        if (!pieces.some((p) => p.chemin === res.chemin)) pieces.push(res);
        if (!welcomeEl.hidden) dire(REPLIQUES.fichierRecu(res.nom));
    }
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

window.api.onConfirmWrite(({ id, chemin, ancien, nouveau, existe }) => {
    confirmationEnCours = id;
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
    setTimeout(() => { boutons.forEach((b) => (b.disabled = false)); $("#diff-refuser").focus(); }, 600);
});

function repondreConfirmation(ok) {
    if (confirmationEnCours === null) return;
    window.api.replyConfirmWrite(confirmationEnCours, ok);
    // Le refus apparaît aussi dans la réponse, pour qu'on ne puisse pas croire que le fichier a changé
    if (!ok && streaming) {
        streaming.text += etiquetteAction("Tu as refusé : le fichier n'a pas changé");
        afficherFlux();
    }
    confirmationEnCours = null;
    $("#diff-modal").hidden = true;
}

$("#diff-accepter").onclick = () => repondreConfirmation(true);
$("#diff-refuser").onclick = () => repondreConfirmation(false);
window.api.onConfirmCancel(() => { confirmationEnCours = null; $("#diff-modal").hidden = true; });
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
        const oublier = document.createElement("button");
        oublier.textContent = "Oublier";
        oublier.onclick = () => { memory.splice(i, 1); window.api.saveMemory(memory); renderMemory(); };
        li.append(texte, oublier);
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

$("#open-memory").onclick = () => { $("#prenom-actuel").textContent = prenom; $("#memory-modal").hidden = false; $("#memory-input").focus(); };
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
            modal.hidden = true;
            resolve();
        };
    });
}
$("#close-memory").onclick = () => ($("#memory-modal").hidden = true);
$("#memory-modal").onclick = (e) => { if (e.target.id === "memory-modal") e.target.hidden = true; };
window.api.onMemoryChanged((m) => { memory = m; renderMemory(); });

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

async function loadModels() {
    const f = fournisseurActif();
    renderAccueil(f);
    const { ok, models, erreur } = await window.api.models(f.id);
    if (f.id !== reglages.actif) return; // on a changé de fournisseur pendant la requête
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
    if (models.includes(avant)) modelSel.value = avant;
    else if (models.includes(retenu)) modelSel.value = retenu;
    else if (models.length) modelSel.value = modeleParDefaut(models, f.id);
    afficherConseil();
    statusEl.className = "statut" + (ok && models.length ? " is-ok" : " is-erreur");
    statusEl.title = erreur || "";
    if (f.type === "ollama") statusEl.textContent = !ok ? "Ollama ne répond pas" : models.length ? "Ollama connecté" : "Aucun modèle installé";
    else statusEl.textContent = ok ? `${f.nom} connecté · en ligne` : (erreur || "").split("\n")[0] || `${f.nom} ne répond pas`;
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

// Sans aucun modèle pour le fournisseur choisi, les suggestions laissent la place aux deux façons d'en avoir un
async function renderDemarrage(f, models) {
    const bloc = $("#demarrage");
    bloc.hidden = models.length > 0;
    $(".suggestions").hidden = !bloc.hidden;
    if (bloc.hidden) return;
    etatOllama = await window.api.etatOllama();

    if (!telechargement) {
        const modele = MODELE_PREFERE.ollama[0];
        const actions = $("#demarrage-ollama-actions");
        actions.replaceChildren();
        if (etatOllama.repond) {
            $("#demarrage-ollama-texte").textContent = `Ollama est là, il lui manque un modèle. Je conseille ${modele} : environ 5 Go à télécharger, une seule fois.`;
            actions.append(boutonAction(`Télécharger ${modele}`, "bouton", () => telechargerModele(modele)));
        } else if (etatOllama.installe) {
            $("#demarrage-ollama-texte").textContent = "Ollama est installé mais ne répond pas. Relance l'app, ou lance Ollama toi-même.";
        } else {
            $("#demarrage-ollama-texte").textContent = "Gratuit, sans limite, et rien ne sort de ton PC. Il faut une carte graphique avec 8 Go de mémoire pour être à l'aise.";
            actions.append(lienExterne("Télécharger Ollama", LIEN_OLLAMA, "bouton"));
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
        $("#demarrage-gemini-texte").textContent = "Une clé gratuite en deux minutes, avec un compte Google. Tes messages et les fichiers que je lis partent chez Google.";
        actions.append(lienExterne("Obtenir une clé", LIENS_CLES.gemini, "bouton"), boutonAction("Coller la clé", "lien", ouvrirFournisseurs));
    }
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

fournisseurSel.addEventListener("change", async () => {
    if (streaming) { fournisseurSel.value = reglages.actif; return; }
    const r = await window.api.choisirFournisseur({ id: fournisseurSel.value });
    if (r.ok) reglages = r.reglages;
    modelSel.innerHTML = "";
    statusEl.textContent = "Connexion…";
    statusEl.className = "statut";
    await loadModels();
    if (!fournisseurActif().aCle) ouvrirFournisseurs();
});

// Sous la liste : pourquoi le modèle choisi est conseillé, ou pourquoi il est gourmand
let conseille = null;
const conseilEl = $("#conseil-modele");

function afficherConseil() {
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

// Le modèle choisi est retenu pour chaque fournisseur
modelSel.addEventListener("change", async () => {
    afficherConseil();
    const r = await window.api.choisirFournisseur({ id: reglages.actif, modele: modelSel.value });
    if (r.ok) reglages = r.reglages;
});

// Le panneau : une carte par fournisseur en ligne, avec un champ password jamais pré-rempli
function renderPanneauFournisseurs() {
    const liste = $("#fournisseurs-liste");
    liste.innerHTML = "";
    reglages.fournisseurs.filter((f) => f.type !== "ollama").forEach((f) => {
        const carte = document.createElement("form");
        carte.className = "fournisseur";

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
            // Personnalisé : nom et adresse saisis par l’utilisateur
            champNom = document.createElement("input");
            champNom.placeholder = "Nom (ex : LM Studio)";
            champNom.value = f.nom === "Personnalisé" ? "" : f.nom;
            champUrl = document.createElement("input");
            // Seules les adresses gratuites sont acceptées par main.js (serveur local, Groq, OpenRouter, Gemini)
            champUrl.placeholder = "Serveur sur ton PC (ex : http://localhost:1234/v1)";
            champUrl.value = f.baseUrl || "";
            carte.append(champNom, champUrl);
        } else {
            const url = document.createElement("p");
            url.className = "fournisseur__url";
            url.textContent = f.baseUrl;
            carte.append(url);
        }

        const rangee = document.createElement("div");
        rangee.className = "rangee";
        const champCle = document.createElement("input");
        champCle.type = "password";
        champCle.autocomplete = "off";
        champCle.spellcheck = false;
        champCle.placeholder = f.aCle ? "Clé enregistrée : laisse vide pour la garder" : "Colle ta clé API ici";
        const ok = document.createElement("button");
        ok.className = "bouton";
        ok.textContent = "Enregistrer";
        rangee.append(champCle, ok);
        carte.append(rangee);

        const bas = document.createElement("div");
        bas.className = "rangee rangee--entre";
        const message = document.createElement("p");
        message.className = "fournisseur__message";
        if (LIENS_CLES[f.id]) {
            const lien = document.createElement("a");
            lien.href = LIENS_CLES[f.id];
            lien.target = "_blank"; // s'ouvre dans le navigateur (voir main.js)
            lien.className = "lien lien--petit";
            lien.textContent = "Obtenir une clé";
            message.append(lien);
        }
        bas.append(message);
        // Clé qui ne commence pas comme celles de ce fournisseur (main.js ne nous dit que vrai / faux)
        if (f.avertissement) {
            const alerte = document.createElement("p");
            alerte.className = "fournisseur__alerte";
            alerte.textContent = f.avertissement;
            carte.insertBefore(alerte, rangee.nextSibling);
        }
        if (f.aCle) {
            const oublier = document.createElement("button");
            oublier.type = "button";
            oublier.className = "lien lien--petit";
            oublier.textContent = "Supprimer la clé";
            oublier.onclick = async () => {
                const r = await window.api.enregistrerFournisseur({ id: f.id, cle: "" });
                if (r.ok) { reglages = r.reglages; renderFournisseurs(); renderPanneauFournisseurs(); loadModels(); }
            };
            bas.append(oublier);
        }
        carte.append(bas);

        carte.onsubmit = async (e) => {
            e.preventDefault();
            const envoi = { id: f.id };
            if (champCle.value.trim()) envoi.cle = champCle.value;
            if (champNom) envoi.nom = champNom.value;
            if (champUrl) envoi.baseUrl = champUrl.value;
            champCle.value = ""; // la clé ne reste pas dans la page
            const r = await window.api.enregistrerFournisseur(envoi);
            if (!r.ok) { message.textContent = r.erreur; return; }
            reglages = r.reglages;
            renderFournisseurs();
            renderPanneauFournisseurs();
            if (f.id === reglages.actif) loadModels();
        };
        liste.append(carte);
    });
}

function ouvrirFournisseurs() {
    // Qui protège vraiment les clés, selon le système (main.js le sait : Windows, trousseau de Linux…)
    $("#protection-cles").textContent = reglages.chiffrementDispo
        ? `Les clés sont chiffrées sur ton PC par ${reglages.protection} et ne sont jamais réaffichées.`
        : `Le chiffrement par ${reglages.protection} n'est pas disponible ici : aucune nouvelle clé ne peut être enregistrée.`;
    renderPanneauFournisseurs();
    $("#fournisseurs-modal").hidden = false;
}
$("#open-fournisseurs").onclick = ouvrirFournisseurs;
$("#close-fournisseurs").onclick = () => ($("#fournisseurs-modal").hidden = true);
$("#fournisseurs-modal").onclick = (e) => { if (e.target.id === "fournisseurs-modal") e.target.hidden = true; };


// Le texte de l'accueil dit la vérité : tout reste sur le PC seulement avec Ollama ou un serveur local
// Ollama, ou un serveur sur le PC (LM Studio…) : rien ne sort de chez l’utilisateur
const fournisseurLocal = (f) => f.type === "ollama" || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(f.baseUrl || "");

function renderAccueil(f) {
    $("#accueil-texte").textContent = fournisseurLocal(f)
        ? "Tout tourne sur ton PC. Gratuit, sans limite, et je ne dis rien à personne."
        : `Je passe par ${f.nom}, en ligne : gratuit, mais tes messages et les fichiers que je lis partent sur ses serveurs.`;
}


/* ---------- 9. Démarrage ---------- */

// Un fichier de données abîmé a été réparé (readJson dans main.js) : L’utilisateur doit le savoir.
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
    document.querySelector(".logo__nom").textContent = NOM_DU_CHAT;
    document.querySelector(".bulle__nom").textContent = NOM_DU_CHAT;
    $("#mascotte-bouton").setAttribute("aria-label", `${NOM_DU_CHAT} : cliquer pour qu'il parle`);
}

(async () => {
    appliquerNom();
    prenom = await window.api.getPrenom();
    if (!prenom) await demanderPrenom();
    memory = await window.api.loadMemory();
    project = await window.api.getProject();
    knownProjects = await window.api.knownProjects();
    specialDirs = await window.api.specialDirs();
    try { prof = localStorage.getItem("modeProf") === "1"; } catch {}
    try { const r = localStorage.getItem("role"); if (ROLES[r]) role = r; } catch {}
    renderMemory();
    renderProject();
    renderRole();
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
