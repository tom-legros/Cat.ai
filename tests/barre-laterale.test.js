// La barre latérale : largeur réglable et bornée, repli au clavier, animations qui respectent « réduire les animations »
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const source = lire('interface/barre-laterale.js');
const html = lire('index.html');
const css = lire('style.css');

function bornes() {
  const c = vm.createContext({ Math, Number });
  vm.runInContext(source.slice(0, source.indexOf('function lireRetenu(')), c);
  return c;
}

test('largeur du menu : bornée entre 200 px et 40 % de la fenêtre, 420 px au plus', () => {
  const { bornerLargeur } = bornes();
  assert.equal(bornerLargeur(150, 1400), 200);
  assert.equal(bornerLargeur(300, 1400), 300);
  assert.equal(bornerLargeur(900, 1400), 420);
  assert.equal(bornerLargeur(400, 800), 320); // petite fenêtre : 40 % de 800
  assert.equal(bornerLargeur(400, 400), 200); // jamais sous le minimum
  assert.equal(bornerLargeur('n’importe quoi', 1400), 272);
  assert.equal(bornerLargeur(301.6, 1400), 302);
});

test('menu : une poignée accessible, un bouton pour replier, un pour déplier, chargés après les pages', () => {
  assert.match(html, /id="cote-poignee"[^>]*role="separator"[^>]*aria-orientation="vertical"[^>]*tabindex="0"/);
  assert.match(html, /id="cote-replier"[^>]*aria-label="Replier le menu"/);
  assert.match(html, /id="cote-deplier"[^>]*aria-label="Afficher le menu"[^>]*hidden/);
  assert.ok(html.indexOf('interface/pages.js') < html.indexOf('interface/barre-laterale.js'));
  assert.match(source, /e\.key\.toLowerCase\(\) !== "b"/);
  assert.match(source, /toggleAttribute\("inert", oui\)/); // replié, il sort de la tabulation
  assert.match(source, /localStorage/);
});

test('animations : courtes, jamais pendant le geste, coupées si Windows demande moins d’animations', () => {
  assert.match(css, /\.is-redimensionne \.cote \{ transition: none; \}/);
  assert.match(css, /\.messages\.is-change \.msg \{ animation: none; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\* \{ animation: none !important; transition: none !important; \}/);
  const nouvelles = css.slice(css.indexOf('/* ---------- Barre latérale réglable'));
  for (const [, duree] of nouvelles.matchAll(/(?:animation|transition): [a-z-]* ?\.(\d+)s/g)) assert.ok(Number('0.' + duree) <= 0.3, duree);
});
