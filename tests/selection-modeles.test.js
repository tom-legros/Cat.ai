// Page Modèles : la sélection Cat Ai choisit, pour chaque usage, le meilleur modèle qui tient sur le PC
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../interface/pages.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const entre = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
const { catalogue } = require('../principal/materiel');

function cadre(materiel) {
  const c = vm.createContext({ $: () => ({ addEventListener() {} }), catalogue: { ...materiel, modeles: catalogue(materiel) } });
  vm.runInContext(entre('const MODELES_SELECTION', 'const USAGES') + entre('function evaluerModele(', 'const etatModele')
    + entre('// Toutes les fiches connues', 'function dessinerModeles(')
    + entre('const SPECIALISTES', 'function badgeModele(') + ';this.SPECIALISTES = SPECIALISTES;', c);
  const fiches = c.fichesModeles();
  const principal = fiches.find((f) => f.modele === c.catalogue.modeles.find((m) => m.conseille).modele);
  const pour = (id) => c.choisirSpecialiste(c.SPECIALISTES.find((s) => s.id === id), fiches, principal);
  return { c, fiches, principal, pour };
}

test('carte de 8 Go : qwen3.5:9b conseillé, et il fait déjà le code, les images et la réflexion', () => {
  const { principal, pour } = cadre({ vramGo: 8, ramGo: 16, disqueGo: 100 });
  assert.equal(principal.modele, 'qwen3.5:9b');
  assert.equal(principal.evaluation.label, 'Intégré par Cat Ai');
  for (const usage of ['code', 'images', 'reflexion']) {
    const r = pour(usage);
    assert.equal(r.deja, true, usage);
    assert.ok(r.plusFort && r.plusFort.vram > 8, usage); // on dit ce qu'il faudrait pour mieux
  }
});

test('carte de 24 Go : des spécialistes plus forts que le modèle conseillé', () => {
  const { pour } = cadre({ vramGo: 24, ramGo: 32, disqueGo: 200 });
  assert.equal(pour('code').choix.modele, 'qwen3.6:27b');
  assert.equal(pour('code').plusFort, null);
  assert.equal(pour('images').choix.modele, 'gemma4:12b');
  assert.equal(pour('reflexion').choix.modele, 'gpt-oss:20b');
});

test('sans carte graphique : le petit modèle conseillé, aucun spécialiste trop lourd proposé', () => {
  const { principal, pour } = cadre({ vramGo: null, ramGo: 8, disqueGo: 50 });
  assert.equal(principal.modele, 'qwen3.5:2b');
  for (const usage of ['code', 'images', 'reflexion']) {
    assert.equal(pour(usage).choix, null, usage); // rien de rapide : pas de bouton pour un modèle qui ramerait
    assert.ok(pour(usage).plusFort, usage); // mais la ligne « Avec une plus grosse carte » le dit
  }
});

test('les candidats de la sélection existent tous dans la liste, avec leur poids', () => {
  const { c, fiches } = cadre({ vramGo: 8, ramGo: 16, disqueGo: 100 });
  for (const s of c.SPECIALISTES) for (const nom of s.candidats) {
    const f = fiches.find((x) => x.modele === nom);
    assert.ok(f, nom);
    assert.ok(f.taille > 0 && f.vram >= 0, nom);
  }
});

test('page Modèles : la sélection en haut, la liste complète dessous, le bouton Utiliser ne dépend plus d’une variable disparue', () => {
  assert.ok(html.indexOf('id="selection-principal"') < html.indexOf('id="modeles-liste"'));
  assert.match(html, /<h3[^>]*>La sélection Cat Ai<\/h3>/);
  assert.match(html, /<h3[^>]*>Tous les modèles<\/h3>/);
  assert.doesNotMatch(source, /if \(streaming\)/);
  assert.match(source, /if \(fluxLocalEnCours\(\)\)/);
});

test('« Testé par Cat Ai » : seulement les modèles passés dans la vraie app, et seulement s’ils tiennent', () => {
  const testes = catalogue({ vramGo: 8, ramGo: 16 }).filter((m) => m.teste).map((m) => m.modele).sort();
  assert.deepEqual(testes, ['gemma4:e4b-it-qat', 'qwen2.5-coder:7b', 'qwen3.5:4b', 'qwen3:14b', 'qwen3:8b']);
  const { fiches } = cadre({ vramGo: 8, ramGo: 16, disqueGo: 100 });
  const avis = (nom) => fiches.find((f) => f.modele === nom).evaluation.label;
  assert.equal(avis('qwen3.5:4b'), 'Testé par Cat Ai');
  assert.equal(avis('qwen3:14b'), 'Lent'); // testé, mais trop gros pour 8 Go : on dit la vérité sur la vitesse
  assert.equal(avis('gemma4:e4b'), 'Lent');
});

test('carte de 8 Go : gemma4:12b-it-qat n’est jamais proposé (il a fait planter le pilote), e4b-it-qat sert aux petites cartes', () => {
  const huit = cadre({ vramGo: 8, ramGo: 16, disqueGo: 100 });
  assert.equal(huit.fiches.find((f) => f.modele === 'gemma4:12b-it-qat').evaluation.adapte, false);
  assert.equal(huit.pour('images').deja, true); // qwen3.5:9b voit déjà les images
  const six = cadre({ vramGo: 6, ramGo: 16, disqueGo: 100 });
  assert.equal(six.pour('images').choix.modele, 'gemma4:e4b-it-qat');
  assert.equal(six.fiches.find((f) => f.modele === 'gemma4:e4b-it-qat').evaluation.label, 'Testé par Cat Ai');
});

test('« Utiliser » un modèle trop gros pour la carte : le premier clic prévient, le second confirme', () => {
  assert.match(source, /const tropGros = !!\(m\.vram && catalogue\?\.vramGo && m\.vram > catalogue\.vramGo\);/);
  assert.match(source, /if \(tropGros && !prevenu\) \{\s*prevenu = true;\s*action\.textContent = 'Utiliser quand même';/);
  assert.match(source, /il peut faire planter le pilote de la carte graphique/);
});
