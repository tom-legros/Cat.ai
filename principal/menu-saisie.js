// Clic droit dans l'app : les corrections d'un mot souligné, puis couper / copier / coller.
// lignesMenu est pure (facile à tester) : elle décrit le menu, main.js le construit.
//
// La correction vient d'Electron (dictionnaires français et anglais). Rien de ce qui est tapé ne quitte le PC :
// seul le dictionnaire est téléchargé une fois, s'il n'est pas déjà là.
const LANGUES_CORRECTION = ['fr', 'en-US'];
const MAX_PROPOSITIONS = 6;

// p : les paramètres de l'évènement context-menu d'Electron.
// Chaque ligne : { texte, action, valeur? } ou { separateur: true }.
function lignesMenu(p) {
  const lignes = [];
  if (p.isEditable && p.misspelledWord) {
    const propositions = (p.dictionarySuggestions || []).slice(0, MAX_PROPOSITIONS);
    for (const mot of propositions) lignes.push({ texte: mot, action: 'corriger', valeur: mot });
    if (!propositions.length) lignes.push({ texte: 'Aucune proposition', action: 'rien' });
    lignes.push({ texte: `Ne plus souligner « ${p.misspelledWord} »`, action: 'apprendre', valeur: p.misspelledWord });
    lignes.push({ separateur: true });
  }
  const selection = !!String(p.selectionText || '').trim();
  if (p.isEditable) {
    if (selection) lignes.push({ texte: 'Couper', action: 'couper' });
    if (selection) lignes.push({ texte: 'Copier', action: 'copier' });
    lignes.push({ texte: 'Coller', action: 'coller' });
  } else if (selection) {
    lignes.push({ texte: 'Copier', action: 'copier' });
  }
  // Pas de trait à la fin d'un menu
  while (lignes.at(-1)?.separateur) lignes.pop();
  return lignes;
}

module.exports = { LANGUES_CORRECTION, lignesMenu };
