// Démarrer Ollama quand il ne tourne pas : l'app le fait à son ouverture (main.js), catai aussi, pour marcher même
// app fermée. Sous Windows, Ollama est cherché là où son installateur le met ; ailleurs, « ollama » dans le PATH.
// Avec une carte AMD sous Windows, Ollama passe par Vulkan (voir vulkanUtile dans principal/envoi.js).
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { vulkanUtile } = require('./envoi');

function commandeOllama({ plateforme = process.platform, env = process.env, existe = fs.existsSync } = {}) {
  if (plateforme !== 'win32') return 'ollama';
  const exe = path.join(env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe');
  return existe(exe) ? exe : null;
}

// Les cartes graphiques, hors Electron (catai) : les identifiants PCI des contrôleurs vidéo sous Windows
const VENDEURS = { '1002': 0x1002, '10DE': 0x10de, '8086': 0x8086 };
function cartesDepuisPnp(texte) {
  return [...String(texte).matchAll(/VEN_([0-9A-F]{4})/gi)].map((m) => ({ vendorId: VENDEURS[m[1].toUpperCase()] ?? parseInt(m[1], 16) }));
}
function cartesDuPC({ plateforme = process.platform } = {}) {
  if (plateforme !== 'win32') return Promise.resolve([]);
  return new Promise((resoudre) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_VideoController | ForEach-Object PNPDeviceID'],
      { windowsHide: true, timeout: 10000, encoding: 'utf8' }, (err, sortie) => resoudre(err ? [] : cartesDepuisPnp(sortie)));
  });
}

// Lance « ollama serve ». detache : il continue après la fin du programme qui l'a lancé (catai), pour que la
// discussion suivante parte tout de suite, comme l'appli d'Ollama le fait. Renvoie le processus, ou null.
function lancerOllama({ cartes = [], detache = false, plateforme = process.platform, env = process.env, lancer = spawn, commande = commandeOllama({ plateforme, env }) } = {}) {
  if (!commande) return null;
  const environnement = vulkanUtile(plateforme, env, cartes) ? { ...env, OLLAMA_VULKAN: '1' } : env;
  // Sous Windows, un Ollama qui doit survivre à catai ne peut pas être lancé « détaché » : sans console, il ouvrait une
  // fenêtre visible pour chaque modèle chargé (llama-server). Lancé normalement, Node le met dans un groupe que Windows
  // ferme à la fin de catai. Un PowerShell normal (lui, dans le groupe) le lance donc avec sa propre console cachée :
  // les petits-enfants sortent du groupe, Ollama survit, et ses programmes reprennent la console cachée. Vérifié :
  // aucune fenêtre, Ollama toujours là après catai. (PowerShell « détaché » ne démarre pas : il lui faut une console.)
  // Le chemin passe par une variable, jamais dans la commande.
  if (detache && plateforme === 'win32') {
    const enfant = lancer('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "Start-Process -FilePath $env:CATAI_OLLAMA -ArgumentList 'serve' -WindowStyle Hidden"], {
      windowsHide: true, stdio: 'ignore', env: { ...environnement, CATAI_OLLAMA: commande },
    });
    enfant.on?.('error', () => {});
    return enfant;
  }
  const enfant = lancer(commande, ['serve'], { windowsHide: true, stdio: 'ignore', detached: detache, env: environnement });
  enfant.on?.('error', () => {});
  if (detache) enfant.unref?.();
  return enfant;
}

// Attend qu'Ollama réponde (true), ou abandonne au bout du délai (false)
async function attendreOllama(repond, { delai = 20000, pas = 500 } = {}) {
  const fin = Date.now() + delai;
  while (Date.now() < fin) {
    if (await repond()) return true;
    await new Promise((r) => setTimeout(r, pas));
  }
  return false;
}

module.exports = { commandeOllama, cartesDepuisPnp, cartesDuPC, lancerOllama, attendreOllama };
