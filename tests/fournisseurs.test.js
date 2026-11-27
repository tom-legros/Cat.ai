// Le coffre est simulé : aucune vraie clé ni aucun trousseau personnel n'est lu.
const test = require('node:test');
const assert = require('node:assert/strict');
const chargerModule = require('./helpers/charger-module.cjs');

function fournisseurs({ platform = 'linux', disponible = true, backend = 'gnome_libsecret', illisible = false } = {}) {
  const cle = 'gsk_cle-fictive-pour-test';
  const chiffree = Buffer.from('octets-chiffres-fictifs').toString('base64');
  const safeStorage = {
    isAsyncEncryptionAvailable: async () => disponible,
    getSelectedStorageBackend: () => backend,
    encryptStringAsync: async (texte) => { assert.equal(texte, cle); return Buffer.from('octets-chiffres-fictifs'); },
    decryptStringAsync: async (octets) => {
      assert.equal(octets.toString('base64'), chiffree);
      if (illisible) throw new Error('Coffre indisponible');
      return { result: cle, shouldReEncrypt: false };
    },
  };
  const reglages = { fournisseurs: { groq: { cleChiffree: chiffree } } };
  const api = chargerModule('principal/fournisseurs.js', {
    electron: { safeStorage },
    './stockage': { readJson: () => reglages, writeJson: () => assert.fail('aucune écriture attendue') },
  }, { process: { platform } });
  return { api, cle, chiffree };
}

for (const platform of ['win32', 'linux']) {
  test(`${platform} : un coffre indisponible interdit le stockage`, async () => {
    const { api } = fournisseurs({ platform, disponible: false });
    assert.equal((await api.etatChiffrement()).dispo, false);
  });
}
test('Linux : basic_text ne constitue pas une protection acceptable', async () => {
  assert.equal((await fournisseurs({ backend: 'basic_text' }).api.etatChiffrement()).dispo, false);
  assert.equal((await fournisseurs().api.etatChiffrement()).dispo, true);
});
test('les données pour l’interface ne contiennent ni clé claire ni clé chiffrée', async () => {
  const { api, cle, chiffree } = fournisseurs();
  const vue = await api.versInterface();
  assert.equal(vue.fournisseurs.find(f => f.id === 'groq').aCle, true);
  const texte = JSON.stringify(vue);
  assert.equal(texte.includes(cle), false);
  assert.equal(texte.includes(chiffree), false);
  assert.equal(texte.includes('cleChiffree'), false);
});
test('le chiffrement utilise le coffre ; une clé illisible ne devient pas une clé en clair', async () => {
  const { api, cle, chiffree } = fournisseurs();
  assert.equal(await api.chiffrer(cle), chiffree);
  const inaccessible = fournisseurs({ illisible: true }).api;
  const config = await inaccessible.configFournisseur('groq');
  assert.equal(config.cle, '');
  assert.equal(config.cleIllisible, true);
  assert.equal((await inaccessible.versInterface()).fournisseurs.find(f => f.id === 'groq').aCle, false);
});
