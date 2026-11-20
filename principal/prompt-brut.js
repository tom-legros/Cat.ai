// Prompt brut pour les petites machines : Cat Ai écrit lui-même le texte lu par le modèle (format ChatML de Qwen 3),
// au lieu de laisser Ollama le mettre en forme avec son gabarit.
// Pourquoi : avec le gabarit d'Ollama, la réponse précédente n'est pas remise exactement comme le modèle l'a écrite
// (le bloc de réflexion vide <think></think> disparaît de l'historique). Le cache s'arrête alors au début de cette
// réponse, et chaque message la relit (~10 s pour qwen3:1.7b sur un vieux processeur). Ici, l'historique ne fait
// que s'allonger : chaque message ne relit que la nouvelle question.
// Seulement pour les Qwen 3 classiques (pas qwen3.5, hybride), sans outils, sans réflexion, sans image.

const DEBUT = '<|im_start|>';
const FIN = '<|im_end|>';
// Ce qu'Ollama ajoute lui-même avec think: false : une réflexion vide, puis la réponse
const REFLEXION_VIDE = '<think>\n\n</think>\n\n';
const ARRETS = [FIN, DEBUT];

// qwen3:1.7b, qwen3:0.6b, qwen3:8b… mais pas qwen3.5, qwen3.6 ni qwen3-coder (autres gabarits)
const qwen3Classique = (modele) => /^qwen3:/i.test(String(modele || ''));

function promptBrutPossible({ modele, outils = [], reflexion = false, messages = [] }) {
    if (!qwen3Classique(modele) || reflexion || outils.length) return false;
    return messages.every((m) => ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string'
        && !m.images?.length && !m.tool_calls?.length);
}

// Les consignes du début (une ou plusieurs, comme le contexte du dossier) forment un seul bloc système.
// generation : termine par l'en-tête de la réponse à écrire (avec la réflexion vide, comme Ollama).
function promptQwen(messages, { generation = true } = {}) {
    let i = 0;
    const consignes = [];
    while (messages[i]?.role === 'system') consignes.push(messages[i++].content);
    const systeme = consignes.filter((c) => c && c.trim()).join('\n\n');
    let texte = systeme ? `${DEBUT}system\n${systeme}${FIN}\n` : '';
    for (const m of messages.slice(i)) {
        // Une note système au milieu de la discussion est déjà transformée en message utilisateur par rappelsPourOllama
        const role = m.role === 'assistant' ? 'assistant' : 'user';
        texte += role === 'assistant'
            ? `${DEBUT}assistant\n${REFLEXION_VIDE}${m.content}${FIN}\n`
            : `${DEBUT}user\n${m.content}${FIN}\n`;
    }
    return generation ? `${texte}${DEBUT}assistant\n${REFLEXION_VIDE}` : texte;
}

// Les notes de suivi que l'interface ajoute après la dernière question (outils déjà utilisés, « la conversation continue »).
// Elles changent de place à chaque message : gardées, elles casseraient le cache. Sans outils, elles ne servent pas,
// et la salutation est réglée par la ligne fixe des consignes allégées. Le rappel du mode prof, lui, reste.
const NOTES_DE_SUIVI = /^(Tu n'as encore utilisé aucun outil dans cette discussion|Ce que tu as déjà fait dans cette discussion|La conversation continue\. Commence directement)/;
const sansNotesDeSuivi = (messages) => messages.filter((m, i) => !(i > 0 && m.role === 'system' && NOTES_DE_SUIVI.test(m.content || '')));

module.exports = { ARRETS, qwen3Classique, promptBrutPossible, promptQwen, sansNotesDeSuivi };
