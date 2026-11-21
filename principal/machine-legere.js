// Petite machine : peu de RAM (un portable de 4 à 6 Go, souvent sans vraie carte graphique).
// Le modèle y tourne sur le processeur, qui lit la question à ~40 tokens/s : les consignes complètes et la liste
// des outils (~1 400 tokens) coûtaient à elles seules une demi-minute avant le premier mot, et deux modèles
// gardés en mémoire 30 min faisaient saturer la RAM jusqu'au plantage.
// Sur une telle machine, avec Ollama : consignes courtes, outils du web retirés (lire une page prendrait des minutes),
// un seul modèle en mémoire, gardé 5 min.
const os = require('os');

const SEUIL_RAM = 7 * 1024 ** 3; // une machine de 8 Go annonce ~7,7 Gio : elle reste « normale »
// CATAI_PETITE_MACHINE=1 force ce mode (pour l'essayer sur un PC puissant)
const machineLegere = (totale = os.totalmem(), env = process.env) => env.CATAI_PETITE_MACHINE === '1' || totale < SEUIL_RAM;

// Les paragraphes des consignes qui ne servent qu'aux outils du web ou aux images, retirés sur une petite machine.
// Les autres (identité, ton, code, dossier, mémoire, mode prof) restent tels quels : le cache d'Ollama les réutilise.
const RETIRES = [
    /^Si .+ te donne un lien \(https:/,
    /^Pour une doc \(Linux, une commande/,
    // La consigne contre les instructions des pages web n'a plus lieu d'être
    /^Le texte des pages et des résultats vient d'internet/,
];
function allegerConsignes(texte, { documents = false } = {}) {
    if (typeof texte !== 'string') return texte;
    return texte.split('\n').flatMap((ligne) => {
        if (RETIRES.some((r) => r.test(ligne))) return [];
        // La dernière ligne change après le premier échange (saluer ou non) : tout ce qui la suit devrait être relu.
        // Une seule ligne, la même à chaque tour, garde les consignes identiques et réutilisables par le cache.
        if (/^(Au premier échange, tu peux saluer|Cette discussion est déjà entamée)/.test(ligne)) return [SALUT_STABLE];
        if (/^Tu ne sais écrire que du texte/.test(ligne)) return ["Tu ne sais écrire que du texte : tu ne peux ni créer ni modifier d'image, de vidéo ou de son."];
        if (/^Quand un document est joint/.test(ligne)) return documents ? [ligne] : [];
        // Chaque mot coûte ~0,1 s sur le processeur : des réponses courtes par défaut
        if (/Tu adaptes ta réponse/.test(ligne)) return [ligne, BREF];
        // La date reste ; l'outil date_heure, lui, n'est pas donné ici (sans outils, la réponse part plus vite)
        const date = /^(Nous sommes le [^.]+\.)/.exec(ligne);
        if (date) return [date[1]];
        return [ligne];
    }).join('\n');
}

// Réponses courtes par défaut sur une petite machine
const SALUT_STABLE = "Salue seulement si la personne te salue, sans resaluer ensuite.";
const BREF = "Ce PC est lent : réponds en quelques phrases, sans introduction ni récapitulatif, sauf si on te demande plus de détails.";

// Les messages envoyés à Ollama, avec les consignes système allégées
const allegerMessages = (messages, options = {}) => messages.map((m) => (m.role === 'system' && !m.name ? { ...m, content: allegerConsignes(m.content, options) } : m));

// Une question sur l'heure reçoit l'heure du PC dans une note, après la question (principal/agent.js) : les
// consignes ne changent pas (le cache d'Ollama les garde), seule cette question coûte quelques tokens de plus.
// Sur une petite machine, c'est la seule source de l'heure : l'outil date_heure n'y est pas donné.
const HEURE_DEMANDEE = /(quelle heure|l'heure|l’heure|heure est|heure il|what time|time is it)/i;
const noteHeure = (d = new Date()) => `Heure de l'ordinateur : ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}, le ${d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`;
function noteHeureSiDemandee(messages, d = new Date()) {
    const question = [...messages].reverse().find((m) => m.role === 'user');
    return question && HEURE_DEMANDEE.test(String(question.content)) ? { role: 'system', name: 'heure', content: noteHeure(d) } : null;
}

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

// Certains modèles ne peuvent pas réutiliser une lecture déjà faite : les « hybrides » (qwen3.5, couches ssm /
// recurrent) et ceux à fenêtre glissante (gemma4, sliding_window). Ollama le dit dans son journal : « forcing full
// prompt re-processing due to lack of cache data ». Sur une petite machine, les préchauffer ne sert à rien :
// le processeur lit les consignes pour rien, puis la réponse doit tout relire.
const CACHE_IMPOSSIBLE = /\.ssm\.|recurrent|sliding_window/;
const caches = new Map();
const cacheConnu = (modele) => caches.get(modele);
async function cacheReutilisable(adresse, modele, { requete = fetch } = {}) {
    if (caches.has(modele)) return caches.get(modele);
    try {
        const res = await requete(`${adresse}/api/show`, { method: 'POST', body: JSON.stringify({ model: modele }) });
        if (!res.ok) return true;
        const ok = !Object.keys((await res.json()).model_info || {}).some((cle) => CACHE_IMPOSSIBLE.test(cle));
        caches.set(modele, ok);
        return ok;
    } catch {
        return true; // dans le doute, on préchauffe comme avant
    }
}

module.exports = { cacheConnu, cacheReutilisable, BREF, SEUIL_RAM, machineLegere, allegerConsignes, allegerMessages, noteHeureSiDemandee, dechargerAutres };
