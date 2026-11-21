// L'écran de catai, comme quand on lance « claude » : la conversation s'écrit dans le terminal, et juste en dessous
// restent un champ de saisie encadré (avec le modèle et le dossier) et une ligne d'aide.
//
// La conversation est écrite dans le terminal normal, pas dans un écran à part : la molette, la sélection à la souris,
// le copier-coller et l'historique du terminal marchent comme d'habitude. Seul le bas (la ligne commencée, le cadre et
// l'aide) est effacé puis redessiné quand quelque chose change : la « zone vivante ».
//
// La saisie est dessinée ici, pas par readline (il écrit dans une sortie muette) : un long texte passe à la ligne dans
// le cadre au lieu de déborder. Un texte collé de plusieurs lignes devient un seul message : « [texte collé n°1 · 12
// lignes] » dans le champ, remplacé par le vrai texte à l'envoi (deplier).
// Hors d'un vrai terminal (sortie redirigée), ou avec CATAI_SIMPLE=1, tout s'écrit à la suite, sans aucun code.
const { Writable } = require('stream');

const CSI = '\x1b[';
const TOUS_LES_CODES = /\x1b\[[0-9;?]*[A-Za-z]/g;
// Tout sauf les couleurs (…m) : effacements et déplacements n'ont pas de sens une fois le texte rangé
const CODES_SANS_COULEUR = /\x1b\[[0-9;?]*[A-Za-ln-z]/g;
const DEBUT_COLLAGE = '\x1b[200~';
const FIN_COLLAGE = '\x1b[201~';
const MAX_HISTORIQUE = 5000;

// Largeur d'un caractère à l'écran : 0 pour les accents combinés et les liaisons d'emoji, 2 pour les emoji et les
// idéogrammes (sinon le texte qui suit était décalé, et la zone vivante mal effacée)
function largeurCar(cp) {
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0x200b && cp <= 0x200d) || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x1f3fb && cp <= 0x1f3ff)) return 0;
  if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) || (cp >= 0xac00 && cp <= 0xd7a3)
    || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6)
    || (cp >= 0x1f300 && cp <= 0x1f64f) || (cp >= 0x1f680 && cp <= 0x1f6ff) || (cp >= 0x1f900 && cp <= 0x1faff) || (cp >= 0x20000 && cp <= 0x3fffd)) return 2;
  // Les emoji les plus courants du premier plan (✅ ❌ ⭐ ⏳ ⚡ ✨ ❓ ❗)
  if ([0x2705, 0x274c, 0x2b50, 0x231b, 0x23f3, 0x26a1, 0x2728, 0x2753, 0x2757, 0x26d4, 0x2b55, 0x23f0].includes(cp)) return 2;
  return 1;
}
function largeurVisible(texte) {
  let w = 0;
  for (const c of String(texte).replace(TOUS_LES_CODES, '')) w += largeurCar(c.codePointAt(0));
  return w;
}

// Coupe une ligne (avec ses couleurs) en lignes d'écran de la largeur donnée. Les couleurs en cours sont reprises
// au début de chaque morceau, pour qu'une ligne coupée garde sa teinte.
// mots : la coupure se fait au dernier espace de la ligne quand il y en a un (un chemin sans espace est coupé net).
function couper(texte, largeur, { mots = false } = {}) {
  const lignes = [];
  let actuelle = '';
  let vus = 0;
  let actifs = '';
  let espace = null; // le dernier espace de la ligne : { pos, vus, actifs }
  const fermer = (t, a) => `${t}${a ? `${CSI}0m` : ''}`;
  for (const m of String(texte).split(/(\x1b\[[0-9;?]*[A-Za-z])/)) {
    if (!m) continue;
    if (m.startsWith('\x1b[')) {
      if (!m.endsWith('m')) continue;
      actuelle += m;
      actifs = /^\x1b\[0?m$/.test(m) ? '' : actifs + m;
      continue;
    }
    for (const car of m) {
      const w = largeurCar(car.codePointAt(0));
      if (vus + w > largeur && vus > 0) {
        if (mots && espace && espace.vus > 0) {
          lignes.push(fermer(actuelle.slice(0, espace.pos), espace.actifs));
          actuelle = espace.actifs + actuelle.slice(espace.pos + 1);
          vus -= espace.vus + 1;
        } else {
          lignes.push(fermer(actuelle, actifs));
          actuelle = actifs;
          vus = 0;
        }
        espace = null;
      }
      if (car === ' ') espace = { pos: actuelle.length, vus, actifs };
      actuelle += car;
      vus += w;
    }
  }
  lignes.push(actuelle);
  return lignes;
}

// Un texte trop long pour une ligne, raccourci avec « … »
function tronquer(texte, largeur) {
  if (largeurVisible(texte) <= largeur) return texte;
  return `${couper(texte, Math.max(1, largeur - 1))[0]}${CSI}0m…`;
}

function creerEcran({ sortie = process.stdout, actif = !!sortie.isTTY && !process.env.CATAI_SIMPLE } = {}) {
  const brut = (t) => sortie.write(t);
  const hauteur = () => Math.max(8, sortie.rows || 24);
  const largeur = () => Math.max(20, sortie.columns || 80);
  const gris = (t) => `${CSI}2m${t}${CSI}0m`;
  let statut = '';
  let aide = '';
  let activite = null; // « Miaou réfléchit… 12 s » pendant une réponse
  let indice = null; // une aide d'un instant (les commandes possibles après Tab), jusqu'à la touche suivante
  let invite = '';
  let rl = null;
  let ouvert = false;
  let enCours = ''; // la ligne de la conversation commencée mais pas finie, dessinée juste au-dessus du cadre
  let auDessus = 0; // lignes d'écran entre le haut de la zone vivante et le curseur
  const historique = []; // les lignes finies, pour tout réécrire quand la fenêtre change de taille
  const collages = new Map();
  let prevu = false;
  let minuterieTaille = null;

  // readline écrit ici (la saisie, les complétions) : c'est nous qui dessinons le champ
  const muette = new Writable({ write(_morceau, _codage, suite) { suite(); } });
  muette.isTTY = true;
  Object.defineProperty(muette, 'columns', { get: largeur });
  Object.defineProperty(muette, 'rows', { get: hauteur });

  // La saisie, coupée en lignes d'écran, et où se trouve le curseur
  function saisie() {
    const larg = largeur() - 1;
    const marge = ' '.repeat(largeurVisible(invite));
    const texte = rl ? rl.line || '' : '';
    const pos = rl ? rl.cursor ?? texte.length : 0;
    const lignes = [invite];
    let w = largeurVisible(invite);
    let ligneCurseur = 0;
    let colCurseur = w;
    let i = 0;
    for (const car of texte) {
      const cw = largeurCar(car.codePointAt(0));
      if (w + cw > larg) { lignes.push(marge); w = marge.length; }
      if (i === pos) { ligneCurseur = lignes.length - 1; colCurseur = w; }
      lignes[lignes.length - 1] += car;
      w += cw;
      i += car.length;
    }
    if (pos >= texte.length) {
      if (w >= larg) { lignes.push(marge); w = marge.length; }
      ligneCurseur = lignes.length - 1;
      colCurseur = w;
    }
    // Un très long texte : on montre les lignes autour du curseur
    const max = Math.max(1, Math.min(8, hauteur() - 6));
    const debut = Math.max(0, Math.min(lignes.length - max, ligneCurseur - max + 1));
    return { lignes: lignes.slice(debut, debut + max), ligneCurseur: ligneCurseur - debut, colCurseur };
  }

  // Le cadre : en haut l'état, puis la saisie, le bas du cadre, et une ligne d'aide (ou ce que fait le modèle)
  function cadre() {
    const L = largeur();
    const titre = statut ? ` ${tronquer(statut, L - 8)} ` : '';
    const haut = gris(`╭─${titre}${'─'.repeat(Math.max(0, L - 4 - largeurVisible(titre)))}╮`);
    const bas = gris(`╰${'─'.repeat(L - 3)}╯`);
    const texteBas = indice || activite || aide;
    const pied = texteBas ? tronquer(`  ${indice || activite ? texteBas : gris(texteBas)}`, L - 1) : '';
    const s = saisie();
    return { lignes: [haut, ...s.lignes, bas, pied], ligneCurseur: 1 + s.ligneCurseur, colCurseur: s.colCurseur };
  }

  const nettoyer = (t) => String(t).replace(CODES_SANS_COULEUR, '').replace(/\t/g, '    ').replace(/\r\n/g, '\n');
  const finir = (ligne) => ligne.slice(ligne.lastIndexOf('\r') + 1);

  // Efface la zone vivante, écrit le nouveau texte de la conversation, puis redessine la ligne commencée et le cadre
  function dessiner(nouveau = '') {
    prevu = false;
    const L = largeur();
    // Début d'une mise à jour « synchronisée » (le terminal affiche tout d'un coup, sans clignoter) : ignoré ailleurs
    let s = `${CSI}?2026h\r${auDessus ? `${CSI}${auDessus}A` : ''}${CSI}J`;
    const lignes = (enCours + nettoyer(nouveau)).split('\n');
    enCours = finir(lignes.pop());
    for (const l of lignes) {
      const ligne = finir(l);
      historique.push(ligne);
      s += `${ligne}${CSI}0m\r\n`;
    }
    // Une ligne commencée plus large que l'écran : ses premières lignes d'écran sont finies, elles montent
    if (enCours) {
      const morceaux = couper(enCours, L, { mots: true });
      enCours = morceaux.pop();
      for (const m of morceaux) { historique.push(m); s += `${m}${CSI}0m\r\n`; }
      if (enCours) s += `${enCours}${CSI}0m\r\n`;
    }
    if (historique.length > MAX_HISTORIQUE) historique.splice(0, historique.length - MAX_HISTORIQUE);
    const c = cadre();
    s += c.lignes.join('\r\n');
    const remonter = c.lignes.length - 1 - c.ligneCurseur;
    s += `${remonter ? `${CSI}${remonter}A` : ''}${CSI}${c.colCurseur + 1}G${CSI}?2026l`;
    auDessus = (enCours ? 1 : 0) + c.ligneCurseur;
    brut(s);
  }

  // Plusieurs touches d'un coup (un collage, une répétition) : un seul dessin
  function planifier() {
    if (!ouvert || prevu) return;
    prevu = true;
    setImmediate(() => { if (ouvert && prevu) dessiner(); });
  }

  function ecrire(texte) {
    if (!ouvert) { brut(texte); return; }
    dessiner(texte);
  }

  // La largeur a changé : le terminal a redécoupé (ou pas) ce qui est affiché, la zone vivante n'est plus où on la
  // croit. On efface tout et on réécrit la conversation depuis le début, à la nouvelle largeur.
  function redimensionner() {
    if (!ouvert) return;
    clearTimeout(minuterieTaille);
    minuterieTaille = setTimeout(() => {
      if (!ouvert) return;
      // Les lignes trop larges pour la nouvelle taille sont recoupées entre deux mots (le terminal les coupait n'importe où)
      const L = largeur();
      const tout = historique.flatMap((l) => couper(l, L, { mots: true })).map((l) => `${l}${CSI}0m\r\n`).join('');
      brut(`${CSI}2J${CSI}3J${CSI}H${tout}`);
      auDessus = 0;
      dessiner();
    }, 80);
  }

  function ouvrir() {
    if (!actif || ouvert) return;
    ouvert = true;
    // L'écran est vidé (ce qu'il y avait reste plus haut dans l'historique du terminal), et le terminal nous
    // signale les collages (ESC [200~ … ESC [201~)
    brut(`${CSI}2J${CSI}H${CSI}?2004h`);
    enCours = '';
    auDessus = 0;
    dessiner();
    sortie.on?.('resize', redimensionner);
  }

  function fermer() {
    if (!ouvert) return;
    ouvert = false;
    clearTimeout(minuterieTaille);
    sortie.off?.('resize', redimensionner);
    // Le cadre disparaît, la conversation reste : on retrouve le terminal juste en dessous
    brut(`\r${auDessus ? `${CSI}${auDessus}A` : ''}${CSI}J${enCours ? `${enCours}${CSI}0m\r\n` : ''}${CSI}?2004l`);
    enCours = '';
    auDessus = 0;
  }

  // ---------- Ce qui arrive du clavier ----------
  // Un texte collé de plusieurs lignes ne doit pas partir ligne par ligne. Le terminal l'encadre en général
  // (ESC [200~ … ESC [201~) ; sinon on le devine : un retour à la ligne suivi aussitôt d'autre chose.
  function filtrerEntree(entree) {
    if (!entree?.emit) return;
    const emettre = entree.emit.bind(entree);
    const injecter = (t) => emettre('data', Buffer.from(t));
    let encadre = null; // texte collé en cours (encadré par le terminal)
    let devine = null; // texte collé deviné, tant qu'il arrive
    let minuterieDevine = null;
    let entreeRetenue = null; // un Entrée seul, retenu un instant : si du texte suit aussitôt, c'est un collage

    function livrer(t) {
      const texte = String(t).replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').replace(/\t/g, '    ').replace(/^\n+|\n+$/g, '');
      if (!texte) return;
      if (!texte.includes('\n')) { injecter(texte); return; }
      const jeton = `[texte collé n°${collages.size + 1} · ${texte.split('\n').length} lignes]`;
      collages.set(jeton, texte);
      injecter(jeton);
    }
    let apresEntree = false; // le collage deviné a commencé par un Entrée retenu
    function finirDevine() {
      minuterieDevine = null;
      const c = devine;
      devine = null;
      // Un Entrée suivi d'une seule ligne tapée très vite : ce n'était pas un collage, l'Entrée part d'abord
      if (apresEntree && !/[\r\n]/.test(c.slice(1))) { apresEntree = false; injecter('\r'); livrer(c.slice(1)); return; }
      apresEntree = false;
      livrer(c);
    }
    function normal(t) {
      if (!t) return;
      if (devine !== null) {
        devine += t;
        clearTimeout(minuterieDevine);
        minuterieDevine = setTimeout(finirDevine, 40);
        return;
      }
      if (entreeRetenue) { clearTimeout(entreeRetenue); entreeRetenue = null; devine = '\n'; apresEntree = true; normal(t); return; }
      if (!/[\r\n]/.test(t)) { injecter(t); return; }
      if (t === '\r' || t === '\n') {
        entreeRetenue = setTimeout(() => { entreeRetenue = null; injecter('\r'); }, 25);
        return;
      }
      devine = '';
      normal(t);
    }
    entree.emit = (nom, donnees, ...reste) => {
      if (nom !== 'data' || donnees == null || !ouvert) return emettre(nom, donnees, ...reste);
      let t = Buffer.isBuffer(donnees) ? donnees.toString('utf8') : String(donnees);
      while (t) {
        if (encadre !== null) {
          const f = t.indexOf(FIN_COLLAGE);
          if (f < 0) { encadre += t; break; }
          const c = encadre + t.slice(0, f);
          encadre = null;
          t = t.slice(f + FIN_COLLAGE.length);
          livrer(c);
        } else {
          const d = t.indexOf(DEBUT_COLLAGE);
          if (d < 0) { normal(t); break; }
          normal(t.slice(0, d));
          encadre = '';
          t = t.slice(d + DEBUT_COLLAGE.length);
        }
      }
      return true;
    };
  }

  return {
    actif,
    get ouvert() { return ouvert; },
    // La sortie à donner à readline pour une discussion en plein écran
    sortieReadline: muette,
    ouvrir,
    fermer,
    ecrire,
    attacher(lecture) {
      rl = lecture;
      // Seulement au clavier : une entrée redirigée (echo … | catai) envoie une ligne par message
      if (lecture.input?.isTTY) filtrerEntree(lecture.input);
      // readline a déjà traité la touche (son écouteur passe avant) : on redessine le champ
      lecture.input?.on?.('keypress', (_, touche) => {
        if (!ouvert) return;
        if (touche?.name !== 'tab') indice = null;
        planifier();
      });
    },
    // Le vrai texte des collages, à la place de leurs « [texte collé n°…] »
    deplier(ligne) {
      let r = String(ligne ?? '');
      for (const [jeton, texte] of collages) r = r.split(jeton).join(texte);
      return r;
    },
    aide(texte) { aide = texte; if (ouvert) planifier(); },
    activite(texte) {
      if (texte === activite) return;
      activite = texte;
      if (ouvert) planifier();
    },
    indice(texte) { indice = texte; if (ouvert) planifier(); },
    // Le texte avant le champ (« ❯ », ou une question o/N)
    invite(texte) { invite = texte; if (ouvert) planifier(); },
    statut(texte) { statut = texte; if (ouvert) planifier(); },
    pied: () => { if (ouvert) planifier(); },
  };
}

module.exports = { creerEcran, largeurVisible, largeurCar, couper, tronquer };
