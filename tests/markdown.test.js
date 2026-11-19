// Blocs de code : l'étiquette du langage reste honnête (aucune capacité inventée), les boutons
// sont explicites, et un bloc très long défile sur place sans pousser tout le fil.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'interface', 'markdown.js'), 'utf8');
const style = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');

function cadre() {
    const contexte = {
        marked: {
            use(options) { contexte.options = options; },
            parse: (texte) => `<p>${texte}</p>`,
        },
        hljs: {
            getLanguage: (lang) => ['js', 'javascript', 'python', 'py', 'css', 'html', 'json', 'bash', 'sh'].includes(lang),
            highlight: (code) => ({ value: code.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]) }),
        },
        DOMPurify: { sanitize: (html) => html },
        protegerMaths: (texte) => ({ texte, formules: [] }),
        katex: { renderToString: () => '' },
        DEBUT_MATHS: '\uE100',
        FIN_MATHS: '\uE101',
    };
    vm.createContext(contexte);
    vm.runInContext(source, contexte);
    return contexte;
}

test('blocs de code : langage lisible, boutons explicites, code coloré', () => {
    const c = cadre();
    const html = c.options.renderer.code({ text: 'const x = 1;', lang: 'js' });
    assert.match(html, /class="code" data-lang="js"/);
    assert.match(html, /class="code__langue">JavaScript</);
    assert.match(html, /<pre tabindex="0" aria-label="Bloc de code JavaScript">/);
    assert.match(html, /<button type="button" class="enregistrer-btn">Enregistrer<\/button>/);
    assert.match(html, /<button type="button" class="copier-btn">Copier<\/button>/);
    assert.match(html, /const x = 1;/);
    // Alias courants et repli honnête quand le langage est absent
    assert.match(c.options.renderer.code({ text: '', lang: 'py' }), />Python</);
    assert.match(c.options.renderer.code({ text: '', lang: 'bash' }), />Terminal</);
    const sansLangue = c.options.renderer.code({ text: '', lang: '' });
    assert.match(sansLangue, />Code</);
    assert.match(sansLangue, /aria-label="Bloc de code"/);
    assert.doesNotMatch(sansLangue, /Bloc de code Code/);
    // Le nom du langage ne peut pas injecter de HTML
    const piege = c.options.renderer.code({ text: 'x', lang: '"><img' });
    assert.doesNotMatch(piege, /<img/);
    assert.match(piege, /data-lang="&quot;&gt;&lt;img"/);
});

test('blocs longs : défilement sur place et focus clavier', () => {
    assert.match(style, /\.code pre \{[^}]*max-height: min\(420px, 55vh\)/);
    assert.match(style, /\.code pre \{[^}]*overflow: auto/);
    assert.match(style, /\.code pre:focus-visible/);
    const html = cadre().options.renderer.code({ text: 'ligne', lang: 'text' });
    assert.match(html, /<pre tabindex="0"/);
});

test('HTML du modèle hors bloc de code : toujours échappé', () => {
    const html = cadre().options.renderer.html({ text: '<script>alert(1)</script>' });
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
});
