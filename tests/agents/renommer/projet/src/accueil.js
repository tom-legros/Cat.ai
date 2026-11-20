const { nomComplet } = require('./utilisateur');

function messageAccueil(u) {
  return `Bonjour ${nomComplet(u)} !`;
}

module.exports = { messageAccueil };
