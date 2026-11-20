// Plein écran pour catai, comme quand on lance « claude » : le terminal passe sur un écran à part (on retrouve son
// contenu en sortant), la conversation défile en haut, et en bas restent fixes une ligne d'état et le champ « ❯ ».
//
// Rien d'installé : des codes ANSI standard (écran alternatif, zone de défilement). La conversation est écrite dans
// la zone qui défile en suivant la ligne et la colonne où l'on en est ; readline garde la dernière ligne pour la saisie.
// Hors d'un vrai terminal (sortie redirigée), ou avec CATAI_SIMPLE=1, tout s'écrit à la suite comme avant.

const CSI = '\x1b[';
const SANS_COULEURS = /\x1b\[[0-9;?]*[A-Za-z]/g;
const largeurVisible = (t) => [...String(t).replace(SANS_COULEURS, '')].length;

function creerEcran({ sortie = process.stdout, actif = !!sortie.isTTY && !process.env.CATAI_SIMPLE } = {}) {
  const brut = (t) => sortie.write(t);
  const hauteur = () => Math.max(10, sortie.rows || 24);
  const largeur = () => Math.max(20, sortie.columns || 80);
  // En bas, un champ encadré, comme Claude Code : le haut du cadre avec l'état, la saisie, le bas du cadre, puis
  // une ligne d'aide. Tout le reste défile.
  const ligneHaut = () => hauteur() - 3;
  const ligneSaisie = () => hauteur() - 2;
  const ligneBasCadre = () => hauteur() - 1;
  const basZone = () => hauteur() - 4;
  let ligne = 1;
  let colonne = 0;
  let statut = '';
  let aide = '';
  let invite = '';
  let rl = null;
  let ouvert = false;

  const aller = (l, c) => `${CSI}${l};${c}H`;
  const gris = (t) => `${CSI}2m${t}${CSI}0m`;

  // Remet le curseur dans le champ de saisie, à la fin de ce qui est tapé
  function versSaisie() {
    const tape = rl ? rl.line.slice(0, rl.cursor) : '';
    brut(aller(ligneSaisie(), Math.min(largeur(), largeurVisible(invite) + largeurVisible(tape) + 1)));
  }

  // Le bas du cadre et l'aide : readline les efface quand il redessine la saisie, on les remet aussitôt
  function dessinerPied() {
    brut(`\x1b7${aller(ligneBasCadre(), 1)}${CSI}2K${gris(`╰${'─'.repeat(largeur() - 3)}╯`)}`);
    brut(`${aller(hauteur(), 1)}${CSI}2K${gris(`  ${aide}`)}\x1b8`);
  }

  function dessinerBas() {
    const titre = statut ? ` ${statut} ` : '';
    const reste = Math.max(0, largeur() - largeurVisible(titre) - 5);
    brut(`${aller(ligneHaut(), 1)}${CSI}2K${gris(`╭─${titre}${'─'.repeat(reste)}╮`)}`);
    brut(`${aller(ligneSaisie(), 1)}${CSI}2K${invite}${rl ? rl.line : ''}`);
    versSaisie();
    dessinerPied();
  }

  // Écrit du texte dans la zone qui défile, à la suite de ce qui y est déjà
  function ecrire(texte) {
    if (!ouvert) { brut(texte); return; }
    const bas = basZone();
    let sortieTexte = aller(ligne, colonne + 1);
    for (const morceau of String(texte).split(/(\n|\r)/)) {
      if (morceau === '\n') {
        if (ligne < bas) { ligne++; sortieTexte += aller(ligne, 1); } else sortieTexte += '\n';
        colonne = 0;
      } else if (morceau === '\r') {
        colonne = 0;
        sortieTexte += aller(ligne, 1);
      } else if (morceau) {
        sortieTexte += morceau;
        const fin = colonne + largeurVisible(morceau);
        // Une ligne trop longue passe à la suivante (le terminal fait le retour tout seul)
        const sauts = Math.floor(fin / largeur());
        colonne = fin % largeur();
        ligne = Math.min(bas, ligne + sauts);
      }
    }
    brut(sortieTexte);
    versSaisie();
  }

  function ouvrir() {
    if (!actif || ouvert) return;
    ouvert = true;
    // Écran à part, effacé, et une zone de défilement qui s'arrête au-dessus de l'état et de la saisie
    brut(`${CSI}?1049h${CSI}2J${CSI}1;${basZone()}r`);
    ligne = 1;
    colonne = 0;
    dessinerBas();
    sortie.on('resize', redimensionner);
  }

  function redimensionner() {
    if (!ouvert) return;
    brut(`${CSI}1;${basZone()}r`);
    ligne = Math.min(ligne, basZone());
    dessinerBas();
  }

  function fermer() {
    if (!ouvert) return;
    ouvert = false;
    sortie.off?.('resize', redimensionner);
    // Rend l'écran d'avant, tel qu'on l'avait laissé
    brut(`${CSI}r${CSI}?1049l`);
  }

  return {
    actif,
    get ouvert() { return ouvert; },
    ouvrir,
    fermer,
    ecrire,
    attacher(lecture) {
      rl = lecture;
      // readline efface le bas de l'écran en redessinant la saisie : on remet le cadre et l'aide juste après
      lecture.input?.on?.('keypress', () => setImmediate(() => { if (ouvert) dessinerPied(); }));
    },
    aide(texte) {
      aide = texte;
      if (ouvert) dessinerPied();
    },
    // Le texte avant le champ (« ❯ », ou une question o/N) ; readline écrit la saisie à la suite
    invite(texte) {
      invite = texte;
      if (ouvert) dessinerBas();
    },
    statut(texte) {
      statut = texte;
      if (ouvert) dessinerBas();
    },
    versSaisie,
    pied: () => { if (ouvert) dessinerPied(); },
  };
}

module.exports = { creerEcran, largeurVisible };
