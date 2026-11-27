// Ergonomie du chat : menu Joindre du bouton +, icônes toutes issues de la même grille (PIXELS),
// menus titrés et navigables au clavier, rond de quota caché quand il ne veut rien dire.
// Le comportement câblé dans les sources est vérifié par lecture, comme les autres tests de câblage.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Le découpage des fonctions doit fonctionner aussi avec les fins de ligne CRLF.
const lire = (nom) => fs.readFileSync(path.join(__dirname, '..', nom), 'utf8').replace(/\r\n/g, '\n');
const html = lire('index.html');
const renderer = lire('renderer.js');
const style = lire('style.css');

// Les fonctions pures de modeles.js : le rond du raccourci et l'affichage des menus en dépendent
const contexteModeles = {};
vm.createContext(contexteModeles);
vm.runInContext(`${lire('interface/modeles.js')}\nthis.m = { quotaDuJour, FOURNISSEURS_AFFICHAGE, conseilModele, estGourmand };`, contexteModeles);
const { quotaDuJour, FOURNISSEURS_AFFICHAGE, conseilModele, estGourmand } = contexteModeles.m;

test('icônes : une seule source (PIXELS, grille 8 × 8), plus aucun SVG dessiné à la main dans la page', () => {
  // icones.js est un script de page pur, exporté pour les tests
  const { PIXELS, LIGNES } = require('../interface/icones');
  const noms = [...Object.keys(PIXELS), ...Object.keys(LIGNES)];
  const utilisees = [...html.matchAll(/data-icone="([\w-]+)"/g)].map((m) => m[1]);
  assert.ok(utilisees.length >= 10, 'la page utilise bien les icônes de la source commune');
  for (const nom of utilisees) assert.ok(noms.includes(nom), `icône « ${nom} » absente de icones.js`);
  assert.doesNotMatch(html, /<svg class="icone/, 'plus aucun SVG en ligne : style, taille et alignement viennent de la même grille');
});

test('menu du bouton + : deux lignes sobres (fichiers ou photos, dossier), la lecture passe par readDropped', () => {
  assert.match(html, /<button id="joindre" class="pastille" type="button" aria-haspopup="true"/);
  assert.match(html, /id="menu-joindre" class="menu-modeles menu-modeles--gauche" role="menu"/);
  assert.match(renderer, /function ouvrirMenuJoindre/);
  assert.match(renderer, /\$\("#joindre"\)\.onclick = basculer\("menu-joindre", ouvrirMenuJoindre\)/);
  // Une phrase claire, sans raccourci affiché ni liste de formats en petit gris (ils restent dans l'infobulle)
  assert.match(renderer, /choixSimple\(menu, "Ajouter des fichiers ou des photos", "trombone", ajouterFichiers, \{ aide: "Texte, code, PDF, Word, images… \(Ctrl\+U\)" \}\)/);
  assert.match(renderer, /choixSimple\(menu, "Ajouter un dossier", "dossier", choisirProjet/);
  assert.match(renderer, /e\.key\.toLowerCase\(\) !== "u"\) return;[\s\S]*?ajouterFichiers\(\);/);
  // Même chemin de validation que le glisser-déposer (fichier sensible, format, taille, document)
  assert.match(renderer, /async function joindreChemin\(choix\) \{[\s\S]*?await window\.api\.readDropped\(choix\);/);
  // Une annulation du sélecteur ne joint rien ; plusieurs fichiers passent un par un
  assert.match(renderer, /if \(!chemins\?\.length\) return; \/\/ annulé : rien n'est joint\s*for \(const chemin of chemins\) await joindreChemin\(chemin\);/);
  const main = lire('main.js');
  assert.match(main, /ipcMain\.handle\('choisir-fichier'/);
  assert.match(main, /properties: options\.plusieurs \? \['openFile', 'multiSelections'\] : \['openFile'\]/);
  assert.match(lire('preload.js'), /choisirFichier: \(options\) => ipcRenderer\.invoke\('choisir-fichier', options\)/);
  // readDropped accepte un chemin (sélecteur) comme un fichier (glisser-déposer)
  assert.match(lire('preload.js'), /typeof file === 'string' \? file : webUtils\.getPathForFile\(file\)/);
});

test('Prof et niveau de réflexion : libellés visibles, menu Rapide / Réflexion réservé aux modèles qui réfléchissent', () => {
  const prof = html.match(/<button id="mode-prof"[^>]*>([\s\S]*?)<\/button>/);
  assert.match(prof[0], /role="switch"/);
  assert.match(prof[0], /aria-checked="false"/);
  assert.match(prof[1], /class="pastille__etiquette">Prof</);
  const reflexion = html.match(/<button id="mode-reflexion"[^>]*>([\s\S]*?)<\/button>/);
  assert.match(reflexion[0], /aria-haspopup="menu"/);
  assert.match(reflexion[0], /aria-label=/);
  assert.match(reflexion[1], /class="pastille__etiquette">Rapide</);
  assert.match(html, /id="menu-reflexion" class="menu-modeles menu-modeles--gauche" role="menu" aria-label="Niveau de réflexion"/);
  assert.match(renderer, /choixSimple\(menu, "Rapide", "eclair", \(\) => choisirReflexion\(false\), \{ actif: !reflexion/);
  assert.match(renderer, /choixSimple\(menu, "Réflexion", "ampoule", \(\) => choisirReflexion\(true\), \{ actif: reflexion/);
  assert.match(renderer, /textContent = actif \? "Réflexion" : "Rapide"/);
  // L'état actif de Prof reste lisible : bordure jaune en plus du fond
  assert.match(lire('style.css'), /\.saisie__barre \.pastille\[aria-checked="true"\]/);
  // Le bouton n'apparaît que lorsque le modèle choisi sait réellement réfléchir
  assert.match(renderer, /boutonReflexion\.hidden = !reflexionPossible/);
});

test('pièces jointes : une seule entrée (+), le dossier ouvert devient un état refermable', () => {
  // Sans dossier, pas de bouton « Dossier » redondant : le menu + propose « Un dossier »
  assert.match(html, /id="projet-groupe" hidden/);
  assert.match(renderer, /\$\("#projet-groupe"\)\.hidden = !project/);
  // Nom de pièce tronqué proprement, nom complet au survol
  assert.match(renderer, /className = "piece__nom"/);
  // Lecture en cours : une puce temporaire, retirée quoi qu'il arrive
  assert.match(renderer, /piece--attente/);
  assert.match(renderer, /attente\.remove\(\)/);
});

test('formats non lus : avertissement dédié aux documents Word/PowerPoint/Excel, avant l’envoi', () => {
  const main = lire('main.js');
  assert.match(main, /const bureautique =/, 'les formats bureautiques sont reconnus à part');
  assert.match(main, /Cat Ai ne lit pas encore les documents Word, PowerPoint ou Excel/);
  assert.match(main, /Exporte-le en PDF/, 'la solution est donnée immédiatement');
  // La lecture passe toujours par readDropped : l'avertissement arrive au moment de joindre, pas après envoi
  assert.match(renderer, /res = await window\.api\.readDropped\(choix\)/);
});

test('sélecteur unique fournisseur + modèle : recherche, groupes et choix direct', () => {
  // Un seul bouton dans la barre, un seul menu : le fournisseur et le modèle se choisissent ensemble
  assert.match(html, /id="modele-raccourci" class="pastille pastille--discrete pastille--cerveau"/);
  assert.match(html, /aria-haspopup="menu" aria-expanded="false"/);
  assert.doesNotMatch(html, /id="fournisseur-raccourci"/);
  assert.doesNotMatch(html, /id="menu-fournisseurs"/);
  assert.match(html, /id="menu-modeles" class="menu-modeles menu-modeles--cerveau" role="menu"/);
  assert.match(renderer, /function ouvrirMenuModeles/);
  // Pas de titre : une ligne de recherche avec sa loupe et « + » pour ajouter un fournisseur, puis les récents
  assert.match(renderer, /recherche\.placeholder = "Rechercher un modèle";/);
  assert.match(renderer, /ajouter\.onclick = \(\) => \{ fermerMenus\(\); ouvrirFournisseurs\(\); \};/);
  assert.match(renderer, /const recents = q \? \[\] : lireRecents\(\)/); // pas de doublon pendant une recherche
  // Un groupe se déroule sans redessiner le menu (la transition reste fluide)
  assert.match(renderer, /groupe\.classList\.toggle\("is-ouvert", ouvre\);/);
  // Recherche sans accents, et Entrée ne doit jamais envoyer le message
  assert.match(renderer, /type = "search"/);
  const sansAccents = vm.runInNewContext(`${renderer.match(/const sansAccents = .*;/)[0]}\nsansAccents;`);
  assert.equal(sansAccents('RÉFLEXION'), 'reflexion');
  assert.equal(sansAccents('Gemini'), 'gemini');
  assert.match(renderer, /if \(e\.key !== "Enter"\) return;[\s\S]*?e\.preventDefault\(\)/);
  // Groupes par fournisseur, modèles chargés pour chacun puis mis en cache
  assert.match(renderer, /menu-modeles__groupe/);
  assert.match(renderer, /window\.api\.models\(g\.f\.id\)/);
  assert.match(renderer, /cacheModeles/);
  assert.match(renderer, /function choisirCerveau/);
  // Navigation clavier et fermeture restent communes aux menus
  assert.match(renderer, /function naviguerMenu/);
  assert.match(renderer, /ArrowDown/);
  assert.match(renderer, /Escape/);
  assert.match(renderer, /\["menu-modeles", "menu-joindre", "menu-reflexion", "menu-agent"\]\.forEach/);
  assert.match(renderer, /setAttribute\("role", actif === null \? "menuitem" : "menuitemradio"\)/);
  // Un choix referme le menu même quand il est placé dans un groupe
  assert.match(renderer, /b\.onclick = \(\) => \{ fermerMenus\(\); action\(\); \}/);
});

test('blocs de code : copie fidèle, retour visible et échec annoncé', () => {
  // La copie attend vraiment le presse-papiers : succès et échec ont chacun leur retour
  assert.match(renderer, /await navigator\.clipboard\.writeText\(bloc\.querySelector\("code"\)\.textContent\)/);
  assert.match(renderer, /messageTemporaire\(e\.target, "Copié", "Copier"\)/);
  assert.match(renderer, /catch \{[\s\S]*?messageTemporaire\(e\.target, "Copie impossible", "Copier"\)/);
  // Plusieurs clics ne laissent pas un ancien minuteur effacer le retour le plus récent
  assert.match(renderer, /clearTimeout\(bouton\._temporaire\)/);
});

test('historique : chaque discussion est un vrai bouton, la suppression rend le focus', () => {
  // La ligne reste un <li>, mais son contenu cliquable est un bouton : Tab, Entrée et Espace fonctionnent
  assert.match(renderer, /ouvrir\.type = "button"/);
  assert.match(renderer, /ouvrir\.className = "conv__ouvrir"/);
  assert.doesNotMatch(renderer, /li\.onclick =/);
  assert.match(renderer, /setAttribute\("aria-current", "page"\)/);
  // L'état « réponse en cours » et la suppression sont annoncés, sans retirer la ligne du parcours clavier
  assert.match(renderer, /suppr\.setAttribute\("aria-disabled", String\(!!vivante\)\)/);
  assert.match(renderer, /Supprimer « \$\{c\.title\} »/);
  // La suppression demande confirmation avant de toucher à l'historique ; le focus revient à la liste
  assert.match(renderer, /function demanderSuppressionDiscussion/);
  assert.match(renderer, /function supprimerDiscussion/);
  assert.match(renderer, /convList\.querySelectorAll\("\.conv__ouvrir"\)/);
  // Le bouton de ligne a un focus visible, et le × apparaît aussi au clavier
  assert.match(style, /\.discussions \.conv__ouvrir:focus-visible/);
  assert.match(style, /\.discussions li:focus-within \.suppr/);
});

test('fenêtres modales : déclarées, focus gardé à l’intérieur, Échap rend le focus', () => {
  for (const id of ['reglages-modal', 'memory-modal', 'prenom-modal']) {
    assert.match(html, new RegExp(`id="${id}" class="fenetre" role="dialog" aria-modal="true"`), `${id} est un vrai dialogue modal`);
  }
  // Tab et Maj+Tab bouclent sur les commandes visibles
  assert.match(renderer, /function bouclerFocus/);
  assert.match(renderer, /if \(e\.key !== "Tab"\) return;/);
  assert.match(renderer, /e\.shiftKey && \(document\.activeElement === premier/);
  assert.match(renderer, /!modal\.contains\(document\.activeElement\)/);

  // Comportement de la boucle, hors DOM : dernier → premier, premier → dernier, milieu → laissé au navigateur
  const debut = renderer.indexOf('function bouclerFocus');
  const extrait = renderer.slice(debut, renderer.indexOf('\n}\n', debut) + 3);
  const cible = () => ({ offsetParent: {}, focus() { this.recu = true; } });
  const premier = cible();
  const dernier = cible();
  const modal = { querySelectorAll: () => [premier, dernier], contains: (el) => el === premier || el === dernier };
  const contexte = { document: { activeElement: dernier } };
  const boucler = vm.runInNewContext(`${extrait}\nbouclerFocus;`, contexte);
  const tab = (shiftKey, cibleEvent) => {
    const e = { key: 'Tab', shiftKey, preventDefault() { this.bloque = true; }, cible: cibleEvent };
    boucler(modal, e);
    return e;
  };
  let e = tab(false, dernier);
  assert.equal(e.bloque, true);
  assert.equal(premier.recu, true);
  contexte.document.activeElement = premier;
  e = tab(true, premier);
  assert.equal(e.bloque, true);
  assert.equal(dernier.recu, true);
  // Depuis une fenêtre sans focus (ou un élément extérieur), Tab entre par la première commande
  contexte.document.activeElement = { offsetParent: {} };
  e = tab(false, null);
  assert.equal(e.bloque, true);
});

test('Ctrl+K : ouvre le sélecteur sans traverser une fenêtre, et ne soumet rien', () => {
  assert.match(html, /title="Choisir le fournisseur et le modèle \(Ctrl\+K\)"/);
  assert.match(renderer, /e\.key\.toLowerCase\(\) !== "k"/);
  assert.match(renderer, /if \(document\.querySelector\("\.fenetre:not\(\[hidden\]\), dialog\[open\]"\)\) return;/);
  assert.match(renderer, /\$\("#modele-raccourci"\)\.click\(\)/);
  // Fermé au clavier, le menu rend le focus au bouton au lieu de le laisser dans une liste cachée
  assert.match(renderer, /focusDedans \|\| e\.detail === 0/);
});

test('réglages : clé supprimée seulement après confirmation, erreurs à part, statut durable', () => {
  // Le titre dit ce que la fenêtre contient vraiment, et le statut est annoncé sans voler le focus
  assert.match(html, /id="reglages-titre" class="fenetre__titre">Réglages</);
  assert.match(html, /id="reglages-statut" class="conseil" role="status" aria-live="polite"/);
  // Une clé ne part jamais sur un clic malheureux : question explicite, « Garder » reçoit le focus
  assert.match(renderer, /fournisseur__confirmation/);
  assert.match(renderer, /Supprimer la clé de \$\{f\.nom\} \?/);
  assert.match(renderer, /Oui, supprimer/);
  assert.match(renderer, /non\.focus\(\); \/\/ le choix sûr reçoit le focus/);
  assert.match(renderer, /enregistrerFournisseur\(\{ id: f\.id, cle: "" \}\)/);
  // Les champs ont des noms accessibles, l'erreur s'affiche à côté du lien sans l'effacer
  assert.match(renderer, /champCle\.setAttribute\("aria-label"/);
  assert.match(renderer, /champUrl\.setAttribute\("aria-label"/);
  assert.match(renderer, /const retour = document\.createElement\("p"\)/);
  assert.match(renderer, /retour\.textContent = r\.erreur/);
  // Le statut ne annonce une clé enregistrée que si une clé a vraiment été envoyée
  assert.match(renderer, /nouvelleCle\s*\n?\s*\? `Clé de \$\{nom\} enregistrée\.`/);
  assert.match(renderer, /Clé de \$\{f\.nom\} supprimée\./);
  // Ouvrir les réglages efface l'ancien statut, et le panneau garde une carte par fournisseur
  assert.match(renderer, /#reglages-statut"\)\.textContent = ""/);
  assert.match(renderer, /carte\.dataset\.fournisseur = f\.id/);
});

test('rond de quota : caché pour Ollama (sans limite) et serveur inconnu, utile sinon', () => {
  const debut = renderer.indexOf('function renderRaccourci()');
  const extrait = renderer.slice(debut, renderer.indexOf('\n}', debut) + 2);
  const lancer = (fournisseur) => {
    const svg = { style: {} };
    const vide = () => ({ style: {}, classList: { toggle() {} } });
    const arc = { style: {}, classList: { toggle() {} }, closest: () => svg };
    const elements = {
      '#fournisseur-nom': vide(), '#fournisseur-icone': vide(), '#modele-nom': vide(),
      '#quota-arc': arc, '#modele-raccourci': vide(),
    };
    const rendu = vm.runInNewContext(`${extrait}\nrenderRaccourci;`, {
      $: (sel) => elements[sel],
      modelSel: { value: 'qwen3.5:9b' },
      FOURNISSEURS_AFFICHAGE,
      icone: () => '',
      messagesDuJour: () => 2,
      nomCourt: (m) => m.split('/').pop(),
      quotaDuJour,
      fournisseurActif: () => fournisseur,
    });
    rendu();
    return { svg, arc, titre: elements['#modele-raccourci'].title };
  };
  // Ollama : sans limite, le rond ne dit rien → caché, le titre le dit
  const ollama = lancer({ id: 'ollama', nom: 'Ollama (local)' });
  assert.equal(ollama.svg.style.display, 'none');
  assert.match(ollama.titre, /sans limite/);
  // Serveur personnalisé : quota inconnu → caché aussi
  const perso = lancer({ id: 'perso', nom: 'Perso' });
  assert.equal(perso.svg.style.display, 'none');
  assert.match(perso.titre, /inconnu/);
  // Groq : environ 1000 messages par jour → rond visible, arc et titre utiles
  const groq = lancer({ id: 'groq', nom: 'Groq' });
  assert.notEqual(groq.svg.style.display, 'none');
  assert.match(groq.titre, /environ 1000/);
  assert.match(groq.arc.style.strokeDasharray, /^\d/);
});

test('mention « Conseillé » et « Gourmand » ne se contredisent jamais dans un menu de modèles', () => {
  const modeles = ['qwen3.6:27b', 'qwen3:8b', 'qwen3.5:9b'];
  const conseille = 'qwen3:8b';
  for (const m of modeles) {
    const c = conseilModele(m, 'ollama', conseille);
    const etoile = m === conseille;
    assert.equal(c.icone === 'etoile', etoile, `${m} : l'étoile suit la recommandation`);
    if (etoile) assert.doesNotMatch(c.conseil, /Gourmand/);
    if (estGourmand(m, 'ollama')) assert.match(c.conseil, /Gourmand/, `${m} reste honnêtement gourmand`);
  }
});

test('le modèle intégré par Cat Ai a la même mention partout, et le logo reste lisible', () => {
  // Menu sous la barre de saisie : qwen3.5:9b conseillé chez Ollama s'affiche « Intégré par Cat Ai »
  assert.match(conseilModele('qwen3.5:9b', 'ollama', 'qwen3.5:9b').conseil, /^Intégré par Cat Ai/);
  assert.match(conseilModele('qwen3:8b', 'ollama', 'qwen3:8b').conseil, /^Conseillé/);
  // Page Modèles : même mention
  const pages = lire('interface/pages.js');
  assert.match(pages, /if \(integre\) return \{ label: "Intégré par Cat Ai"/);
  // Logo dessiné en lettres pixel nettes (le « C » de la police pixel se lisait « O »)
  const icones = {};
  vm.runInNewContext(`${lire('interface/icones.js')}\nthis.motEnPixels = motEnPixels;`, icones);
  assert.match(icones.motEnPixels('Cat Ai'), /^<svg class="logo__pixels" viewBox="0 0 \d+ 7"/);
  assert.equal(icones.motEnPixels('Nyx'), null);
  // Petite fenêtre : seuls les libellés des modes disparaissent, jamais leur icône
  const css = lire('style.css');
  assert.doesNotMatch(css, /#mode-prof span/);
  assert.match(css, /\.pastille--mode \.pastille__etiquette, #project-name \{ display: none; \}/);
});

test('niveau de réflexion : le bouton montre l’icône du choix (éclair pour Rapide, ampoule pour Réflexion)', () => {
  assert.match(html, /<span data-icone="eclair"><\/span><span class="pastille__etiquette">Rapide<\/span>/);
  assert.match(renderer, /boutonReflexion\.firstElementChild\.innerHTML = icone\(actif \? "ampoule" : "eclair"\)/);
});
