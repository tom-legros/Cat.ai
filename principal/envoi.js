// Envoi d'une discussion au modèle : Ollama (JSON ligne par ligne) ou un fournisseur compatible OpenAI (SSE).
// Les deux renvoient le même format, pour que la boucle d'outils de main.js ne voie pas la différence.
const { outilsPour } = require('./outils');
const { limitesTaille } = require('./taille');

const OLLAMA = 'http://127.0.0.1:11434';

// ---------- Discussion avec Ollama ----------
// Envoie la discussion à Ollama et lit la réponse en streaming (JSON ligne par ligne).
// onMorceau(texte) est appelé pour chaque morceau de texte reçu ; signal permet le bouton stop.
// options.prof / options.role : mode prof et rôle, qui décident si l'outil d'écriture est proposé au modèle.
// Renvoie { content, toolCalls } : le texte complet et les appels d'outils demandés.
async function envoyerOllama(messages, modele, onMorceau, signal, options = {}) {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    // think: false : qwen3 répond direct au lieu d'écrire une longue réflexion avant
    body: JSON.stringify({ model: modele, messages, tools: outilsPour(options), stream: true, think: modele.startsWith('qwen3') ? false : undefined, options: { num_ctx: 8192 } }),
    signal,
  });
  if (!res.ok) throw new Error(`Ollama a répondu ${res.status}`);
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const toolCalls = [];
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const data = JSON.parse(line);
      if (data.message?.content) {
        content += data.message.content;
        onMorceau(data.message.content);
      }
      if (data.message?.tool_calls) toolCalls.push(...data.message.tool_calls);
    }
  }
  return { content, toolCalls };
}

// ---------- Discussion avec un fournisseur compatible OpenAI (Gemini, Groq, OpenRouter…) ----------
// Même code pour tous : seule config.baseUrl change. config = { nom, baseUrl, cle }.
// Mêmes paramètres et même retour qu'envoyerOllama, pour que la boucle du handler 'chat' ne change pas.
// Gemini 3 réfléchit longtemps avant de répondre (plus de 2 min parfois, sans rien afficher) :
// on lui demande de réfléchir peu. Seulement pour Gemini, les autres fournisseurs n'en ont pas besoin.
const REFLEXION = { gemini: 'low' };

// Longueur maximale d'une réponse. Sans elle, OpenRouter réserve la longueur maximale du modèle
// (64 000 tokens) et refuse si le crédit de la clé ne couvre pas ce maximum.
const LONGUEUR_MAX = { openrouter: 4096 };

async function envoyerOpenAI(config, messages, modele, onMorceau, signal, options = {}) {
  const corps = { model: modele, messages: versOpenAI(messages), tools: outilsPour(options), stream: true };
  if (REFLEXION[config.id]) corps.reasoning_effort = REFLEXION[config.id];
  if (LONGUEUR_MAX[config.id]) corps.max_tokens = LONGUEUR_MAX[config.id];
  const limites = limitesTaille(config);
  if (limites?.reponse) corps.max_tokens = limites.reponse;
  const envoyer = (body) => fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.cle}`,
      'X-Title': 'Le chat noir', // OpenRouter affiche ce nom dans ses statistiques
    },
    body: JSON.stringify(body),
    signal,
  });
  let res;
  try {
    res = await envoyer(corps);
    // Un modèle qui ne connaît pas ce réglage répond 400 : on renvoie la même demande sans lui
    if (res.status === 400 && corps.reasoning_effort && /reasoning|thinking/i.test(await res.clone().text())) {
      delete corps.reasoning_effort;
      res = await envoyer(corps);
    }
    // Limite par minute atteinte (429) avec une attente courte : on patiente et on réessaie, deux fois au plus
    for (let essai = 0; essai < 2 && res.status === 429; essai++) {
      const secondes = await attenteDemandee(res);
      if (secondes === null || secondes > 60) break; // quota du jour épuisé ou attente trop longue : on affiche l'erreur
      options.onPause?.(Math.ceil(secondes));
      await attendre(secondes * 1000 + 500, signal);
      res = await envoyer(corps);
    }
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error(`Impossible de joindre ${config.nom} (${config.baseUrl}). Vérifie ta connexion internet et l'adresse du fournisseur.`);
  }
  if (!res.ok) {
    const erreur = new Error(await messageErreurOpenAI(config, res));
    // Le fournisseur dit que ce modèle n'existe plus (ou n'est pas utilisable) : le handler le retirera de la liste
    erreur.modeleCasse = estModeleCasse(res.status, erreur.message);
    throw erreur;
  }

  // Le flux arrive en SSE : des lignes "data: {...}" jusqu'à "data: [DONE]"
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const appels = []; // les appels d'outils arrivent en morceaux, rangés par index
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const ligne = line.trim();
      if (!ligne.startsWith('data:')) continue;
      const donnees = ligne.slice(5).trim();
      if (donnees === '[DONE]') return { content, toolCalls: finirAppels(appels) };
      let data;
      try {
        data = JSON.parse(donnees);
      } catch {
        continue; // ligne incomplète ou commentaire du serveur
      }
      if (data.error) throw new Error(`${config.nom} a renvoyé une erreur : ${data.error.message || JSON.stringify(data.error)}`);
      const delta = data.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        content += delta.content;
        onMorceau(delta.content);
      }
      for (const morceau of delta.tool_calls || []) {
        const appel = (appels[morceau.index ?? appels.length] ??= { id: '', name: '', arguments: '' });
        if (morceau.id) appel.id = morceau.id;
        if (morceau.function?.name) appel.name += morceau.function.name;
        if (morceau.function?.arguments) appel.arguments += morceau.function.arguments;
        // Gemini 3 joint à ses appels d'outils une « signature de réflexion » (extra_content.google.thought_signature).
        // Il faut la lui renvoyer telle quelle au tour suivant, sinon il répond 400. On garde tout extra_content.
        if (morceau.extra_content) appel.extra_content = { ...appel.extra_content, ...morceau.extra_content };
      }
    }
  }
  return { content, toolCalls: finirAppels(appels) };
}

// Combien de secondes le fournisseur demande d'attendre après un 429 : en-tête Retry-After,
// sinon le texte de l'erreur (« Please try again in 12.5s » chez Groq). null si rien n'est précisé.
async function attenteDemandee(res) {
  const entete = Number(res.headers.get('retry-after'));
  if (entete > 0) return entete;
  const texte = await res.clone().text().catch(() => '');
  const m = texte.match(/try again in\s+(?:(\d+)m)?\s*([\d.]+)\s*(ms|s)\b/i);
  if (!m) return null;
  return (Number(m[1]) || 0) * 60 + (m[3] === 'ms' ? Number(m[2]) / 1000 : Number(m[2]));
}

// Attente qui s'arrête tout de suite si l'utilisateur clique sur Stop
function attendre(ms, signal) {
  return new Promise((resolve, reject) => {
    const minuterie = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(minuterie); reject(Object.assign(new Error('Arrêté'), { name: 'AbortError' })); }, { once: true });
  });
}

// Appels d'outils OpenAI (arguments en texte JSON) → format Ollama utilisé par le reste du code (arguments en objet)
function finirAppels(appels) {
  return appels.filter(Boolean).map((a, i) => {
    let args = {};
    try {
      args = a.arguments ? JSON.parse(a.arguments) : {};
    } catch {}
    const appel = { id: a.id || `appel_${i}`, function: { name: a.name, arguments: args } };
    if (a.extra_content) appel.extra_content = a.extra_content;
    return appel;
  });
}

// Historique au format Ollama → format OpenAI : les arguments deviennent du texte JSON,
// et chaque résultat d'outil est relié à son appel par tool_call_id
function versOpenAI(messages) {
  const enAttente = [];
  return messages.map((m) => {
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const tool_calls = m.tool_calls.map((c, i) => {
        const id = c.id || `appel_${Date.now()}_${i}`;
        enAttente.push(id);
        const args = c.function.arguments;
        const appel = { id, type: 'function', function: { name: c.function.name, arguments: typeof args === 'string' ? args : JSON.stringify(args || {}) } };
        // Renvoyé seulement s'il existe (Gemini) : les autres fournisseurs pourraient refuser un champ inconnu
        if (c.extra_content) appel.extra_content = c.extra_content;
        return appel;
      });
      return { role: 'assistant', content: m.content || null, tool_calls };
    }
    if (m.role === 'tool') {
      // Résultat déjà relié : on retire son appel de la file ; sinon on prend le plus ancien appel sans réponse
      const position = m.tool_call_id ? enAttente.indexOf(m.tool_call_id) : 0;
      const [id] = position >= 0 ? enAttente.splice(position, 1) : [];
      return { role: 'tool', tool_call_id: m.tool_call_id || id || 'appel_inconnu', content: m.content };
    }
    return { role: m.role, content: m.content };
  });
}

// "Ce modèle n'existe plus" selon les fournisseurs : Gemini (404 « no longer available »),
// Groq (400 « decommissioned », 404 « does not exist »), OpenRouter (404 « No endpoints found », 400 « not a valid model »).
// Jamais pour un problème de clé ou de limite.
function estModeleCasse(status, message) {
  if (status !== 400 && status !== 404) return false;
  if (/refuse la clé/i.test(message)) return false;
  // "not found" seul ne suffit pas (une mauvaise adresse répond aussi 404 Not Found) : il faut que le message parle du modèle
  return /no longer available|decommission|deprecated|does not exist|no endpoints|not a valid model|is not enabled|requires terms acceptance|model[^.\n]*(not found|not supported|unsupported|not available)|(not found|not supported|unsupported)[^.\n]*model/i.test(message);
}

// Message clair en français selon le code d'erreur HTTP, avec le détail donné par le fournisseur
async function messageErreurOpenAI(config, res) {
  let detail = '';
  try {
    const texte = await res.text();
    try {
      const json = JSON.parse(texte);
      detail = (Array.isArray(json) ? json[0] : json)?.error?.message || texte;
    } catch {
      detail = texte;
    }
  } catch {}
  detail = detail.trim().slice(0, 300);
  const suite = detail ? `\nDétail : ${detail}` : '';
  // Gemini répond 400 (et pas 401) quand la clé est fausse : on le reconnaît à son message
  const cleInvalide = res.status === 400 && /api[ _-]?key|API_KEY_INVALID/i.test(detail);
  // OpenRouter répond 403 « Key limit exceeded » quand la limite de crédit fixée sur la clé est atteinte :
  // la clé marche, c'est son budget qui est épuisé
  if (res.status === 403 && /limit exceeded|credit|insufficient/i.test(detail)) return `${config.nom} : la limite de crédit de cette clé est atteinte (${res.status}). La clé marche, mais son budget est épuisé : augmente la limite sur le site de ${config.nom}, ou choisis un modèle gratuit (« :free »).${suite}`;
  if (res.status === 402) return `${config.nom} : plus assez de crédit sur ton compte (402). Ajoute du crédit, ou choisis un modèle gratuit (« :free »).${suite}`;
  if (res.status === 401 || res.status === 403 || cleInvalide) return `${config.nom} refuse la clé API (${res.status}). Vérifie la clé dans le panneau Fournisseurs.${suite}`;
  if (res.status === 429) return `Limite atteinte chez ${config.nom} (429) : trop de messages d'un coup ou quota gratuit épuisé. Attends un peu, ou change de modèle.${suite}`;
  if (res.status === 404) return `${config.nom} ne trouve pas ce modèle ou cette adresse (404). Vérifie le modèle choisi.${suite}`;
  if (res.status >= 500) return `${config.nom} a un problème de son côté (${res.status}). Ce n'est pas toi : réessaie dans quelques minutes.${suite}`;
  return `${config.nom} a répondu ${res.status}.${suite}`;
}

// Vulkan pour Ollama : utile sous Windows avec une carte AMD (une RX 6600 par exemple), que Ollama ne sait pas
// toujours utiliser autrement. Avec une NVIDIA, CUDA est plus rapide : on laisse Ollama choisir. Une carte
// Intel seule n'y gagne rien. Une valeur OLLAMA_VULKAN réglée à la main est toujours respectée.
const AMD = 0x1002;
const NVIDIA = 0x10de;

function vulkanUtile(plateforme, env, cartes = []) {
  if (plateforme !== 'win32' || 'OLLAMA_VULKAN' in env) return false;
  const vendeurs = cartes.map((c) => c.vendorId);
  return vendeurs.includes(AMD) && !vendeurs.includes(NVIDIA);
}

module.exports = { OLLAMA, REFLEXION, vulkanUtile, envoyerOllama, envoyerOpenAI, versOpenAI, finirAppels, attenteDemandee, estModeleCasse, messageErreurOpenAI };
