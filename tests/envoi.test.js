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

test('Gemini 3 : la signature de réflexion d un appel d outil est gardée et renvoyée telle quelle', () => {
  const signature = { google: { thought_signature: 'EpoGCpcGAXLI2nx' } };
  // Les morceaux du flux, comme les envoie le point d'accès compatible OpenAI de Gemini
  const appels = [{ id: 'c1', name: 'chercher', arguments: '{"texte":"x"}', extra_content: signature }];
  const [appel] = finirAppels(appels);
  assert.deepEqual(appel.extra_content, signature);
  const openai = versOpenAI([{ role: 'assistant', content: '', tool_calls: [appel] }, { role: 'tool', content: 'r', tool_call_id: 'c1' }]);
  assert.deepEqual(openai[0].tool_calls[0].extra_content, signature);
});

test('sans signature (Groq, OpenRouter), aucun champ extra_content n est envoyé', () => {
  const [appel] = finirAppels([{ id: 'c1', name: 'chercher', arguments: '{}' }]);
  assert.equal('extra_content' in appel, false);
  assert.equal('extra_content' in versOpenAI([{ role: 'assistant', content: '', tool_calls: [appel] }])[0].tool_calls[0], false);
});

test('Gemini 3 : la signature survit au flux SSE, puis repart dans la requête suivante', async (t) => {
  const { envoyerOpenAI } = require('../principal/envoi');
  const config = { id: 'gemini', nom: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', cle: 'cle-factice' };
  const morceau = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
  const flux = morceau({ tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'chercher', arguments: '{"texte":' }, extra_content: { google: { thought_signature: 'SIG' } } }] })
    + morceau({ tool_calls: [{ index: 0, function: { arguments: '"remplacerTexte"}' } }] })
    + 'data: [DONE]\n\n';
  const corpsEnvoyes = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    corpsEnvoyes.push(JSON.parse(options.body));
    return new Response(flux, { status: 200 });
  };
  t.after(() => { globalThis.fetch = fetchOriginal; });

  const { toolCalls } = await envoyerOpenAI(config, [{ role: 'user', content: 'où ?' }], 'gemini-3.5-flash-lite', () => {}, undefined, {});
  assert.deepEqual(toolCalls[0].function, { name: 'chercher', arguments: { texte: 'remplacerTexte' } });
  assert.deepEqual(toolCalls[0].extra_content, { google: { thought_signature: 'SIG' } });

  // Tour suivant : l'historique avec l'appel et son résultat repart vers Gemini, signature comprise
  await envoyerOpenAI(config, [
    { role: 'user', content: 'où ?' },
    { role: 'assistant', content: '', tool_calls: toolCalls },
    { role: 'tool', content: 'principal/outils.js:118: function remplacerTexte', tool_call_id: 'c1' },
  ], 'gemini-3.5-flash-lite', () => {}, undefined, {});
  assert.equal(corpsEnvoyes[1].messages[1].tool_calls[0].extra_content.google.thought_signature, 'SIG');
});
