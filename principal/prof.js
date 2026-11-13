// Mode prof : aucune réponse ne doit contenir de bloc de code. La consigne et le rappel ne suffisent pas avec un
// petit modèle (qwen3:8b en donnait 2 à 4 fois sur 10 quand on insistait) : les blocs ``` sont donc retirés du
// texte pendant qu'il arrive, et remplacés par une ligne qui le dit. Le code en ligne (`map`, `i++`) reste.
//
// Le filtre travaille morceau par morceau : une suite de ``` peut être coupée entre deux morceaux, donc les
// accents graves de la fin d'un morceau attendent le suivant avant d'être affichés.

const BLOC_RETIRE = "\n\n*(Mode prof : bloc de code retiré. Essaie d'écrire ce code toi-même à partir de l'explication.)*\n\n";

function creerFiltreCode(afficher) {
  let dansBloc = false;
  let attente = ''; // accents graves de la fin d'un morceau, pas encore classés
  let longueur = 0; // ce qui a vraiment été affiché, pour pouvoir l'effacer (chat-undo)
  const sortir = (texte) => { if (texte) { longueur += texte.length; afficher(texte); } };
  // Avance dans le texte : hors bloc, tout est affiché jusqu'à ```, dans un bloc tout est jeté jusqu'à ```
  const traiter = (texte, fin) => {
    let t = attente + texte;
    attente = '';
    let sortie = '';
    while (t) {
      const i = t.indexOf('```');
      if (i < 0) {
        // Un ou deux accents graves à la fin : peut-être le début d'un ``` coupé en deux
        const reste = fin ? 0 : (/`{1,2}$/.exec(t)?.[0].length || 0);
        if (!dansBloc) sortie += t.slice(0, t.length - reste);
        attente = t.slice(t.length - reste);
        break;
      }
      if (!dansBloc) { sortie += t.slice(0, i) + BLOC_RETIRE; dansBloc = true; } else dansBloc = false;
      t = t.slice(i + 3);
    }
    sortir(sortie);
  };
  return {
    morceau: (texte) => traiter(texte, false),
    // Fin de la réponse : les accents graves en attente sont affichés (hors bloc), et on repart hors bloc
    fin: () => { traiter('', true); dansBloc = false; },
    longueur: () => longueur,
    remettreAZero: () => { longueur = 0; },
  };
}

// La même chose d'un coup, pour le texte gardé dans l'historique
function retirerCode(texte) {
  let sortie = '';
  const filtre = creerFiltreCode((t) => { sortie += t; });
  filtre.morceau(String(texte || ''));
  filtre.fin();
  return sortie;
}

module.exports = { BLOC_RETIRE, creerFiltreCode, retirerCode };
