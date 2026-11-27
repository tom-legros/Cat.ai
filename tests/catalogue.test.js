const test = require('node:test');
const assert = require('node:assert/strict');

test('bibliothèque locale : exclut embeddings, modération, audio et cloud seul', () => {
  const { lireBibliotheque } = require('../outils/actualiser-catalogue');
  const carte = (nom, labels) => `<a href="/library/${nom}">${labels.map(l => `<span>${l}</span>`).join('')}</a>`;
  const html = carte('qwen3', ['tools', 'thinking', '8b']) + carte('payant', ['cloud'])
    + carte('nomic-embed-text', ['embedding']) + carte('llama-guard3', ['8b']) + carte('lfm3-audio', ['1b']);
  assert.deepEqual(lireBibliotheque(html).map(m => m.modele), ['qwen3:latest']);
});
