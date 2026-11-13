// Envoi au modèle : conversion des formats Ollama / OpenAI, reconnaissance des erreurs des fournisseurs
const test = require('node:test');
const assert = require('node:assert/strict');
const { versOpenAI, finirAppels, attenteDemandee, estModeleCasse, messageErreurOpenAI, vulkanUtile, sansReflexion, rappelsPourOllama, NOTE_APP } = require('../principal/envoi');

test('Ollama sans outils : réessaie en discussion simple uniquement après refus explicite', async (t) => {
  const { envoyerOllama } = require('../principal/envoi');
  const corps = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    corps.push(JSON.parse(options.body));
    return corps.length === 1
      ? new Response(JSON.stringify({ error: 'model does not support tools' }), { status: 400 })
      : new Response(JSON.stringify({ message: { content: 'Bonjour !' }, done: true }) + '\n');
  });
  const r = await envoyerOllama([{ role: 'user', content: 'Salut' }], 'gemma3:4b', () => {}, undefined, {});
  assert.equal(r.content, 'Bonjour !');
  assert.ok(corps[0].tools.length);
  assert.equal(corps[1].tools, undefined);
  assert.equal(corps.length, 2);
});

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

test('vulkanUtile : seulement sous Windows avec une AMD sans NVIDIA, et jamais contre un réglage manuel', () => {
  const amd = { vendorId: 0x1002 };
  const nvidia = { vendorId: 0x10de };
  const intel = { vendorId: 0x8086 };
  assert.equal(vulkanUtile('win32', {}, [amd]), true);
  assert.equal(vulkanUtile('win32', {}, [intel, amd]), true);
  assert.equal(vulkanUtile('win32', {}, [amd, nvidia]), false);
  assert.equal(vulkanUtile('win32', {}, [intel]), false);
  assert.equal(vulkanUtile('win32', {}, []), false);
  assert.equal(vulkanUtile('linux', {}, [amd]), false);
  assert.equal(vulkanUtile('win32', { OLLAMA_VULKAN: '0' }, [amd]), false);
});

test('sansReflexion : aucun modèle Ollama ne réfléchit en silence avant de répondre', () => {
  for (const modele of ['qwen3:8b', 'qwen3.5:4b', 'deepseek-r1:8b', 'gpt-oss:20b', 'qwen2.5-coder:7b']) assert.equal(sansReflexion(modele), false, modele);
});

// Après un outil : réponse anglaise relancée avec la réflexion, sans rien en afficher
const { envoyerOllama, langueProbable } = require('../principal/envoi');

test('langueProbable : reconnaît un début en anglais ou en français, et ne tranche pas trop tôt', () => {
  assert.equal(langueProbable("Okay, let's take a look at the files. I've got a good overview of the project"), 'en');
  assert.equal(langueProbable('Je vois que ton projet est assez complet : il y a une interface et des tests pour'), 'fr');
  assert.equal(langueProbable('Okay, je vois le projet. Il a l air d être une application pour'), 'fr');
  assert.equal(langueProbable('**Cat Ai**'), null);
});

// Faux Ollama : chaque demande reçoit la réponse suivante de la liste, en morceaux JSON ligne par ligne
function fauxOllama(reponses) {
  const demandes = [];
  const vrai = global.fetch;
  global.fetch = async (_url, { body }) => {
    demandes.push(JSON.parse(body));
    const { morceaux = [], outil } = reponses[demandes.length - 1];
    const lignes = morceaux.map((t) => JSON.stringify({ message: { content: t } }) + '\n');
    if (outil) lignes.push(JSON.stringify({ message: { content: '', tool_calls: [{ function: { name: outil, arguments: {} } }] } }) + '\n');
    return { ok: true, status: 200, body: (async function* () { for (const l of lignes) yield Buffer.from(l); })() };
  };
  return { demandes, rendre: () => { global.fetch = vrai; } };
}
const APRES_OUTIL = [{ role: 'user', content: 'regarde les fichiers' }, { role: 'assistant', content: '', tool_calls: [] }, { role: 'tool', content: 'a.js\nb.js' }];

test('envoyerOllama : après un outil, un début en anglais n est pas affiché et l étape est relancée avec la réflexion', async () => {
  const anglais = ['Okay, ', "let's take a look at the files. ", 'I have a good overview of the project and ', 'here is what I see in the code for you: ', 'the main file is'];
  const f = fauxOllama([{ morceaux: anglais }, { morceaux: ['Voici ', 'ce que je vois dans ton projet.'] }]);
  const affiche = [];
  try {
    const r = await envoyerOllama(APRES_OUTIL, 'qwen3:8b', (t) => affiche.push(t), null, { projet: true });
    assert.equal(f.demandes.length, 2);
    assert.equal(f.demandes[0].think, false);
    assert.equal(f.demandes[1].think, true);
    assert.equal(affiche.join(''), 'Voici ce que je vois dans ton projet.');
    assert.equal(r.content, 'Voici ce que je vois dans ton projet.');
  } finally { f.rendre(); }
});

test('envoyerOllama : une réponse en français après un outil est affichée une seule fois, sans relance', async () => {
  const francais = ['Le projet ', 'est une app de chat ', 'avec un chat noir en pixel art qui vit sur ton bureau, ', 'et il y a des tests pour ', 'les outils et la mémoire. ', 'La suite.'];
  const f = fauxOllama([{ morceaux: francais }]);
  const affiche = [];
  try {
    const r = await envoyerOllama(APRES_OUTIL, 'qwen3:8b', (t) => affiche.push(t), null, { projet: true });
    assert.equal(f.demandes.length, 1);
    assert.equal(affiche.join(''), francais.join(''));
    assert.equal(r.content, francais.join(''));
  } finally { f.rendre(); }
});

test('envoyerOllama : un court texte avec un appel d outil, ou un message sans outil avant, ne sont jamais relancés', async () => {
  const f = fauxOllama([{ morceaux: ["Let's read it."], outil: 'lire_fichier' }, { morceaux: ['Okay, let me see what you have here, it is the file that you sent'] }]);
  const affiche = [];
  try {
    const r = await envoyerOllama(APRES_OUTIL, 'qwen3:8b', (t) => affiche.push(t), null, { projet: true });
    assert.equal(r.toolCalls[0].function.name, 'lire_fichier');
    await envoyerOllama([{ role: 'user', content: 'salut' }], 'qwen3:8b', (t) => affiche.push(t), null, {});
    assert.equal(f.demandes.length, 2);
    assert.equal(affiche.join(''), "Let's read it.Okay, let me see what you have here, it is the file that you sent");
  } finally { f.rendre(); }
});

test('langueProbable : le code et les citations en anglais ne font pas prendre une réponse française pour de l anglais', () => {
  assert.notEqual(langueProbable('```js\nfor (const f of fichiers) {\n  if (f.nom in index) this.ajouter(f);\n}\n```\nVoilà, c est corrigé.'), 'en');
  assert.notEqual(langueProbable('```python\nfor i in range(10):\n    if x is None and y'), 'en');
  assert.notEqual(langueProbable('Le fichier README.md dit : « This is a desktop assistant for you and your files, and it is free »'), 'en');
});

test('envoyerOllama : pas de vérification quand l utilisateur demande de l anglais, ni pour un modèle qui refuse la réflexion', async () => {
  const anglais = ['Here is your README translated: ', 'This is a desktop assistant for you and your files, ', 'it is free and it works with the models that you have'];
  const traduction = [{ role: 'user', content: 'lis le README et traduis-le en anglais' }, ...APRES_OUTIL.slice(1)];
  let f = fauxOllama([{ morceaux: anglais }]);
  try {
    await envoyerOllama(traduction, 'qwen3:8b', () => {}, null, { projet: true });
    assert.equal(f.demandes.length, 1);
  } finally { f.rendre(); }
  // Modèle sans réflexion : 400 sur think:true, la réponse anglaise est gardée, puis plus de vérification pour lui
  const vrai = global.fetch;
  const demandes = [];
  global.fetch = async (_url, { body }) => {
    const corps = JSON.parse(body);
    demandes.push(corps);
    if (corps.think === true) return new Response(JSON.stringify({ error: 'model does not support thinking' }), { status: 400 });
    return { ok: true, status: 200, body: (async function* () { yield Buffer.from(JSON.stringify({ message: { content: anglais.join('') } }) + '\n'); })() };
  };
  try {
    const affiche = [];
    await envoyerOllama(APRES_OUTIL, 'llama3.2:3b', (t) => affiche.push(t), null, { projet: true });
    assert.deepEqual(demandes.map((d) => d.think), [false, true, false]);
    assert.equal(affiche.join(''), anglais.join(''));
    await envoyerOllama(APRES_OUTIL, 'llama3.2:3b', () => {}, null, { projet: true });
    assert.equal(demandes.length, 4);
  } finally { global.fetch = vrai; }
});

test('Ollama : les rappels system après le début deviennent une note de l app, les consignes du début restent', () => {
  const messages = [
    { role: 'system', content: 'consignes' },
    { role: 'system', content: 'résumé' },
    { role: 'user', content: 'question' },
    { role: 'system', content: 'Rappel : MODE PROF.' },
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'lire_fichier', arguments: {} } }] },
    { role: 'tool', content: 'contenu' },
  ];
  const envoyes = rappelsPourOllama(messages);
  assert.deepEqual(envoyes.slice(0, 3), messages.slice(0, 3));
  assert.deepEqual(envoyes[3], { role: 'user', content: NOTE_APP + 'Rappel : MODE PROF.' });
  assert.deepEqual(envoyes.slice(4), messages.slice(4));
  assert.equal(messages[3].role, 'system');
  assert.deepEqual(rappelsPourOllama([{ role: 'system', content: 'seul' }]), [{ role: 'system', content: 'seul' }]);
});
