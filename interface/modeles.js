/* ==========================================================
   Cat Ai — choix des modèles : le conseillé (★), les gourmands (▲), celui pris par défaut.
   Que des fonctions pures : elles ne touchent ni à la page ni au processus principal.
   ========================================================== */

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
