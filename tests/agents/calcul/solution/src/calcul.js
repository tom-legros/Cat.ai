function somme(a, b) {
  return a + b;
}

function moyenne(nombres) {
  return nombres.length ? nombres.reduce((t, n) => t + n, 0) / nombres.length : 0;
}

module.exports = { somme, moyenne };
