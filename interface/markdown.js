/* ==========================================================
   Cat Ai — rendu des réponses : Markdown, couleurs du code, étiquettes d'action
   ========================================================== */

// marked transforme le Markdown en HTML, highlight.js colore le code,
// DOMPurify nettoie le résultat (le modèle ne peut pas glisser de HTML dangereux)
const escape = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Colorer le même bloc deux fois serait du travail perdu : pendant le streaming, les blocs déjà
// terminés sont redessinés à chaque fragment. On garde les résultats déjà obtenus, sans grandir sans fin.
const CACHE_COLORATION = new Map();
const LIMITE_CACHE_COLORATION = 100;
function colorer(code, lang) {
    const langage = (lang || "").toLowerCase();
    if (!langage || !hljs.getLanguage(langage)) return escape(code);
    const cle = langage + "\u0000" + code;
    if (CACHE_COLORATION.has(cle)) return CACHE_COLORATION.get(cle);
    const valeur = hljs.highlight(code, { language: langage, ignoreIllegals: true }).value;
    if (CACHE_COLORATION.size >= LIMITE_CACHE_COLORATION) {
        const premiere = CACHE_COLORATION.keys().next().value;
        CACHE_COLORATION.delete(premiere);
    }
    CACHE_COLORATION.set(cle, valeur);
    return valeur;
}

// L'étiquette du bloc : le nom courant du langage, jamais une capacité inventée
const ETIQUETTES_LANGAGES = {
    js: "JavaScript", javascript: "JavaScript", ts: "TypeScript", typescript: "TypeScript",
    py: "Python", python: "Python", rb: "Ruby", ruby: "Ruby", php: "PHP",
    html: "HTML", xml: "XML", css: "CSS", scss: "SCSS", json: "JSON", yaml: "YAML", yml: "YAML",
    md: "Markdown", markdown: "Markdown", sh: "Terminal", bash: "Terminal", shell: "Terminal", zsh: "Terminal",
    ps1: "PowerShell", powershell: "PowerShell", bat: "Batch", batch: "Batch",
    sql: "SQL", c: "C", cpp: "C++", "c++": "C++", csharp: "C#", cs: "C#", java: "Java",
    go: "Go", rust: "Rust", rs: "Rust", kotlin: "Kotlin", swift: "Swift", gdscript: "GDScript",
    diff: "Diff", dockerfile: "Dockerfile", docker: "Dockerfile", ini: "INI", toml: "TOML",
    text: "Texte", txt: "Texte", plaintext: "Texte",
};
const etiquetteLangage = (lang) => ETIQUETTES_LANGAGES[lang] || lang || "Code";

marked.use({
    gfm: true,
    breaks: true, // un retour à la ligne du modèle = un retour à la ligne affiché
    renderer: {
        // Nos blocs de code, avec les boutons Enregistrer et Copier
        code({ text, lang }) {
            const langage = (lang || "").trim().split(/\s/)[0].toLowerCase();
            // Un QCM : une carte avec des boutons, dessinée après le rendu (interface/qcm.js, animerQcm)
            if (langage === "qcm") return `<div class="qcm" data-qcm="${escape(text)}"></div>`;
            // Un choix à faire (« fiche courte ou détaillée ? ») : la même carte, sans bonne réponse
            if (langage === "choix") return `<div class="qcm" data-qcm="${escape(text)}" data-choix="1"></div>`;
            const etiquette = etiquetteLangage(langage);
            const description = langage ? `Bloc de code ${etiquette}` : "Bloc de code";
            return `<div class="code" data-lang="${escape(langage)}"><div class="code__tete"><span class="code__langue">${escape(etiquette)}</span>`
                + `<span class="code__actions"><button type="button" class="enregistrer-btn">Enregistrer</button><button type="button" class="copier-btn">Copier</button></span></div>`
                + `<pre tabindex="0" aria-label="${escape(description)}"><code class="hljs">${colorer(text, langage)}</code></pre></div>`;
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
const etiquetteAction = (texte) => `\n\n${DEBUT_ACTION}${texte.replace(/[]/g, "")} ${FIN_ACTION}\n\n`;

// Les formules mises de côté par protegerMaths (interface/maths.js), dessinées par KaTeX en MathML : Chromium les
// affiche lui-même, sans style intégré (que la CSP de la fenêtre interdit) ni police à embarquer.
// Une formule fausse reste affichée telle quelle au lieu de casser la réponse.
function afficherMaths(html, formules) {
    return html.replace(new RegExp(`${DEBUT_MATHS}(\\d+)${FIN_MATHS}`, "g"), (_, n) => {
        const formule = formules[n];
        if (!formule) return "";
        try {
            return katex.renderToString(formule.tex, { output: "mathml", displayMode: formule.bloc, throwOnError: false });
        } catch {
            return escape(formule.bloc ? `$$${formule.tex}$$` : `$${formule.tex}$`);
        }
    });
}

function renderMarkdown(src) {
    // Les qwen3 peuvent écrire leur réflexion entre <think> : on la cache
    src = src.replace(/<think>[\s\S]*?(<\/think>|$)/g, "");
    const { texte, formules } = protegerMaths(src);
    const html = afficherMaths(marked.parse(texte), formules)
        .replace(new RegExp(`<p>${DEBUT_ACTION}(.*?)\\s*${FIN_ACTION}</p>`, "g"), '<p><span class="action">$1</span></p>')
        // Un caractère de repère resté seul ne doit jamais s'afficher
        .replace(new RegExp(`[${DEBUT_ACTION}${FIN_ACTION}]`, "g"), "");
    return DOMPurify.sanitize(html);
}
