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
  { modele: 'qwen3.6:27b', taille: 17.8, vram: 22, raison: 'le plus fort, excellent en code et en raisonnement' },
  { modele: 'qwen3:14b', taille: 9.3, vram: 12, raison: 'très bon partout, sans être trop lent' },
  { modele: 'qwen3.5:9b', taille: 6.6, vram: 10, raison: 'récent et bon en code' },
  { modele: 'qwen3:8b', taille: 5.2, vram: 7, raison: 'le meilleur qui tient dans 8 Go' },
  { modele: 'qwen3.5:4b', taille: 3.3, vram: 5, raison: 'léger, pour les petites cartes graphiques' },
  { modele: 'qwen3.5:2b', taille: 2.7, vram: 0, raison: 'le plus léger, il tourne même sans carte graphique mais reste limité' },
];

// Le plus gros modèle qui tient dans la carte. Sans carte (ou petite), avec peu de RAM, Gemini est conseillé à côté.
function modeleConseille({ vramGo, ramGo }) {
  const choix = MODELES_QWEN.find((m) => (vramGo || 0) >= m.vram);
  return { ...choix, vramGo: vramGo || 0, geminiMieux: (vramGo || 0) < 5 && (ramGo || 0) < 16 };
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

async function conseilMateriel() {
  return modeleConseille({ vramGo: await memoireVideo(), ramGo: Math.round(os.totalmem() / 1024 ** 3) });
}

module.exports = { MODELES_QWEN, modeleConseille, vramDepuisRegistre, conseilMateriel };
