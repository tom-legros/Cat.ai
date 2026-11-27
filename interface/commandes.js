// Les commandes « / » de la saisie, comme dans le CLI : on tape /, un menu propose les commandes,
// Entrée ou Tab la choisit. Seul un premier mot qui est vraiment une commande est intercepté :
// « /etc/hosts, c'est quoi ? » part au chat comme un message normal.
const COMMANDES = [
    { nom: "nouveau", alias: ["oublier", "new"], texte: "Nouvelle discussion", icone: "plus" },
    { nom: "modele", alias: ["modèle", "model"], texte: "Changer de modèle", icone: "puce", argument: "nom" },
    { nom: "rapide", alias: [], texte: "Répondre tout de suite", icone: "eclair" },
    { nom: "reflexion", alias: ["réflexion", "think"], texte: "Réfléchir avant de répondre", icone: "ampoule" },
    { nom: "prof", alias: [], texte: "Mode prof", icone: "lunettes" },
    { nom: "joindre", alias: ["fichier"], texte: "Ajouter des fichiers ou des photos", icone: "trombone" },
    { nom: "dossier", alias: ["projet"], texte: "Ouvrir un dossier", icone: "dossier" },
    { nom: "renommer", alias: ["titre"], texte: "Renommer la discussion", icone: "stylo", argument: "titre" },
    { nom: "agent", alias: ["tache", "tâche"], texte: "Confier une tâche de fond à l'agent", icone: "agents", argument: "tâche", experimental: true },
    { nom: "chantier", alias: ["equipe", "équipe"], texte: "Confier un gros travail à l'équipe (chef, codeurs, relecteur)", icone: "agents", argument: "plan", experimental: true },
    { nom: "taches", alias: ["tâches"], texte: "Page des tâches", icone: "agents", experimental: true },
    { nom: "garder", alias: ["keep"], texte: "Garder les changements de l'agent", icone: "coche" },
    { nom: "jeter", alias: ["annuler"], texte: "Jeter les changements de l'agent", icone: "corbeille" },
    { nom: "exporter", alias: ["export"], texte: "Exporter la discussion en Markdown", icone: "fleche" },
    { nom: "recherche", alias: ["chercher"], texte: "Chercher dans l'historique", icone: "loupe", argument: "mots" },
    { nom: "memoire", alias: ["mémoire"], texte: "Ce que le chat retient de toi", icone: "coeur" },
    { nom: "modeles", alias: ["modèles"], texte: "Page des modèles", icone: "boite" },
    { nom: "reglages", alias: ["réglages", "parametres"], texte: "Réglages", icone: "engrenage" },
    { nom: "terminal", alias: ["cli"], texte: "Ouvrir Cat Ai dans un terminal", icone: "terminal" },
];

// Les commandes des fonctions expérimentales (Réglages) ne sont proposées que si elles sont activées
const commandesVisibles = () => COMMANDES.filter((c) => !c.experimental || typeof fonctionsExperimentales !== "function" || fonctionsExperimentales());

const sansAccent = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// La commande tapée en entier (« /renommer Révisions bac ») : { commande, argument }, sinon null
function trouverCommande(texte) {
    const m = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(String(texte || "").trim());
    if (!m) return null;
    const mot = sansAccent(m[1]);
    const commande = commandesVisibles().find((c) => c.nom === mot || c.alias.some((a) => sansAccent(a) === mot));
    if (!commande) return null;
    const argument = (m[2] || "").trim();
    // Une commande sans argument suivie de texte, c'est sans doute une vraie phrase : on ne l'intercepte pas
    if (argument && !commande.argument) return null;
    return { commande, argument };
}

// Les commandes à proposer pendant qu'on tape le premier mot (« /re » → renommer, recherche, reflexion…)
function filtrerCommandes(texte) {
    const m = /^\/(\S*)$/.exec(String(texte || ""));
    if (!m) return [];
    const debut = sansAccent(m[1]);
    const commencent = commandesVisibles().filter((c) => [c.nom, ...c.alias].some((n) => sansAccent(n).startsWith(debut)));
    if (commencent.length || !debut) return commencent;
    // Rien ne commence ainsi : on cherche dans la description (« /fich » → joindre)
    return commandesVisibles().filter((c) => sansAccent(c.texte).includes(debut));
}

// La discussion en Markdown, prête à enregistrer
function discussionEnMarkdown(conv, nomChat = "Cat Ai") {
    const lignes = [`# ${conv.title || "Discussion"}`, ""];
    for (const m of conv.messages || []) {
        if (m.role !== "user" && m.role !== "assistant") continue;
        const texte = String(m.affichage || m.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
        if (!texte) continue;
        lignes.push(`**${m.role === "user" ? "Toi" : nomChat} :**`, "", texte, "");
    }
    return lignes.join("\n").trimEnd() + "\n";
}

// Un nom de fichier sûr à partir du titre
function nomDeFichier(titre) {
    const propre = String(titre || "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60).trim();
    return (propre || "discussion") + ".md";
}

if (typeof module !== "undefined") module.exports = { COMMANDES, trouverCommande, filtrerCommandes, discussionEnMarkdown, nomDeFichier };
