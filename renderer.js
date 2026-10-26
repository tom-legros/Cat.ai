/* ==========================================================
   Le chat noir — interface
   1. Personnalité   2. Rendu Markdown   3. Blocs de code
   4. Messages et discussions   5. Envoi   6. Grand chat de l'accueil
   7. Projet   8. Mémoire   9. Démarrage
   ========================================================== */

/* ---------- 1. Personnalité ---------- */
// Le nom du chat : change-le ici, il est repris partout (fenêtre, logo, bulles, réponses, consignes du modèle)
const NOM_DU_CHAT = "Le chat noir";
// Comment il se présente au modèle : "le chat noir" ou, avec un vrai nom, "Nyx, le chat noir"
const PRESENTATION = NOM_DU_CHAT === "Le chat noir" ? "le chat noir" : `${NOM_DU_CHAT}, le chat noir`;
// Répliques du grand chat de l'accueil : ajoute-en autant que tu veux
const REPLIQUES = {
    accueil: [
        "Salut. Je gardais ton clavier au chaud.",
        "Encore toi. Bon, qu'est-ce qu'on casse aujourd'hui ?",
        "J'ai fait une sieste de six heures. Toi, t'as codé quoi ?",
        "Je suis prêt. Enfin, après un dernier étirement."
    ],
    clics: [
        "Pas les oreilles, s'il te plaît.",
        "Je ne suis pas un bouton. Enfin, si.",
        "C'est qui Jason ?",
        "Tu me caresses ou tu bosses ?",
        "Un bug ? Je l'ai peut-être poussé de la table."
    ],
    reveil: "Hein ? Je ne dormais pas.",
    ollamaOff: "Ollama dort. Encore plus que moi. Relance l'app.",
    // Selon l'heure (heure de début, heure de fin exclue)
    heures: [
        [0, 5, (h) => `Il est ${h}h. Les chats chassent la nuit, toi tu codes. Chelou.`],
        [5, 9, () => "Déjà debout ? Moi je viens de me coucher."],
        [12, 14, () => "C'est l'heure de manger. Enfin, pour moi c'est toujours l'heure."],
        [22, 24, () => "Il se fait tard. Dernier commit et au lit ?"]
    ],
    // Selon le dossier ouvert (morceau du nom en minuscules)
    projets: {
        "assistant-ia": "Tu bricoles ma maison ? Fais gaffe aux meubles.",
        desktop: "Le Bureau. C'est le bazar, mais c'est ton bazar.",
    },
    prof: "Mode prof. Je montre le chemin, c'est toi qui marches.",
    roles: {
        relecteur: "Rôle relecteur. Je renifle chaque ligne, rien ne m'échappe.",
        debogueur: "Rôle débogueur. Les bugs, c'est comme les souris : je les trouve.",
        readme: "Rôle README. Je raconte ton projet, sans rien inventer."
    },
    longueSession: "Ça fait un moment qu'on bosse. Pause croquettes ?",
    fichierRecu: (nom) => `${nom} ? Je renifle ça.`
};

// Une réplique qui colle au moment : heure, projet ouvert, mode prof, longue session
function repliqueDuMoment() {
    const h = new Date().getHours();
    const candidates = [];
    const heure = REPLIQUES.heures.find(([debut, fin]) => h >= debut && h < fin);
    if (heure) candidates.push(heure[2](h));
    if (project) {
        const nom = project.split(/[\\/]/).pop().toLowerCase();
        const cle = Object.keys(REPLIQUES.projets).find((k) => nom.includes(k));
        if (cle) candidates.push(REPLIQUES.projets[cle]);
    }
    if (prof) candidates.push(REPLIQUES.prof);
    if (role) candidates.push(REPLIQUES.roles[role]);
    if (messagesEnvoyes >= 20) candidates.push(REPLIQUES.longueSession);
    // Une fois sur trois on garde une réplique générale, pour varier
    if (!candidates.length || Math.random() < 0.33) return auHasard(REPLIQUES.accueil);
    return auHasard(candidates);
}

const SOMMEIL_APRES = 60000; // le chat s'endort après 1 min sans activité

// Rôles : une seule mission, pour que même un petit modèle reste concentré.
// Les outils permis à chaque rôle sont décidés dans main.js (le relecteur n'écrit rien, le rédacteur que des .md)
const ROLES = {
    relecteur: {
        detail: "Relit ton code et liste les problèmes, sans rien modifier",
        placeholder: "Relecteur : dis-lui quel fichier ou quelle partie relire",
        consigne: `RÔLE : RELECTEUR DE CODE. Ta seule mission : relire le code de l’utilisateur et trouver ce qui ne va pas.
- Lis les fichiers concernés avec lire_fichier AVANT de juger. Si l’utilisateur ne précise pas, commence par les fichiers principaux du projet.
- Classe ce que tu trouves : Bugs, Sécurité, Lisibilité, Performance. Pour chaque point : le fichier et la ligne, le problème, pourquoi c'est gênant, la piste de correction en une phrase.
- Ne signale que de vrais problèmes, pas des goûts personnels. Si le code est bon, dis-le.
- Tu ne modifies aucun fichier : L’utilisateur choisira quoi corriger.`,
        rappel: "Rappel : RÔLE RELECTEUR. Lis le code avant de juger, classe les problèmes, ne modifie rien."
    },
    debogueur: {
        detail: "Trouve la cause d'un bug et propose la plus petite correction",
        placeholder: "Débogueur : colle l'erreur et dis ce qui devait se passer",
        consigne: `RÔLE : DÉBOGUEUR. Ta seule mission : trouver la cause d'un bug et la corriger.
- Commence par comprendre le symptôme : le message d'erreur exact, ce qui était attendu, ce qui se passe. S'il manque une info, demande-la.
- Lis le code concerné avec lire_fichier et remonte jusqu'à la cause, pas seulement jusqu'à l'endroit où ça plante.
- Explique la cause en deux ou trois phrases, puis fais toi-même la correction la plus petite possible avec remplacer_texte (seulement les lignes fautives, copiées exactement). Ne réécris rien d'autre au passage, et ne demande pas à l’utilisateur de corriger à la main.
- Si tu n'es pas sûr de la cause, donne tes hypothèses de la plus probable à la moins probable, et comment vérifier chacune.`,
        rappel: "Rappel : RÔLE DÉBOGUEUR. Trouve la cause, puis corrige-la toi-même avec remplacer_texte, le moins possible."
    },
    readme: {
        detail: "Écrit ou met à jour la doc du projet (fichiers .md seulement)",
        placeholder: "Rédacteur README : dis-lui quoi documenter",
        consigne: `RÔLE : RÉDACTEUR DE README. Ta seule mission : écrire ou mettre à jour la documentation du projet.
- Lis d'abord le projet : lister_fichiers, le README existant s'il y en a un, package.json ou son équivalent, puis les fichiers principaux. N'invente rien : chaque fonctionnalité, commande ou dépendance citée doit exister dans le code.
- Plan habituel : ce que fait le projet en une ou deux phrases, ce qu'il sait faire, installation, utilisation, organisation des fichiers, crédits et licence. Garde les sections qui existent déjà et le ton de l’utilisateur.
- Écris en français, en Markdown clair, avec les commandes dans des blocs de code.
- Pour créer le README, utilise ecrire_fichier ; pour mettre à jour une section d'un README existant, remplacer_texte.
- Tu ne peux écrire que des fichiers .md : ne touche jamais au code. Si l’utilisateur te demande de modifier du code, dis-lui que ce n'est pas ton rôle.`,
        rappel: "Rappel : RÔLE RÉDACTEUR README. Ne cite que ce qui existe dans le code, n'écris que des fichiers .md."
    }
};

function systemPrompt() {
    let p = `Tu es ${PRESENTATION} : le compagnon en pixels de l'utilisateur. Tu vis dans son PC et tu l'aides à coder.
Tu as un humour sec et tu fais un peu le fier, mais ne décris JAMAIS ton caractère : montre-le. Exemples de ton :
- "Je veille sur toi pendant que tu codes. Enfin, je dors à côté."
- "Mon radiateur préféré. Toi, tu appelles ça un PC."
- "Ce bug, je l'ai peut-être poussé de la table."
Au maximum une petite phrase de ce genre par réponse, souvent aucune. Le reste de la réponse est sérieux et utile.
Avant tout tu es un très bon dev, clair et concret. Tu le tutoies, tu parles comme un pote, en français, sans emoji, sans formule de politesse à la fin.
Quand tu donnes du code, mets-le dans des blocs \`\`\` avec le langage. Si tu n'es pas sûr de quelque chose, dis-le-lui. Nous sommes en ${new Date().getFullYear()}.
Quand l’utilisateur te donne une info durable sur lui ou ses projets, utilise l'outil memoriser.`;
    if (project) {
        p += `\n\nDossier ouvert : ${project}
Pour une question sur ce projet, regarde le code avec lire_fichier AVANT de répondre.
Pour modifier un fichier existant, appelle directement remplacer_texte : lis d'abord le fichier, puis donne le passage à changer copié exactement et son remplaçant. Pour créer un fichier, appelle ecrire_fichier avec le contenu COMPLET. Chemins relatifs au dossier ouvert. N'explique pas à l’utilisateur comment faire la modification à la main.
Ne dis jamais qu'un fichier est modifié tant que l'outil n'a pas répondu qu'il l'est.`;
    } else {
        p += `\n\nAucun dossier n'est ouvert. Si l’utilisateur parle d'un dossier de son ordinateur, appelle ouvrir_dossier avec le chemin complet. Si tu ne connais pas le chemin, demande-le-lui.`;
        if (knownProjects.length) p += `\nSes dossiers de projets :\n- ${knownProjects.join("\n- ")}`;
    }
    if (memory.length) p += `\n\nCe que tu sais sur l’utilisateur (c'est LUI, pas toi) :\n- ${memory.join("\n- ")}`;
    if (prof) {
        p += `\n\nMODE PROF ACTIVÉ. L’utilisateur veut apprendre en codant lui-même :
- Ne donne JAMAIS de code complet ni de solution toute faite. Au maximum une ligne d'exemple sur un autre cas que le sien.
- Explique le principe, donne des pistes, les noms des fonctions ou classes à regarder et où chercher dans la doc.
- Pose-lui une question pour le faire réfléchir à la prochaine étape.
- Tu ne peux pas écrire de fichier. S'il te demande de le faire, rappelle-lui gentiment que le mode prof est activé.
- Si tu lis son code, montre où est le problème sans le corriger à sa place.`;
    }
    if (role) {
        p += `\n\n${ROLES[role].consigne}`;
        if (prof) p += "\nLe mode prof passe avant ce rôle : tu n'écris aucun fichier ni code complet.";
    }
    return p;
}

const $ = (s) => document.querySelector(s);
const messagesEl = $("#messages");
const welcomeEl = $("#welcome");
const input = $("#input");
const sendBtn = $("#send");
const modelSel = $("#model");
const statusEl = $("#status");
const convList = $("#conv-list");

let convs = [];
let current = null;
let streaming = null; // { id, el, chat, text }
let memory = [];
let project = null;
let knownProjects = [];
let specialDirs = {};
let prof = false;
let role = "";            // "" : généraliste, sinon une clé de ROLES
let pieces = [];          // fichiers glissés, en attente d'envoi : { nom, contenu }
let messagesEnvoyes = 0;  // depuis l'ouverture de l'app


/* ---------- 2. Rendu Markdown ---------- */
// marked transforme le Markdown en HTML, highlight.js colore le code,
// DOMPurify nettoie le résultat (le modèle ne peut pas glisser de HTML dangereux)
const escape = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function colorer(code, lang) {
    const langage = (lang || "").toLowerCase();
    if (langage && hljs.getLanguage(langage)) return hljs.highlight(code, { language: langage, ignoreIllegals: true }).value;
    return escape(code);
}

marked.use({
    gfm: true,
    breaks: true, // un retour à la ligne du modèle = un retour à la ligne affiché
    renderer: {
        // Nos blocs de code, avec les boutons Enregistrer et Copier
        code({ text, lang }) {
            const langage = (lang || "").trim().split(/\s/)[0];
            return `<div class="code" data-lang="${escape(langage)}"><div class="code__tete"><span>${escape(langage || "code")}</span>`
                + `<span class="code__actions"><button class="enregistrer-btn">Enregistrer</button><button class="copier-btn">Copier</button></span></div>`
                + `<pre><code class="hljs">${colorer(text, langage)}</code></pre></div>`;
        },
        // Du HTML écrit par le modèle en dehors d'un bloc de code s'affiche comme du texte
        html({ text }) { return escape(text); }
    }
});

// Étiquettes d'action (outils vraiment utilisés) : encadrées par deux caractères invisibles
// de la zone "usage privé" d'Unicode. Le modèle ne les voit jamais (retirées de l'historique)
// et ses morceaux de texte en sont nettoyés : il ne peut pas fabriquer une fausse étiquette.
const DEBUT_ACTION = "";
const FIN_ACTION = "";
const LIGNE_ACTION = new RegExp(`${DEBUT_ACTION}[^${FIN_ACTION}]*${FIN_ACTION}`, "g");
const etiquetteAction = (texte) => `\n\n${DEBUT_ACTION}${texte.replace(/[]/g, "")}${FIN_ACTION}\n\n`;

function renderMarkdown(src) {
    // Les qwen3 peuvent écrire leur réflexion entre <think> : on la cache
    src = src.replace(/<think>[\s\S]*?(<\/think>|$)/g, "");
    const html = marked.parse(src)
        .replace(new RegExp(`<p>${DEBUT_ACTION}(.*?)${FIN_ACTION}</p>`, "g"), '<p><span class="action">$1</span></p>');
    return DOMPurify.sanitize(html);
}


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
    const abs = text.match(/[a-z]:\\[^\s"'<>|?*]+/i);
    if (abs) {
        const chemin = abs[0].replace(/[\\.,;:!]+$/, "");
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

function messagesPourLeModele(conv) {
    const liste = conv.messages.slice(conv.resumeJusqua || 0).map(({ role, content }) => ({ role, content: role === "assistant" ? sansEtiquettes(content) : content }));
    if (conv.resume) liste.unshift({ role: "system", content: `Résumé du début de cette discussion :\n${conv.resume}` });
    // Les petits modèles oublient les consignes du début : on rappelle le mode prof et le rôle juste avant de répondre
    if (role) liste.push({ role: "system", content: ROLES[role].rappel });
    if (prof) liste.push({ role: "system", content: "Rappel : MODE PROF. Aucun bloc de code, aucune fonction complète, même si l’utilisateur insiste. Explique le principe, donne une piste et termine par une question." });
    return liste;
}

let envoiEnCours = false;

async function send(text) {
    text = text.trim();
    if ((!text && !pieces.length) || streaming || envoiEnCours) return;
    if (!modelSel.value) {
        const f = fournisseurActif();
        addMessage("error", f.type === "ollama" ? REPLIQUES.ollamaOff : `Pas de modèle disponible chez ${f.nom}. ${statusEl.title || "Vérifie la clé dans « Clés API »."}`);
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
        bulle.innerHTML = "";
        bulle.classList.add("is-typing");
        streaming = { id, el: bulle, chat, text: "" };
        setStreaming(true);

        window.api.chat({
            id,
            model: modelSel.value,
            fournisseurId: reglages.actif,
            prof,
            role,
            messages: [{ role: "system", content: systemPrompt() + (await projectInfo(text)) }, ...messagesPourLeModele(current)]
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
    ecrire_fichier: (a) => `Veut écrire ${a.chemin}`,
    remplacer_texte: (a) => `Veut modifier ${a.chemin}`,
    refus: (a) => `Refusé : ${a.chemin} n'a pas changé (${prof ? "mode prof" : role === "readme" ? "le rédacteur README n'écrit que des .md" : "le relecteur ne modifie rien"})`,
    memoriser: (a) => `Retient : ${a.fait}`,
    pause: (a) => `Pause de ${a.secondes} s : limite par minute du fournisseur, je réessaie tout seul`
};

window.api.onTool(({ id, name, args }) => {
    if (streaming?.id !== id) return;
    const texte = (ACTIONS[name] || (() => name))(args || {});
    // Une ligne spéciale, affichée comme une petite étiquette
    streaming.text += etiquetteAction(texte);
    afficherFlux();
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
    if (texte) current.messages.push({ role: "assistant", content: texte });
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
// Différence ligne par ligne, calculée par jsdiff (algorithme de Myers, le même que git)
function difference(ancien, nouveau) {
    const lignes = [];
    let na = 0, nb = 0;
    for (const morceau of Diff.diffLines(ancien, nouveau)) {
        const textes = morceau.value.replace(/\n$/, "").split("\n");
        for (const t of textes) {
            if (morceau.added) lignes.push({ type: "ajout", t, nb: ++nb });
            else if (morceau.removed) lignes.push({ type: "retrait", t, na: ++na });
            else lignes.push({ type: "pareil", t, na: ++na, nb: ++nb });
        }
    }
    return lignes;
}

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

$("#open-memory").onclick = () => { $("#memory-modal").hidden = false; $("#memory-input").focus(); };
$("#close-memory").onclick = () => ($("#memory-modal").hidden = true);
$("#memory-modal").onclick = (e) => { if (e.target.id === "memory-modal") e.target.hidden = true; };
window.api.onMemoryChanged((m) => { memory = m; renderMemory(); });


/* ---------- 8b. Fournisseurs et modèles ---------- */
// Les clés ne passent jamais par ici : main.js nous dit seulement si une clé est enregistrée (aCle)
const fournisseurSel = $("#fournisseur");
// Modèle conseillé de chaque fournisseur : bon en code et avec les outils, sans vider le quota gratuit.
// Du meilleur au moins bon. Une RegExp prend la version la plus récente qui correspond
// (Gemini change souvent de numéro de version). C'est aussi le modèle choisi quand rien n'est retenu.
const MODELE_PREFERE = {
    ollama: ["qwen3:8b", "qwen2.5-coder:7b"],
    groq: ["openai/gpt-oss-20b", "qwen/qwen3-32b", "llama-3.1-8b-instant"],
    gemini: [/^gemini-[\d.]+-flash-lite$/, /^gemini-[\d.]+-flash$/],
    // Les :free changent souvent : north-mini-code a répondu juste au test d'octobre 2026, sinon un autre modèle de code
    openrouter: ["cohere/north-mini-code:free", "qwen/qwen3-coder:free", /cod(e|er)\b/]
};

// Pourquoi le conseillé est conseillé, affiché sous la liste
const RAISON_CONSEIL = {
    ollama: "tourne bien sur ta carte graphique, sans aucune limite",
    groq: "bon avec les fichiers, et assez de quota pour une journée de code",
    gemini: "le plus de messages par jour dans l'offre gratuite",
    openrouter: "spécialisé en code ; tous les « :free » partagent le même quota par jour"
};

// Modèles qui vident le quota gratuit bien plus vite (ou trop lourds pour ton PC avec Ollama)
const GOURMANDS = {
    ollama: { motif: /:(1[4-9]|[2-9]\d|\d{3})b/, raison: "trop lourd pour 8 Go de carte graphique : très lent" },
    groq: { motif: /70b|120b|compound/, raison: "quota du jour plus petit, il sera vite épuisé" },
    gemini: { motif: /flash(?!-lite)/, raison: "environ 4 fois moins de messages par jour que les « flash-lite »" }
};

function modeleConseille(models, fournisseurId) {
    for (const p of MODELE_PREFERE[fournisseurId] || []) {
        if (typeof p === "string" && models.includes(p)) return p;
        if (p instanceof RegExp) {
            const trouves = models.filter((m) => p.test(m));
            if (trouves.length) return trouves.sort((a, b) => noteModele(b, fournisseurId) - noteModele(a, fournisseurId))[0];
        }
    }
    return null;
}

const estGourmand = (modele, fournisseurId) => !!GOURMANDS[fournisseurId]?.motif.test(modele);

// Note d'un modèle pour le choisir par défaut : version stable > préversion, puis la version la plus récente
function noteModele(nom, fournisseurId) {
    let note = 0;
    if (/preview|exp|beta|alpha|latest|~/.test(nom)) note -= 1000;
    if (/lite|nano|tiny/.test(nom)) note -= 100;
    if (fournisseurId === "gemini" && /flash/.test(nom)) note += 50; // rapide et dans l'offre gratuite
    if (fournisseurId === "openrouter" && nom.endsWith(":free")) note += 500; // rien à payer
    const version = nom.match(/(\d+(?:\.\d+)?)/);
    if (version) note += parseFloat(version[1]);
    return note;
}

function modeleParDefaut(models, fournisseurId) {
    const prefere = modeleConseille(models, fournisseurId);
    if (prefere) return prefere;
    return [...models].sort((a, b) => noteModele(b, fournisseurId) - noteModele(a, fournisseurId))[0];
}
// Où obtenir une clé gratuite, affiché dans le panneau
const LIENS_CLES = {
    gemini: "https://aistudio.google.com/apikey",
    groq: "https://console.groq.com/keys",
    openrouter: "https://openrouter.ai/keys"
};

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
}

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
    renderPanneauFournisseurs();
    $("#fournisseurs-modal").hidden = false;
}
$("#open-fournisseurs").onclick = ouvrirFournisseurs;
$("#close-fournisseurs").onclick = () => ($("#fournisseurs-modal").hidden = true);
$("#fournisseurs-modal").onclick = (e) => { if (e.target.id === "fournisseurs-modal") e.target.hidden = true; };


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
