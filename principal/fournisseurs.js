// Fournisseurs d'IA et clés API. Les clés sont chiffrées avec safeStorage et ne sortent jamais du processus
// principal : ce qui part vers l'interface passe par versInterface(), sans les clés.
const { safeStorage } = require('electron');
const { readJson, writeJson } = require('./stockage');
const { OLLAMA, messageErreurOpenAI } = require('./envoi');
const { NE_DISCUTE_PAS, fournisseurGratuit, modeleGratuit, conseilGratuit, peutDiscuter } = require('./gratuit');

// Modèles qui ont répondu "n'existe plus" : cachés pendant 30 jours, puis on leur redonne une chance
const DUREE_CASSE = 30 * 24 * 60 * 60 * 1000;

function modelesCasses(fournisseurId) {
  const liste = readJson('fournisseurs.json', {}).modelesCasses?.[fournisseurId] || {};
  return Object.entries(liste).filter(([, date]) => Date.now() - date < DUREE_CASSE).map(([id]) => id);
}

function marquerModeleCasse(fournisseurId, modele) {
  const reglages = readJson('fournisseurs.json', {});
  reglages.modelesCasses ??= {};
  reglages.modelesCasses[fournisseurId] ??= {};
  reglages.modelesCasses[fournisseurId][modele] = Date.now();
  // Si c'était le modèle retenu pour ce fournisseur, on l'oublie
  if (reglages.modeles?.[fournisseurId] === modele) delete reglages.modeles[fournisseurId];
  writeJson('fournisseurs.json', reglages);
}
// Ollama : GET /api/tags ; compatible OpenAI : GET {baseUrl}/models.
// Renvoie toujours { ok, models, erreur? } : la liste est rafraîchie toutes les 10 s, on ne lève jamais d'erreur.
async function listerModeles(config) {
  if (!config || config.type === 'ollama') {
    try {
      const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      return { ok: true, models: data.models.map((m) => m.name) };
    } catch {
      return { ok: false, models: [], erreur: 'Ollama ne répond pas.' };
    }
  }
  if (!config.baseUrl) return { ok: false, models: [], erreur: `Aucune adresse pour ${config.nom}.` };
  // Une adresse payante enregistrée avant cette règle : on ne la contacte même pas
  if (!fournisseurGratuit(config.baseUrl)) return { ok: false, models: [], erreur: conseilGratuit(config) };
  if (!config.cle) return { ok: false, models: [], erreur: `Aucune clé API pour ${config.nom}.` };
  try {
    const res = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/models`, {
      headers: { Authorization: `Bearer ${config.cle}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, models: [], erreur: await messageErreurOpenAI(config, res) };
    const data = await res.json();
    const casses = modelesCasses(config.id);
    // Gemini préfixe ses modèles par "models/", mais attend le nom sans le préfixe dans /chat/completions
    const models = (data.data || data.models || [])
      .filter(peutDiscuter)
      .map((m) => String(m.id || m.name || '').replace(/^models\//, ''))
      .filter((id) => id && !NE_DISCUTE_PAS.test(id) && !casses.includes(id))
      // Chez Gemini, seuls les modèles gemini-… gèrent les outils (gemma, antigravity… non)
      .filter((id) => config.id !== 'gemini' || id.startsWith('gemini-'))
      // Seulement les modèles gratuits : rien ne peut être facturé
      .filter((id) => modeleGratuit(config, id))
      .sort((a, b) => a.localeCompare(b));
    return { ok: true, models };
  } catch (err) {
    return { ok: false, models: [], erreur: err.name === 'TimeoutError' ? `${config.nom} met trop de temps à répondre.` : `Impossible de joindre ${config.nom}.` };
  }
}

// ---------- Fournisseurs et clés API ----------
// Tout est dans fournisseurs.json, dans le dossier userData (jamais dans le projet ni dans Git).
// Les clés y sont chiffrées avec safeStorage (DPAPI sur Windows : seul ton compte Windows peut les lire).
// Elles ne sortent jamais de main.js : l'interface sait seulement si une clé est enregistrée ou non.
const FOURNISSEURS_DE_BASE = [
  { id: 'ollama', type: 'ollama', nom: 'Ollama (local)' },
  { id: 'gemini', type: 'openai', nom: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { id: 'groq', type: 'openai', nom: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'openrouter', type: 'openai', nom: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'perso', type: 'openai', nom: 'Personnalisé', baseUrl: '', modifiable: true },
];

function lireReglagesFournisseurs() {
  const r = readJson('fournisseurs.json', {});
  // ...r garde aussi modelesCasses quand le fichier est réécrit
  return { ...r, actif: r.actif || 'ollama', modeles: r.modeles || {}, fournisseurs: r.fournisseurs || {} };
}

// Fusionne la liste de base avec ce que l’utilisateur a enregistré (clé chiffrée, URL et nom du personnalisé)
function tousLesFournisseurs() {
  const { fournisseurs } = lireReglagesFournisseurs();
  return FOURNISSEURS_DE_BASE.map((base) => {
    const perso = fournisseurs[base.id] || {};
    return {
      ...base,
      nom: base.modifiable && perso.nom ? perso.nom : base.nom,
      baseUrl: base.modifiable ? perso.baseUrl || '' : base.baseUrl,
      cleChiffree: perso.cleChiffree || null,
    };
  });
}

// Début habituel des clés de chaque fournisseur, pour repérer une clé collée dans la mauvaise carte.
// On ne vérifie que ce début, et l'interface ne reçoit qu'un vrai / faux.
// Pas de règle pour Gemini : Google a plusieurs formats de clés, une vraie clé était signalée à tort.
const DEBUT_DES_CLES = {
  groq: { debut: 'gsk_', exemple: 'gsk_…' },
  openrouter: { debut: 'sk-or-', exemple: 'sk-or-v1-…' },
};

function formatDouteux(id, cle) {
  const attendu = DEBUT_DES_CLES[id];
  return !!(attendu && cle && !cle.startsWith(attendu.debut));
}

function avertissementFormat(id, nom) {
  return `Cette clé ne ressemble pas à une clé ${nom} (elles commencent par ${DEBUT_DES_CLES[id].exemple}). Elle est enregistrée quand même : vérifie que tu ne l'as pas collée dans la mauvaise carte.`;
}

function dechiffrer(cleChiffree) {
  if (!cleChiffree) return '';
  try {
    return safeStorage.decryptString(Buffer.from(cleChiffree, 'base64'));
  } catch {
    return ''; // clé chiffrée par un autre compte ou un autre PC : illisible ici
  }
}

// Config complète d'un fournisseur à partir de son identifiant, clé déchiffrée comprise.
// À n'utiliser que dans main.js : ce qui part vers l'interface passe par versInterface().
function configFournisseur(id = 'ollama') {
  const f = tousLesFournisseurs().find((x) => x.id === id);
  if (!f) return null;
  if (f.type === 'ollama') return { id: f.id, type: 'ollama', nom: f.nom };
  return { id: f.id, type: 'openai', nom: f.nom, baseUrl: f.baseUrl, cle: dechiffrer(f.cleChiffree) };
}

// Ce que l'interface a le droit de voir : tout sauf la clé
function versInterface() {
  const { actif, modeles } = lireReglagesFournisseurs();
  return {
    actif,
    modeles,
    chiffrementDispo: safeStorage.isEncryptionAvailable(),
    fournisseurs: tousLesFournisseurs().map(({ cleChiffree, ...f }) => {
      const cle = dechiffrer(cleChiffree);
      const douteux = formatDouteux(f.id, cle);
      return { ...f, aCle: f.type === 'ollama' || !!cle, formatDouteux: douteux, avertissement: douteux ? avertissementFormat(f.id, f.nom) : null };
    }),
  };
}

module.exports = {
  FOURNISSEURS_DE_BASE, lireReglagesFournisseurs, configFournisseur, versInterface,
  formatDouteux, avertissementFormat, modelesCasses, marquerModeleCasse, listerModeles,
};
