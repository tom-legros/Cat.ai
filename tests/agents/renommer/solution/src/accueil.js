const { nomAffiche } = require('./utilisateur');

function messageAccueil(u) {
  return `Bonjour ${nomAffiche(u)} !`;
}

module.exports = { messageAccueil };
