// La règle « 100 % gratuit » : le garde-fou le plus important de l'app. Aucun payant ne doit passer.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fournisseurGratuit, modeleGratuit, conseilGratuit, adresseValide, hote } = require('../principal/gratuit');

const GEMINI = { type: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' };
const OPENROUTER = { type: 'openai', baseUrl: 'https://openrouter.ai/api/v1' };
const GROQ = { type: 'openai', baseUrl: 'https://api.groq.com/openai/v1' };

test('fournisseurs acceptés : Groq, OpenRouter, Gemini et les serveurs sur le PC', () => {
  for (const url of [GEMINI.baseUrl, OPENROUTER.baseUrl, GROQ.baseUrl, 'http://localhost:1234/v1', 'http://127.0.0.1:8080', 'http://[::1]:1234/v1']) {
    assert.ok(fournisseurGratuit(url), url);
  }
});

test('fournisseurs payants ou inconnus refusés, même déguisés', () => {
  for (const url of [
    'https://api.openai.com/v1',
    'https://api.anthropic.com/v1',
    'https://api.mistral.ai/v1',
    'https://openrouter.ai.pirate.com/api/v1', // ressemble à OpenRouter, mais ce n'est pas lui
    'https://evil.com/?openrouter.ai',
    'http://192.168.1.20:1234/v1', // un autre PC du réseau n'est pas « ton PC »
    'pas une adresse',
    '',
  ]) {
    assert.equal(fournisseurGratuit(url), false, url);
  }
});

test('OpenRouter : seulement les modèles « :free »', () => {
  assert.ok(modeleGratuit(OPENROUTER, 'qwen/qwen3-coder:free'));
  assert.equal(modeleGratuit(OPENROUTER, 'qwen/qwen3-coder'), false);
  assert.equal(modeleGratuit(OPENROUTER, 'anthropic/claude:free-trial'), false);
  assert.equal(modeleGratuit(OPENROUTER, 'openai/gpt-5'), false);
});

test('Gemini : seulement les « flash », jamais « image »', () => {
  assert.ok(modeleGratuit(GEMINI, 'gemini-3.5-flash-lite'));
  assert.ok(modeleGratuit(GEMINI, 'gemini-3.5-flash'));
  assert.equal(modeleGratuit(GEMINI, 'gemini-3.5-pro'), false);
  assert.equal(modeleGratuit(GEMINI, 'gemini-3.5-flash-image'), false);
});

test('Groq, Ollama et les serveurs locaux : tous les modèles', () => {
  assert.ok(modeleGratuit(GROQ, 'openai/gpt-oss-20b'));
  assert.ok(modeleGratuit({ type: 'ollama' }, 'qwen3:8b'));
  assert.ok(modeleGratuit({ type: 'openai', baseUrl: 'http://localhost:1234/v1' }, 'nimporte-quoi'));
});

test('sans fournisseur, ou avec une adresse payante, rien ne passe', () => {
  assert.equal(modeleGratuit(null, 'qwen3:8b'), false);
  assert.equal(modeleGratuit({ type: 'openai', baseUrl: 'https://api.openai.com/v1' }, 'gpt-5:free'), false);
});

test('le conseil dit quoi faire selon le fournisseur', () => {
  assert.match(conseilGratuit(GEMINI), /flash/);
  assert.match(conseilGratuit(OPENROUTER), /:free/);
  assert.match(conseilGratuit({ baseUrl: 'https://api.openai.com/v1' }), /pas un fournisseur gratuit/);
});

test('adresses : https partout, http seulement sur le PC', () => {
  assert.ok(adresseValide('https://api.groq.com/openai/v1'));
  assert.ok(adresseValide('http://localhost:1234/v1'));
  assert.equal(adresseValide('http://api.groq.com/openai/v1'), false);
  assert.equal(adresseValide('ftp://localhost'), false);
  assert.equal(adresseValide('localhost:1234'), false);
});

test('hote : en minuscules, vide si l adresse est invalide', () => {
  assert.equal(hote('https://OpenRouter.AI/api/v1'), 'openrouter.ai');
  assert.equal(hote('n importe quoi'), '');
});
