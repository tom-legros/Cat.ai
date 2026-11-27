function ajouterTache(liste, titre) {
  const id = liste.length ? Math.max(...liste.map((t) => t.id)) + 1 : 1;
  return [...liste, { id, titre, faite: false }];
}
const supprimerTache = (liste, id) => liste.filter((t) => t.id !== id);
const marquerFaite = (liste, id) => liste.map((t) => (t.id === id ? { ...t, faite: true } : t));
const tachesFaites = (liste) => liste.filter((t) => t.faite);

module.exports = { ajouterTache, supprimerTache, marquerFaite, tachesFaites };
