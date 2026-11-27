function nomAffiche(u) {
  return `${u.prenom} ${u.nom.toUpperCase()}`;
}

module.exports = { nomAffiche };
