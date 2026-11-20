function capitaliser(mot) {
  return mot ? mot[0].toUpperCase() + mot.slice(1) : mot;
}

function compterMots(phrase) {
  return phrase.split(' ').filter(Boolean).length;
}

module.exports = { capitaliser, compterMots };
