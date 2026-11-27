// Une liste de tâches : chaque tâche est { id, titre, faite }
function ajouterTache(liste, titre) {
  const id = liste.length ? Math.max(...liste.map((t) => t.id)) + 1 : 1;
  return [...liste, { id, titre, faite: false }];
}

module.exports = { ajouterTache };
