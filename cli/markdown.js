// Le markdown des réponses, rendu pour un terminal : **gras**, *italique*, `code`, titres, listes, citations, blocs
// de code et tableaux. Les marques (**, #, ```) disparaissent, il reste le texte mis en forme.
//
// Le texte arrive par morceaux : on écrit tout de suite ce qui ne peut plus changer, et on garde de côté ce qui
// attend sa fin (un « ** » ouvert, le début d'une ligne qui sera peut-être un titre ou une liste). Rien n'est réécrit.

const CSI = '\x1b[';
const sgr = (code, fin) => (t) => `${CSI}${code}m${t}${CSI}${fin}m`;
const STYLES_COULEUR = {
  gras: sgr('1', '22'),
  italique: sgr('3', '23'),
  barre: sgr('9', '29'),
  code: sgr('36', '39'),
  lien: sgr('4', '24'),
  gris: sgr('2', '22'),
  titre: (t, niveau) => (niveau === 1 ? `${CSI}1;4m${t}${CSI}22;24m` : `${CSI}1m${t}${CSI}22m`),
};
const SANS_STYLE = Object.fromEntries(Object.keys(STYLES_COULEUR).map((k) => [k, (t) => t]));

const MOT = /[\p{L}\p{N}]/u;

// Jusqu'où le texte peut être écrit sans couper une marque pas encore fermée
function coupeSure(s) {
  let sure = 0;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '`') {
      const j = s.indexOf('`', i + 1);
      if (j < 0) return sure;
      i = j + 1;
    } else if (c === '*' || c === '~' || (c === '_' && !MOT.test(s[i - 1] || ''))) {
      let n = 1;
      while (s[i + n] === c) n++;
      if (i + n === s.length) return sure; // la marque continue peut-être dans le morceau suivant
      if (/\s/.test(s[i + n]) || (c === '~' && n < 2)) { i += n; sure = i; continue; } // « 2 * 3 » : pas une marque
      const j = s.indexOf(c.repeat(n), i + n);
      if (j < 0) return sure;
      i = j + n;
    } else if (c === '[') {
      const lien = /^\[[^\]\n]*\]\([^)\n]*\)/.exec(s.slice(i));
      if (lien) i += lien[0].length;
      else if (/^\[[^\]\n]*(\]\(?[^)\n]*)?$/.test(s.slice(i))) return sure; // un lien pas encore fini
      else i++;
    } else i++;
    sure = i;
  }
  return sure;
}

// Les marques d'une ligne (ou d'un bout de ligne aux marques toutes fermées)
function enLigne(s, st) {
  return s.split(/(`[^`\n]+`)/).map((p) => {
    if (p.length > 1 && p.startsWith('`') && p.endsWith('`')) return st.code(p.slice(1, -1));
    return p
      .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, t, u) => (t === u ? st.lien(u) : `${st.lien(t)} ${st.gris(`(${u})`)}`))
      .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, (_, __, t) => st.gras(t))
      .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, (_, t) => st.barre(t))
      .replace(/(^|[^\p{L}\p{N}*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\p{L}\p{N}])/gu, (_, a, t) => a + st.italique(t))
      .replace(/(^|[^\p{L}\p{N}_])_(?=\S)([^_\n]+?)(?<=\S)_(?![\p{L}\p{N}])/gu, (_, a, t) => a + st.italique(t));
  }).join('');
}

function creerRenduMarkdown(ecrire, { couleurs = true } = {}) {
  const st = couleurs ? STYLES_COULEUR : SANS_STYLE;
  let ligne = ''; // la ligne en cours, telle qu'elle arrive
  let lu = 0; // ce qui en a déjà été écrit
  let genre = null; // ce qu'est la ligne : null (pas encore su), 'texte', 'titre', 'code', 'entiere'
  let style = (t) => t; // la mise en forme de toute la ligne (titre, citation)
  let dansCode = false;
  let dansQcm = false; // un bloc ```qcm : pas affiché ici, catai le pose en questions après la réponse

  // Au début d'une ligne : titre, liste, citation, bloc de code… ou on ne sait pas encore
  function deciderDebut(finDeLigne) {
    const retrait = /^\s*/.exec(ligne)[0];
    const r = ligne.slice(retrait.length);
    const attendre = !finDeLigne;
    if (dansCode) {
      if (/^(```|~~~)/.test(r)) { genre = 'entiere'; return; }
      if (attendre && r.length < 3 && '```'.startsWith(r) && r) return false;
      if (attendre && !r) return false;
      genre = dansQcm ? 'cache' : 'code';
      return;
    }
    if (!r) { if (attendre) return false; genre = 'texte'; return; }
    if (attendre && /^(`{1,2}|~{1,2}|#{1,6}|[-*+_]{1,}|\d+[.)]?|\|.*)$/.test(r)) return false;
    if (/^(```|~~~)/.test(r) || r.startsWith('|') || /^([-*_])( ?\1){2,}\s*$/.test(r)) { genre = 'entiere'; return; }
    const titre = /^(#{1,6})\s+/.exec(r);
    if (titre) {
      const niveau = titre[1].length;
      ecrire(retrait);
      style = (t) => st.titre(t, niveau);
      lu = retrait.length + titre[0].length;
      genre = 'texte';
      return;
    }
    const puce = /^[-*+]\s+/.exec(r);
    if (puce) {
      ecrire(`${retrait}${st.gris('•')} `);
      lu = retrait.length + puce[0].length;
      genre = 'texte';
      return;
    }
    const citation = /^>\s?/.exec(r);
    if (citation) {
      ecrire(`${retrait}${st.gris('│')} `);
      style = st.italique;
      lu = retrait.length + citation[0].length;
      genre = 'texte';
      return;
    }
    genre = 'texte';
  }

  // Une ligne gardée entière : bord de bloc de code, ligne de tableau, trait
  function ecrireEntiere(l) {
    const r = l.trim();
    if (/^(```|~~~)/.test(r)) {
      dansCode = !dansCode;
      if (dansCode && /^```\s*(qcm|choix)\b/i.test(r)) dansQcm = true;
      else if (!dansCode && dansQcm) { dansQcm = false; ecrire(st.gris('(QCM : les questions arrivent juste en dessous)')); return true; }
      return false; // la ligne disparaît, avec son retour à la ligne
    }
    if (r.startsWith('|')) {
      const cellules = r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (cellules.every((c) => /^:?-{2,}:?$/.test(c))) { ecrire(st.gris(cellules.map((c) => '─'.repeat(Math.max(3, c.length))).join('─┼─'))); return true; }
      ecrire(cellules.map((c) => enLigne(c, st)).join(st.gris(' │ ')));
      return true;
    }
    ecrire(st.gris('─'.repeat(40)));
    return true;
  }

  function avancer(finDeLigne) {
    if (genre === null && deciderDebut(finDeLigne) === false) return;
    if (genre === 'entiere' || genre === 'cache') return; // attend la fin de la ligne, ou ne s'écrit pas
    if (genre === 'code') { if (lu < ligne.length) ecrire(st.code(ligne.slice(lu))); lu = ligne.length; return; }
    const reste = ligne.slice(lu);
    const n = finDeLigne ? reste.length : coupeSure(reste);
    if (n > 0) { ecrire(style(enLigne(reste.slice(0, n), st))); lu += n; }
  }

  function finirLigne() {
    let saut = true;
    if (genre === null) deciderDebut(true);
    if (genre === 'entiere') saut = ecrireEntiere(ligne);
    else if (genre === 'cache') saut = false;
    else avancer(true);
    if (saut) ecrire('\n');
    ligne = '';
    lu = 0;
    genre = null;
    style = (t) => t;
  }

  return {
    texte(t) {
      const morceaux = String(t || '').split('\n');
      morceaux.forEach((m, i) => {
        if (i > 0) finirLigne();
        ligne += m;
        if (m) avancer(false);
      });
    },
    // Fin de la réponse (ou avant une action) : ce qui attend est écrit tel quel, marques comprises
    fin() {
      // Un bloc qcm que le modèle n'a pas fermé : la réponse finit dedans, on l'annonce quand même
      if (dansQcm) { dansQcm = false; dansCode = false; ligne = ''; lu = 0; genre = null; ecrire(`${st.gris('(QCM : les questions arrivent juste en dessous)')}\n`); return; }
      if (!ligne) return;
      if (genre === null) deciderDebut(true);
      if (genre === 'entiere') ecrireEntiere(ligne); else avancer(true);
      ligne = '';
      lu = 0;
      genre = null;
      style = (t) => t;
    },
  };
}

module.exports = { creerRenduMarkdown, enLigne, coupeSure, STYLES_COULEUR, SANS_STYLE };
