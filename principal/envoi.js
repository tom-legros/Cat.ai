// Envoi d'une discussion au modèle : Ollama (JSON ligne par ligne) ou un fournisseur compatible OpenAI (SSE).
// Les deux renvoient le même format, pour que la boucle d'outils de main.js ne voie pas la différence.
const { outilsPour } = require('./outils');
const { limitesTaille } = require('./taille');

const OLLAMA = 'http://127.0.0.1:11434';

// Réglages envoyés à Ollama à chaque demande, identiques partout : un autre num_ctx ferait recharger le modèle.
// - keep_alive : le modèle reste chargé 30 min (5 par défaut), sinon chaque reprise coûte ~20 s de chargement ;
// - pour Qwen 3 qui répond sans phase de réflexion (think: false), les réglages conseillés par l'équipe Qwen :
//   temperature 0.7, top_p 0.8, top_k 20 (ceux d'Ollama par défaut sont prévus pour le mode réflexion).
const GARDER_CHARGE = '30m';
const optionsOllama = (modele) => ({ num_ctx: 8192, ...(String(modele).startsWith('qwen3') ? { temperature: 0.7, top_p: 0.8, top_k: 20 } : {}) });
// Pas de phase de réflexion, pour tous les modèles : sans ce réglage, un modèle qui sait réfléchir (qwen3, deepseek-r1,
// gpt-oss…) écrit d'abord des centaines de mots invisibles dans Cat Ai (plus de 4 fois plus de texte mesuré avec
// qwen3:8b), et on attend devant « Miaou réfléchit ». Ollama accepte ce réglage aussi pour les modèles qui ne réfléchissent pas.
const sansReflexion = () => false;

// Langue d'un début de réponse, d'après ses petits mots les plus courants : 'fr', 'en', ou null si on ne sait pas encore
const MOTS_FR = new Set(['le', 'la', 'les', 'des', 'est', 'et', 'pour', 'dans', 'un', 'une', 'du', 'tu', 'ton', 'ta', 'tes', 'qui', 'sont', 'avec', 'je', 'que', 'pas', 'sur', 'voici', 'ce', 'il']);
const MOTS_EN = new Set(['the', 'is', 'and', 'for', 'in', 'of', 'you', 'your', 'are', 'with', 'this', 'that', 'let', "let's", "i've", "i'll", 'okay', 'here', 'it', 'to', 'i', "it's", 'has', 'have', 'now', 'see', 'look']);
// On ne compte que la phrase elle-même : le code (for, in, of, this…) et les citations (un README en anglais)
// faisaient prendre une réponse française pour de l'anglais. Un bloc de code pas encore fermé compte aussi comme du code.
const sansCodeNiCitation = (texte) => String(texte)
  .replace(/```[\s\S]*?(```|$)/g, ' ')
  .replace(/`[^`\n]*`?/g, ' ')
  .replace(/«[^»]*(»|$)/g, ' ')
  .replace(/"[^"\n]*("|$)/g, ' ')
  .replace(/^\s*\|.*$/gm, ' ');
function langueProbable(texte) {
  const mots = sansCodeNiCitation(texte).toLowerCase().replace(/’/g, "'").match(/[a-zàâçéèêëîïôûùüÿœ']+/g) || [];
  const fr = mots.filter((m) => MOTS_FR.has(m)).length;
  const en = mots.filter((m) => MOTS_EN.has(m)).length;
  if (en >= 3 && en > fr * 2) return 'en';
  if (fr >= 3 && fr >= en) return 'fr';
  return null;
}

// Juste après le résultat d'un outil, qwen3 sans réflexion (think: false) se met souvent à « penser tout haut » en
// anglais dans sa réponse (« Okay, let me look at… ») : mesuré 12 fois sur 12 après lister_fichiers, et aucun rappel
// ni consigne ne l'en empêche. Avec la réflexion, il répond en français, mais 3 à 6 fois plus lentement.
// Donc : après un outil, le début de la réponse est gardé de côté (DEBUT_A_VERIFIER caractères). S'il est en anglais,
// on l'arrête et on relance la même étape avec la réflexion ; sinon il est affiché d'un coup et la suite arrive
// normalement. Le temps de la réflexion n'est payé que quand le modèle dérive.
const DEBUT_A_VERIFIER = 120;
// Modèles qui ont refusé la réflexion (erreur 400) : on ne vérifie plus leur langue, la relance ne servirait à rien
const sansReflexionPossible = new Set();
// L'utilisateur veut une réponse en anglais (traduction, message de commit…) : rien à corriger
const ANGLAIS_DEMANDE = /\b(anglais|english|tradui|translat)/i;
const verifierLangue = (messages, modele) => !sansReflexionPossible.has(modele)
  && !ANGLAIS_DEMANDE.test(messages.findLast((m) => m.role === 'user')?.content || '');

// ---------- Discussion avec Ollama ----------
// Envoie la discussion à Ollama et lit la réponse en streaming (JSON ligne par ligne).
// onMorceau(texte) est appelé pour chaque morceau de texte reçu ; signal permet le bouton stop.
// options.prof : le mode prof, qui décide si l'outil d'écriture est proposé au modèle.
// Renvoie { content, toolCalls } : le texte complet et les appels d'outils demandés.
// Le modèle de discussion de qwen3 dans Ollama n'a pas de place pour un message system au milieu : Ollama les
// rassemble tous dans le bloc system du haut, avant les outils. Les rappels de l'app (mode prof, recherche, actions
// déjà faites) étaient donc loin de la question, et comme ils changent à chaque message, Ollama relisait tout depuis
// le début (mesuré sur 5 messages : 3,5 puis 4,4, 5,3 et 6,3 s de relecture, contre 1,3 à 1,5 s en note).
// Les messages system du début (consignes, résumé) restent ; ceux d'après deviennent une note dans le tour de
// l'utilisateur, juste avant la réponse, et seule la fin est relue.
const NOTE_APP = "(Note de l'app, pas un message de l'utilisateur) ";
function rappelsPourOllama(messages) {
  const debut = messages.findIndex((m) => m.role !== 'system');
  if (debut < 0) return messages;
  return messages.map((m, i) => (i > debut && m.role === 'system' ? { role: 'user', content: NOTE_APP + m.content } : m));
}

async function envoyerOllama(messages, modele, onMorceau, signal, options = {}) {
  if (messages.at(-1)?.role !== 'tool' || !verifierLangue(messages, modele)) return lireOllama(messages, modele, onMorceau, signal, options, sansReflexion(modele), false);
  const premier = await lireOllama(messages, modele, onMorceau, signal, options, sansReflexion(modele), true);
  if (!premier.anglais) return premier;
  try {
    // Même étape, avec la réflexion : la réponse arrive en français
    return await lireOllama(messages, modele, onMorceau, signal, options, true, false);
  } catch (err) {
    // Un modèle qui ne sait pas réfléchir refuse (400) : on garde la réponse sans réflexion, en anglais plutôt que rien,
    // et on ne vérifiera plus sa langue (sinon trois demandes à chaque étape, pour rien)
    if (signal?.aborted || !/répondu 400/.test(err.message)) throw err;
    sansReflexionPossible.add(modele);
    return lireOllama(messages, modele, onMorceau, signal, options, sansReflexion(modele), false);
  }
}

// Une demande à Ollama. Avec verifier, le début est gardé de côté et sa langue vérifiée : en anglais, la lecture
// s'arrête (sortir de la boucle ferme la connexion, et Ollama arrête d'écrire) et le résultat est { anglais: true },
// sans rien avoir affiché.
async function lireOllama(messages, modele, onMorceau, signal, options, reflexion, verifier) {
  const corps = { model: modele, messages: rappelsPourOllama(messages), tools: outilsPour(options), stream: true, think: reflexion, keep_alive: GARDER_CHARGE, options: optionsOllama(modele) };
  const envoyer = () => fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    // think: false : qwen3 répond direct au lieu d'écrire une longue réflexion avant
    body: JSON.stringify(corps),
    signal,
  });
  let res = await envoyer();
  // Les modèles de discussion seuls restent utilisables. Le premier appel a été refusé,
  // aucune génération ni aucun outil n'a eu lieu. Ne jamais réessayer une autre erreur.
  if (res.status === 400 && /does not support tools/i.test(await res.clone().text())) {
    delete corps.tools;
    res = await envoyer();
  }
  if (!res.ok) throw new Error(`Ollama a répondu ${res.status}`);
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let enAttente = verifier;
  const toolCalls = [];
  const ANGLAIS = { anglais: true, content: '', toolCalls: [] };
  // Le début gardé de côté : en anglais on arrête, sinon il est affiché d'un coup
  const debutAnglais = () => {
    enAttente = false;
    if (langueProbable(content) === 'en') return true;
    if (content) onMorceau(content);
    return false;
  };
  try {
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const data = JSON.parse(line);
        if (data.message?.content) {
          content += data.message.content;
          if (!enAttente) onMorceau(data.message.content);
          else if (content.length >= DEBUT_A_VERIFIER && debutAnglais()) return ANGLAIS;
        }
        if (data.message?.tool_calls) toolCalls.push(...data.message.tool_calls);
      }
    }
  } catch (err) {
    // Stop pendant que le début attendait : on montre ce qui était déjà arrivé, comme sans la vérification
    if (enAttente && content && langueProbable(content) !== 'en') onMorceau(content);
    throw err;
  }
  // Réponse finie avant DEBUT_A_VERIFIER caractères : vérifiée maintenant (pas avec un appel d'outil, qui n'est pas affiché)
  if (enAttente) {
    if (!toolCalls.length && debutAnglais()) return ANGLAIS;
    if (toolCalls.length && content) onMorceau(content);
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
      'X-Title': 'Cat Ai', // OpenRouter affiche ce nom dans ses statistiques
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
    // Le modèle a appelé un outil qui n'existe pas, ou mal écrit son appel : Groq refuse toute la réponse (400).
    // Rien n'a été fait. On redemande, deux fois au plus, en rappelant les seuls outils qui existent.
    for (let essai = 0; essai < 2 && res.status === 400 && appelOutilRefuse(await res.clone().text()); essai++) {
      const noms = (corps.tools || []).map((o) => o.function.name).join(', ');
      const rappel = noms ? `Ton dernier appel d'outil a été refusé : cet outil n'existe pas ou ses arguments étaient mal écrits. Les seuls outils qui existent : ${noms}. Recommence avec l'un d'eux, ou réponds sans outil.` : "Aucun outil n'est disponible ici : réponds directement, sans appeler d'outil.";
      res = await envoyer({ ...corps, messages: [...corps.messages, { role: 'user', content: `${NOTE_APP}${rappel}` }] });
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
    if (m.images?.length) {
      return { role: m.role, content: [{ type: 'text', text: m.content || '' }, ...m.images.map((b64) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } }))] };
    }
    return { role: m.role, content: m.content };
  });
}

// "Ce modèle n'existe plus" selon les fournisseurs : Gemini (404 « no longer available »),
// Groq (400 « decommissioned », 404 « does not exist »), OpenRouter (404 « No endpoints found », 400 « not a valid model »).
// Jamais pour un problème de clé ou de limite.
// Le fournisseur a refusé la réponse du modèle parce que son appel d'outil ne tient pas debout (outil inventé,
// arguments illisibles). Ce n'est pas une panne : redemander suffit le plus souvent.
function appelOutilRefuse(texte) {
  return /tool call validation failed|tool_use_failed|failed to call a function|not in request\.tools/i.test(String(texte));
}

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

module.exports = { appelOutilRefuse, OLLAMA, GARDER_CHARGE, optionsOllama, sansReflexion, rappelsPourOllama, NOTE_APP, langueProbable, DEBUT_A_VERIFIER, REFLEXION, vulkanUtile, envoyerOllama, envoyerOpenAI, versOpenAI, finirAppels, attenteDemandee, estModeleCasse, messageErreurOpenAI };
