// Quel modèle Qwen conseiller avec Ollama : ça dépend surtout de la mémoire de la carte graphique.
// Un modèle trop gros pour elle déborde dans la RAM et devient très lent (1 à 3 mots par seconde).
//
// La mémoire vidéo se lit dans le registre sous Windows (Windows affiche 4 Go au plus ailleurs, à tort),
// dans /sys pour AMD et Intel sous Linux, et avec nvidia-smi pour NVIDIA. Sans réponse, on suppose « pas de carte ».
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

// Du plus gros au plus petit. vram : mémoire vidéo nécessaire (le modèle, plus la place pour la discussion).
// Les poids sont ceux du téléchargement sur ollama.com (novembre 2026).
const MODELES_QWEN = [
  { modele: 'qwen3.6:27b', taille: 18, tailleMax: 19, vram: 22, raison: 'code avec outils et raisonnement' },
  { modele: 'qwen3:14b', taille: 9.3, vram: 12, raison: 'très bon partout, sans être trop lent' },
  { modele: 'qwen3.5:9b', taille: 6.6, vram: 10, raison: 'récent et bon en code' },
  { modele: 'qwen3:8b', taille: 5.2, vram: 7, raison: 'le meilleur qui tient dans 8 Go' },
  { modele: 'qwen3.5:4b', taille: 3.3, tailleMax: 4, vram: 5, raison: 'léger, pour les petites cartes graphiques' },
  { modele: 'qwen3.5:2b', taille: 2.7, tailleMax: 3.1, vram: 0, raison: 'petit modèle utilisable sans carte graphique' },
];

// Les autres modèles les plus utiles d'Ollama, proposés dans la page Modèles (jamais conseillés d'office : le chat
// est réglé pour Qwen). Tous savent se servir des outils du chat. Tailles lues sur ollama.com (novembre 2026).
// usage : ce pour quoi on le prend, affiché en filtre.
const AUTRES_MODELES = [
  { modele: 'qwen3:0.6b', taille: 0.523, vram: 2, usage: 'general', raison: 'texte simple avec très peu de mémoire' },
  { modele: 'qwen3.6:35b', taille: 23, vram: 28, usage: 'code', raison: 'code et outils sur une grosse carte' },
  { modele: 'qwen3.5:0.8b', taille: 1.2, tailleMax: 1.3, vram: 3, usage: 'general', raison: 'petites tâches de texte et d’image' },
  { modele: 'qwen3:4b', taille: 2.5, vram: 4, usage: 'general', raison: 'discussion et texte léger' },
  { modele: 'gpt-oss:20b', taille: 14, vram: 16, usage: 'reflexion', raison: "le modèle ouvert d'OpenAI" },
  { modele: 'gemma4:12b', taille: 8, vram: 11, usage: 'images', raison: 'Google, voit les images' },
  { modele: 'mistral-nemo:12b', taille: 7.1, vram: 10, usage: 'general', raison: 'Mistral, très bon en français' },
  { modele: 'gemma4:e4b', taille: 6.6, vram: 9, usage: 'images', raison: 'Google, voit les images' },
  { modele: 'deepseek-r1:8b', taille: 5.2, vram: 7, usage: 'reflexion', raison: 'réfléchit avant de répondre' },
  { modele: 'llama3.1:8b', taille: 4.9, vram: 7, usage: 'general', raison: 'Meta, le plus téléchargé' },
  { modele: 'qwen2.5-coder:7b', taille: 4.7, vram: 7, usage: 'code', raison: 'spécialisé en code' },
  { modele: 'gemma4:e2b', taille: 4.6, tailleMax: 7.5, vram: 8, usage: 'images', raison: 'Google, léger, voit les images' },
  { modele: 'llama3.2:3b', taille: 2, vram: 4, usage: 'general', raison: 'petit et rapide' },
];
// Ce pour quoi on prend chaque Qwen
const USAGE_QWEN = { 'qwen3.6:27b': 'code', 'qwen3:14b': 'general', 'qwen3.5:9b': 'code', 'qwen3:8b': 'general', 'qwen3.5:4b': 'general', 'qwen3.5:2b': 'general' };

// Le plus gros modèle qui tient dans la carte. Sans carte (ou petite), avec peu de RAM, Gemini est conseillé à côté.
function modeleConseille({ vramGo, ramGo }) {
  const choix = MODELES_QWEN.find((m) => (vramGo || 0) >= m.vram);
  return { ...choix, vramGo: vramGo || 0, geminiMieux: (vramGo || 0) < 5 && (ramGo || 0) < 16 };
}

// Avis sur un modèle pour ce PC, affiché dans la page Modèles :
//   'ok'    il tient dans la carte graphique : rapide
//   'lent'  il déborde dans la RAM : il marche, mais lentement (la RAM sert aussi à Windows, d'où les 60 %)
//   'trop'  il ne tient pas du tout
function avisModele(m, { vramGo, ramGo }) {
  if ((vramGo || 0) >= m.vram) return 'ok';
  return m.vram <= (vramGo || 0) + (ramGo || 0) * 0.6 ? 'lent' : 'trop';
}

// Tous les modèles connus, avec leur avis ; le conseillé est le plus gros Qwen qui tient dans la carte
function catalogue(materiel) {
  const conseille = modeleConseille(materiel).modele;
  return [...MODELES_QWEN.map((m) => ({ ...m, usage: USAGE_QWEN[m.modele] || 'general' })), ...AUTRES_MODELES]
    .map((m) => ({ ...m, avis: avisModele(m, materiel), conseille: m.modele === conseille }));
}

// HardwareInformation.qwMemorySize : un nombre sur 8 octets, que reg.exe affiche en hexadécimal
function vramDepuisRegistre(sortie) {
  const valeurs = [...String(sortie).matchAll(/HardwareInformation\.qwMemorySize\s+REG_QWORD\s+0x([0-9a-f]+)/gi)].map((m) => parseInt(m[1], 16));
  return valeurs.length ? Math.round(Math.max(...valeurs) / 1024 ** 3) : null;
}

const lancer = (commande, args) => new Promise((ok) => {
  execFile(commande, args, { timeout: 5000, windowsHide: true }, (err, sortie) => ok(err ? '' : String(sortie)));
});

// Mémoire vidéo de la plus grosse carte, en Go, ou null si on ne sait pas
async function memoireVideo() {
  if (process.platform === 'win32') {
    return vramDepuisRegistre(await lancer('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}', '/s', '/v', 'HardwareInformation.qwMemorySize']));
  }
  if (process.platform === 'linux') {
    const nvidia = (await lancer('nvidia-smi', ['--query-gpu=memory.total', '--format=csv,noheader,nounits'])).split('\n').map(Number).filter((n) => n > 0);
    if (nvidia.length) return Math.round(Math.max(...nvidia) / 1024);
    try {
      const cartes = fs.readdirSync('/sys/class/drm').filter((c) => /^card\d+$/.test(c));
      const tailles = cartes.map((c) => { try { return Number(fs.readFileSync(`/sys/class/drm/${c}/device/mem_info_vram_total`, 'utf8')); } catch { return 0; } });
      const plus = Math.max(0, ...tailles);
      return plus ? Math.round(plus / 1024 ** 3) : null;
    } catch {
      return null;
    }
  }
  return null;
}

const ramGo = () => Math.round(os.totalmem() / 1024 ** 3);

async function conseilMateriel() {
  return modeleConseille({ vramGo: await memoireVideo(), ramGo: ramGo() });
}

// Place libre sur le disque du dossier donné, en Go, ou null si on ne sait pas
function disqueLibre(dossier) {
  try {
    const s = fs.statfsSync(dossier);
    return Math.round((s.bavail * s.bsize) / 1024 ** 3);
  } catch {
    return null;
  }
}

// Pour la page Modèles : le PC, et chaque modèle avec son avis
async function catalogueMateriel() {
  const materiel = { vramGo: await memoireVideo(), ramGo: ramGo(), disqueGo: disqueLibre(os.homedir()) };
  return { ...materiel, modeles: catalogue(materiel) };
}

module.exports = { MODELES_QWEN, AUTRES_MODELES, modeleConseille, avisModele, catalogue, vramDepuisRegistre, conseilMateriel, catalogueMateriel };
