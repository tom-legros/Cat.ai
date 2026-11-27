// Installer la commande « catai » depuis l'app (Réglages), sans npm link : ensuite on tape catai dans n'importe
// quel terminal, sur le dossier où l'on est.
//
// Windows : l'app installée contient déjà resources\bin\catai.cmd (package.json, extraResources) ; en développement,
// on écrit un lanceur dans le dossier de l'app. Ce dossier est ajouté au PATH de l'utilisateur (pas du système : aucun
// droit administrateur), dans le registre, en gardant le type « chaîne extensible » des entrées existantes. Le
// changement est annoncé à Windows : les terminaux ouverts ENSUITE trouvent catai.
// Linux et macOS : un petit script dans ~/.local/bin (déjà dans le PATH de la plupart des distributions). Avec une
// AppImage, le moteur de l'app change de place à chaque lancement : le script relance l'AppImage avec --catai.
//
// Rien ici ne lance de commande tout seul : main.js donne de quoi exécuter PowerShell (executerPowerShell), pour
// pouvoir tout tester sans toucher au vrai PATH.
const fs = require('fs');
const os = require('os');
const path = require('path');

const citerSh = (texte) => `'${String(texte).replace(/'/g, "'\\''")}'`;

// Le contenu du lanceur, selon le système
function contenuCommande({ plateforme = process.platform, moteur, script, appimage }) {
  if (plateforme === 'win32') {
    return ['@echo off', 'rem catai : Cat Ai dans le terminal (lanceur écrit par Cat Ai)', 'setlocal', 'set ELECTRON_RUN_AS_NODE=1', `"${moteur}" "${script}" %*`, ''].join('\r\n');
  }
  const lignes = ['#!/bin/sh', '# catai : Cat Ai dans le terminal (lanceur écrit par Cat Ai)'];
  if (appimage) lignes.push(`exec ${citerSh(appimage)} --catai "$@"`);
  else lignes.push(`ELECTRON_RUN_AS_NODE=1 exec ${citerSh(moteur)} ${citerSh(script)} "$@"`);
  return `${lignes.join('\n')}\n`;
}

// Le script PowerShell qui ajoute (ou retire) un dossier du PATH de l'utilisateur. Le dossier arrive par une variable
// d'environnement, jamais dans le texte du script : aucun caractère du chemin ne peut changer la commande.
const SCRIPT_PATH = `
$ErrorActionPreference = 'Stop'
$d = $env:CATAI_DOSSIER
$cle = Get-Item -Path 'HKCU:\\Environment'
$ancien = $cle.GetValue('Path', '', 'DoNotExpandEnvironmentNames')
$parts = @($ancien -split ';' | Where-Object { $_ -ne '' })
$sans = @($parts | Where-Object { $_.TrimEnd('\\') -ne $d.TrimEnd('\\') })
if ($env:CATAI_ACTION -eq 'ajouter') { $nouveau = @($sans + $d) } else { $nouveau = $sans }
$texte = $nouveau -join ';'
if ($texte -ne $ancien) {
  New-ItemProperty -Path 'HKCU:\\Environment' -Name 'Path' -Value $texte -PropertyType ExpandString -Force | Out-Null
  [Environment]::SetEnvironmentVariable('CATAI_MAJ_PATH', '1', 'User')
  [Environment]::SetEnvironmentVariable('CATAI_MAJ_PATH', $null, 'User')
}
Write-Output 'ok'
`;

// Où se trouve (ou se trouverait) la commande
function emplacement({ plateforme = process.platform, empaquetee, ressources, donnees, maison = os.homedir() }) {
  if (plateforme === 'win32') {
    const dossier = empaquetee ? path.join(ressources, 'bin') : path.join(donnees, 'bin');
    return { dossier, fichier: path.join(dossier, 'catai.cmd'), fourni: !!empaquetee };
  }
  const dossier = path.join(maison, '.local', 'bin');
  return { dossier, fichier: path.join(dossier, 'catai'), fourni: false };
}

const dansLePath = (dossier, valeurPath = process.env.PATH || '', plateforme = process.platform) => {
  const norme = (d) => {
    const n = path.normalize(d).replace(/[\\/]+$/, '');
    return plateforme === 'win32' ? n.toLowerCase() : n;
  };
  return String(valeurPath).split(plateforme === 'win32' ? ';' : ':').filter(Boolean).some((d) => norme(d) === norme(dossier));
};

// Le lanceur est-il de nous ? (on ne remplace ni ne supprime un fichier « catai » écrit par quelqu'un d'autre)
const estDeNous = (fichier) => {
  try { return /lanceur écrit par Cat Ai|Cat Ai dans le terminal/.test(fs.readFileSync(fichier, 'utf8')); } catch { return false; }
};

// Où en est la commande. pathUtilisateur : sous Windows, le PATH de l'utilisateur lu dans le registre (celui des
// prochains terminaux) ; ailleurs, le PATH courant.
function etatCommande({ plateforme = process.platform, empaquetee, ressources, donnees, maison, pathUtilisateur = process.env.PATH }) {
  const { dossier, fichier, fourni } = emplacement({ plateforme, empaquetee, ressources, donnees, maison });
  const present = fs.existsSync(fichier) && (fourni || estDeNous(fichier));
  const dansPath = dansLePath(dossier, pathUtilisateur || '', plateforme);
  // Sous Windows, le lanceur fourni avec l'app est toujours là : seul compte le PATH
  return { installee: present && (plateforme !== 'win32' || dansPath), present, dansPath, dossier, fichier };
}

// Le PATH de l'utilisateur, tel qu'il est enregistré (sans développer %USERPROFILE%…)
const SCRIPT_LIRE_PATH = "(Get-Item -Path 'HKCU:\\Environment').GetValue('Path', '', 'DoNotExpandEnvironmentNames')";

async function installerCommande({ plateforme = process.platform, empaquetee, ressources, donnees, maison, moteur, script, appimage, executerPowerShell }) {
  const { dossier, fichier, fourni } = emplacement({ plateforme, empaquetee, ressources, donnees, maison });
  if (!fourni) {
    if (fs.existsSync(fichier) && !estDeNous(fichier)) return { ok: false, erreur: `Un autre programme « catai » existe déjà : ${fichier}` };
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(fichier, contenuCommande({ plateforme, moteur, script, appimage }), { mode: 0o755 });
    if (plateforme !== 'win32') fs.chmodSync(fichier, 0o755);
  } else if (!fs.existsSync(fichier)) {
    return { ok: false, erreur: "Le lanceur catai.cmd manque dans l'app installée : réinstalle Cat Ai." };
  }
  if (plateforme === 'win32') {
    const r = await executerPowerShell(SCRIPT_PATH, { CATAI_DOSSIER: dossier, CATAI_ACTION: 'ajouter' });
    if (!/ok/.test(r)) return { ok: false, erreur: "Le PATH n'a pas pu être modifié." };
    return { ok: true, fichier, message: 'Commande installée : ouvre un NOUVEAU terminal et tape catai.' };
  }
  const message = dansLePath(dossier, process.env.PATH, plateforme)
    ? 'Commande installée : tape catai dans un terminal.'
    : `Commande installée dans ${dossier}, mais ce dossier n'est pas dans ton PATH : ajoute la ligne export PATH="$HOME/.local/bin:$PATH" à ton ~/.bashrc, puis ouvre un nouveau terminal.`;
  return { ok: true, fichier, message };
}

async function desinstallerCommande({ plateforme = process.platform, empaquetee, ressources, donnees, maison, executerPowerShell }) {
  const { dossier, fichier, fourni } = emplacement({ plateforme, empaquetee, ressources, donnees, maison });
  if (!fourni && fs.existsSync(fichier)) {
    if (!estDeNous(fichier)) return { ok: false, erreur: `Ce « catai » n'a pas été installé par Cat Ai : ${fichier}` };
    fs.rmSync(fichier, { force: true });
  }
  if (plateforme === 'win32') await executerPowerShell(SCRIPT_PATH, { CATAI_DOSSIER: dossier, CATAI_ACTION: 'retirer' });
  return { ok: true, message: 'Commande catai retirée.' };
}

// PowerShell avec un script : passé encodé (aucun souci de guillemets), les valeurs arrivent par l'environnement
function executerPowerShell(script, env = {}, { lancer = require('child_process').execFile } = {}) {
  const encode = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resoudre, rejeter) => {
    lancer('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode], {
      env: { ...process.env, ...env }, windowsHide: true, timeout: 30000, encoding: 'utf8',
    }, (err, sortie) => (err ? rejeter(err) : resoudre(String(sortie || '').trim())));
  });
}

module.exports = { contenuCommande, emplacement, dansLePath, estDeNous, etatCommande, installerCommande, desinstallerCommande, executerPowerShell, SCRIPT_PATH, SCRIPT_LIRE_PATH };
