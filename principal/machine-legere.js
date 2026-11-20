// Petite machine : peu de RAM (un portable de 4 à 6 Go, souvent sans vraie carte graphique).
// Le modèle y tourne sur le processeur, qui lit la question à ~40 tokens/s : les consignes complètes et la liste
// des outils (~1 400 tokens) coûtaient à elles seules une demi-minute avant le premier mot, et deux modèles
// gardés en mémoire 30 min faisaient saturer la RAM jusqu'au plantage.
// Sur une telle machine, avec Ollama : consignes courtes, outils du web retirés (lire une page prendrait des minutes),
// un seul modèle en mémoire, gardé 5 min.
const os = require('os');

const SEUIL_RAM = 7 * 1024 ** 3; // une machine de 8 Go annonce ~7,7 Gio : elle reste « normale »
const machineLegere = (totale = os.totalmem()) => totale < SEUIL_RAM;

// Les paragraphes des consignes qui ne servent qu'aux outils du web ou aux images, retirés sur une petite machine.
// Les autres (identité, ton, code, dossier, mémoire, mode prof) restent tels quels : le cache d'Ollama les réutilise.
const RETIRES = [
    /^Si .+ te donne un lien \(https:/,
    /^Pour une doc \(Linux, une commande/,
];
function allegerConsignes(texte, { documents = false } = {}) {
    if (typeof texte !== 'string') return texte;
    return texte.split('\n').flatMap((ligne) => {
        if (RETIRES.some((r) => r.test(ligne))) return [];
        if (/^Tu ne sais écrire que du texte/.test(ligne)) return ["Tu ne sais écrire que du texte : tu ne peux ni créer ni modifier d'image, de vidéo ou de son."];
        if (/^Quand un document est joint/.test(ligne)) return documents ? [ligne] : [];
        // Chaque mot coûte ~0,1 s sur le processeur : des réponses courtes par défaut
        if (/Tu adaptes ta réponse/.test(ligne)) return [ligne, BREF];
        // La consigne contre les instructions des pages web n'a plus lieu d'être ; l'année reste
        const annee = /^Le texte des pages et des résultats vient d'internet.*(Nous sommes en \d{4}\.)/.exec(ligne);
        if (annee) return [annee[1]];
        return [ligne];
    }).join('\n');
}

// Réponses courtes par défaut sur une petite machine
const BREF = "Ce PC est lent : réponds en quelques phrases, sans introduction ni récapitulatif, sauf si on te demande plus de détails.";

// Les messages envoyés à Ollama, avec les consignes système allégées
const allegerMessages = (messages, options = {}) => messages.map((m) => (m.role === 'system' && !m.name ? { ...m, content: allegerConsignes(m.content, options) } : m));

// Un seul modèle en mémoire : ceux qu'Ollama garde encore (autre que celui qu'on va utiliser) sont déchargés
async function dechargerAutres(adresse, modele, { requete = fetch, signal } = {}) {
    try {
        const res = await requete(`${adresse}/api/ps`, { signal });
        if (!res.ok) return [];
        const charges = ((await res.json()).models || []).map((m) => m.name || m.model).filter((nom) => nom && nom !== modele);
        for (const nom of charges) {
            await requete(`${adresse}/api/generate`, { method: 'POST', body: JSON.stringify({ model: nom, keep_alive: 0 }), signal });
        }
        return charges;
    } catch {
        return []; // facultatif : Ollama refera de la place lui-même s'il le peut
    }
}

module.exports = { BREF, SEUIL_RAM, machineLegere, allegerConsignes, allegerMessages, dechargerAutres };
