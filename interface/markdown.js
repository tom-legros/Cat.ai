/* ==========================================================
   Cat Ai — rendu des réponses : Markdown, couleurs du code, étiquettes d'action
   ========================================================== */

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
