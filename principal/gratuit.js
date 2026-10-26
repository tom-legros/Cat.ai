// Règle « 100 % gratuit » : quelles adresses et quels modèles sont autorisés.
// Que des fonctions pures : c'est le garde-fou le plus important de l'app, il doit être facile à tester.

// Modèles qui ne savent pas discuter (embeddings, voix, images, vidéo, modération…) : jamais proposés
const NE_DISCUTE_PAS = /embed|tts|whisper|transcri|speech|audio|realtime|live|imagen|image|veo|lyria|aqa|guard|moderation|robotics|computer-use|orpheus|playai|allam/i;

// Seuls les modèles gratuits sont autorisés : rien ne doit jamais être facturé.
// On regarde l'adresse du fournisseur, pas son identifiant : le Personnalisé peut pointer vers OpenRouter ou Gemini.
function hote(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

// Liste blanche : tout ce qui n'est pas dedans est refusé, même si on ne sait pas que c'est payant.
// - Ollama et les serveurs sur ton PC (LM Studio…) : gratuits.
// - Groq : tout est dans l'offre gratuite.
// - OpenRouter : seulement les « :free », les autres sont facturés sur le crédit du compte.
// - Gemini : seulement les « flash » (sans « image »), les seuls de l'offre gratuite.
// - Toute autre adresse (OpenAI, Anthropic, Mistral…) : refusée, ces services sont payants.
const HOTES_LOCAUX = ['localhost', '127.0.0.1', '[::1]'];

function fournisseurGratuit(baseUrl) {
  const h = hote(baseUrl);
  return HOTES_LOCAUX.includes(h) || h === 'api.groq.com' || h === 'openrouter.ai' || h === 'generativelanguage.googleapis.com';
}

function modeleGratuit(config, modele) {
  if (!config) return false;
  if (config.type === 'ollama') return true;
  if (!fournisseurGratuit(config.baseUrl)) return false;
  const h = hote(config.baseUrl);
  if (h === 'openrouter.ai') return /:free$/.test(modele);
  if (h === 'generativelanguage.googleapis.com') return /flash/i.test(modele) && !/image/i.test(modele);
  return true;
}

function conseilGratuit(config) {
  const h = hote(config.baseUrl);
  if (!fournisseurGratuit(config.baseUrl)) return 'Cette adresse n\'est pas un fournisseur gratuit : utilise Ollama, Gemini, Groq, OpenRouter, ou un serveur sur ton PC.';
  if (h === 'generativelanguage.googleapis.com') return 'Choisis un modèle « flash » : les autres ne sont pas dans l\'offre gratuite.';
  return 'Choisis un modèle qui finit par « :free », ils sont gratuits.';
}

// Ce que le fournisseur dit lui-même du modèle : Groq indique les modèles désactivés,
// OpenRouter indique s'il gère les outils (indispensables pour lire et écrire les fichiers)
function peutDiscuter(m) {
  if (m.active === false) return false;
  if (Array.isArray(m.supported_parameters) && !m.supported_parameters.includes('tools')) return false;
  const sortie = m.architecture?.output_modalities;
  if (Array.isArray(sortie) && !sortie.includes('text')) return false;
  return true;
}

// Seules les adresses https sont acceptées (http seulement en local, pour un serveur sur ton PC)
function adresseValide(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || (u.protocol === 'http:' && HOTES_LOCAUX.includes(u.hostname));
  } catch {
    return false;
  }
}

module.exports = { NE_DISCUTE_PAS, hote, HOTES_LOCAUX, fournisseurGratuit, modeleGratuit, conseilGratuit, peutDiscuter, adresseValide };
