// Envoi au modèle : conversion des formats Ollama / OpenAI, reconnaissance des erreurs des fournisseurs
const test = require('node:test');
const assert = require('node:assert/strict');
const { versOpenAI, finirAppels, attenteDemandee, estModeleCasse, messageErreurOpenAI } = require('../principal/envoi');

test('versOpenAI : arguments en texte JSON, et chaque résultat relié à son appel', () => {
  const ollama = [
    { role: 'user', content: 'lis a.js' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'x1', function: { name: 'lire_fichier', arguments: { chemin: 'a.js' } } }] },
    { role: 'tool', content: 'contenu', tool_call_id: 'x1', tool_name: 'lire_fichier' },
  ];
  const openai = versOpenAI(ollama);
  assert.equal(openai[1].tool_calls[0].function.arguments, '{"chemin":"a.js"}');
  assert.equal(openai[1].content, null);
  assert.deepEqual(openai[2], { role: 'tool', tool_call_id: 'x1', content: 'contenu' });
});

test('versOpenAI : un résultat sans identifiant prend le plus ancien appel sans réponse', () => {
  const openai = versOpenAI([
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'a', arguments: {} } }, { function: { name: 'b', arguments: {} } }] },
    { role: 'tool', content: 'ra' },
    { role: 'tool', content: 'rb' },
  ]);
  const [appelA, appelB] = openai[0].tool_calls.map((c) => c.id);
  assert.equal(openai[1].tool_call_id, appelA);
  assert.equal(openai[2].tool_call_id, appelB);
});

test('finirAppels : morceaux d appels OpenAI → format Ollama, JSON cassé → arguments vides', () => {
  assert.deepEqual(finirAppels([{ id: 'c1', name: 'chercher', arguments: '{"texte":"x"}' }, undefined, { id: '', name: 'lister_fichiers', arguments: '{cassé' }]), [
    { id: 'c1', function: { name: 'chercher', arguments: { texte: 'x' } } },
    { id: 'appel_1', function: { name: 'lister_fichiers', arguments: {} } },
  ]);
});

test('attenteDemandee : en-tête Retry-After, ou texte de Groq, sinon null', async () => {
  assert.equal(await attenteDemandee(new Response('', { status: 429, headers: { 'retry-after': '7' } })), 7);
  assert.equal(await attenteDemandee(new Response('Please try again in 12.5s.', { status: 429 })), 12.5);
  assert.equal(await attenteDemandee(new Response('Please try again in 1m30s.', { status: 429 })), 90);
  assert.equal(await attenteDemandee(new Response('Please try again in 450ms.', { status: 429 })), 0.45);
  assert.equal(await attenteDemandee(new Response('quota du jour épuisé', { status: 429 })), null);
});

test('estModeleCasse : modèle qui n existe plus, mais jamais une clé ou une mauvaise adresse', () => {
  assert.ok(estModeleCasse(404, 'models/gemini-1.0-pro is no longer available'));
  assert.ok(estModeleCasse(400, 'The model llama3-70b has been decommissioned'));
  assert.ok(estModeleCasse(404, 'No endpoints found for qwen/qwen3:free'));
  assert.equal(estModeleCasse(404, 'Not Found'), false);
  assert.equal(estModeleCasse(401, 'model does not exist'), false);
  assert.equal(estModeleCasse(400, 'Groq refuse la clé API (400)'), false);
});

test('messageErreurOpenAI : message clair en français selon le code', async () => {
  const config = { nom: 'Groq' };
  const erreur = (status, corps) => messageErreurOpenAI(config, new Response(JSON.stringify(corps), { status }));
  assert.match(await erreur(401, { error: { message: 'Invalid API Key' } }), /refuse la clé API \(401\)/);
  assert.match(await erreur(400, { error: { message: 'API key not valid. API_KEY_INVALID' } }), /refuse la clé/);
  assert.match(await erreur(429, { error: { message: 'Rate limit' } }), /Limite atteinte/);
  assert.match(await erreur(402, {}), /plus assez de crédit/);
  assert.match(await erreur(403, { error: { message: 'Key limit exceeded' } }), /limite de crédit de cette clé/);
  assert.match(await erreur(503, {}), /problème de son côté/);
});
