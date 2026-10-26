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
// Messages gratuits par jour, à peu près (offres gratuites d'octobre 2026) : sert au petit rond du raccourci.
// Ollama n'a pas de limite. Ce n'est qu'une estimation : le fournisseur peut changer ses règles.
function quotaDuJour(fournisseurId, modele) {
    if (fournisseurId === "ollama") return Infinity;
    if (fournisseurId === "gemini") return /lite/.test(modele) ? 1000 : 250;
    if (fournisseurId === "groq") return 1000;
    if (fournisseurId === "openrouter") return 50;
    return null; // serveur personnalisé : inconnu
}

// Icône, couleur et conseil de chaque fournisseur, pour les menus et la pastille
const ICONES = {
    pc: '<path d="M3 4h18v12H3zM8 20h8M12 16v4"/>',
    etincelle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    eclair: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>',
    serveur: '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    etoile: '<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/>',
    poids: '<path d="M6 8h12l2 12H4z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
    puce: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    bulle: '<path d="M4 5h16v11H9l-5 4z"/>',
    stylo: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
    plus: '<path d="M12 5v14M5 12h14"/>'
};
const icone = (nom) => `<svg class="icone" viewBox="0 0 24 24" aria-hidden="true">${ICONES[nom] || ICONES.puce}</svg>`;

const FOURNISSEURS_AFFICHAGE = {
    ollama: { icone: "pc", couleur: "vert", conseil: "Sur ton PC · sans limite · PC puissant conseillé" },
    gemini: { icone: "etincelle", couleur: "bleu", conseil: "En ligne, chez Google · le plus simple" },
    groq: { icone: "eclair", couleur: "jaune", conseil: "En ligne · très rapide" },
    openrouter: { icone: "route", couleur: "rose", conseil: "En ligne · plein de modèles, petit quota" },
    perso: { icone: "serveur", couleur: "gris", conseil: "Ton propre serveur" }
};

// Le conseil sous un modèle : pourquoi il est conseillé, pourquoi il est gourmand, ou son quota
function conseilModele(modele, fournisseurId, conseille) {
    if (modele === conseille) return { icone: "etoile", couleur: "jaune", conseil: `Conseillé · ${RAISON_CONSEIL[fournisseurId] || "le meilleur choix ici"}` };
    if (estGourmand(modele, fournisseurId)) return { icone: "poids", couleur: "rose", conseil: `Gourmand · ${GOURMANDS[fournisseurId].raison}` };
    const limite = quotaDuJour(fournisseurId, modele);
    return { icone: "puce", couleur: "gris", conseil: limite === Infinity ? "Sans limite" : limite ? `Environ ${limite} messages par jour` : "" };
}

const LIENS_CLES = {
    gemini: "https://aistudio.google.com/apikey",
    groq: "https://console.groq.com/keys",
    openrouter: "https://openrouter.ai/keys"
};
