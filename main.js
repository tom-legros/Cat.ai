const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const { configurerStockage, readJson, writeJson, prendreAlertes } = require('./principal/stockage');
const { IGNORED, MAX_FILE, cheminSur, estSensible, listFiles, chercherDansProjet, fichiersCites, contenuJoint } = require('./principal/fichiers');
const { OUTILS_ECRITURE, RIEN_N_A_CHANGE, REFUS_LECTURE, ecritureRefusee, remplacerTexte, parseTextToolCalls, resumerAction } = require('./principal/outils');
const { hote, HOTES_LOCAUX, fournisseurGratuit, modeleGratuit, conseilGratuit, adresseValide } = require('./principal/gratuit');
const { LIMITES_OLLAMA, MAX_JOINT, limitesTaille, raccourcir, compacter } = require('./principal/taille');
const { ajouterFait, nettoyerPrenom } = require('./principal/memoire');
const { OLLAMA, REFLEXION, envoyerOllama, envoyerOpenAI, vulkanUtile } = require('./principal/envoi');
const {
  FOURNISSEURS_DE_BASE, lireReglagesFournisseurs, infosFournisseur, configFournisseur, versInterface,
  etatChiffrement, chiffrer, formatDouteux, avertissementFormat, marquerModeleCasse, listerModeles,
} = require('./principal/fournisseurs');

const MAX_STEPS = 8;

let win;
let projectDir = null;
const controllers = new Map();

// Les fichiers de données sont dans userData ; une alerte de stockage part tout de suite vers l'interface si elle est prête
configurerStockage({
  dossier: app.getPath('userData'),
  prevenir: () => {
    if (win && !win.webContents.isLoading()) win.webContents.send('alertes-stockage', prendreAlertes());
  },
});

// ---------- Ollama ----------
// On lance seulement le serveur, caché, au lieu de l'appli Ollama et de sa fenêtre.
// S'il tournait déjà, on ne touche à rien ; si c'est nous qui l'avons lancé, on l'arrête en quittant.
let serveurOllama = null;

async function ollamaRepond() {
  try {
    return (await fetch(`${OLLAMA}/api/version`)).ok;
  } catch {
    return false;
  }
}

// Où trouver Ollama : sur Windows, son installeur le met dans LOCALAPPDATA ; sur Linux et macOS,
// la commande « ollama » est dans le PATH (et souvent déjà lancée en service par le système).
function commandeOllama() {
  if (process.platform !== 'win32') return 'ollama';
  const exe = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe');
  return fs.existsSync(exe) ? exe : null;
}

async function demarrerOllama() {
  if (await ollamaRepond()) return;
  const commande = commandeOllama();
  if (!commande) return;
  // Les cartes graphiques du PC, pour décider de Vulkan (voir vulkanUtile)
  const cartes = await app.getGPUInfo('basic').then((infos) => infos.gpuDevice || [], () => []);
  serveurOllama = spawn(commande, ['serve'], {
    windowsHide: true,
    stdio: 'ignore',
    env: vulkanUtile(process.platform, process.env, cartes) ? { ...process.env, OLLAMA_VULKAN: '1' } : process.env,
  });
  // Pas installé : rien ne se lance, et l'interface affiche « Ollama ne répond pas »
  serveurOllama.on('error', () => (serveurOllama = null));
  serveurOllama.on('exit', () => (serveurOllama = null));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#050505',
    title: 'Le chat noir',
    icon: path.join(__dirname, 'icone.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile('index.html');

  // Un lien dans une réponse s'ouvre dans le navigateur, jamais dans la fenêtre de l'app
  const ouvrirDehors = (url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); };
  win.webContents.on('will-navigate', (e, url) => { e.preventDefault(); ouvrirDehors(url); });
  win.webContents.setWindowOpenHandler(({ url }) => { ouvrirDehors(url); return { action: 'deny' }; });
}

// ---------- Outils que le modèle peut utiliser (leur liste : principal/outils.js) ----------
// Le dossier projet ouvert est ici : les fonctions de principal/fichiers.js le reçoivent en paramètre
const safePath = (rel) => cheminSur(projectDir, rel);

// Lecture d'un fichier sensible : L’utilisateur décide, en sachant si le contenu reste sur son PC ou part en ligne
async function accordLectureSensible(chemin, fournisseurId) {
  const config = infosFournisseur(fournisseurId);
  const local = !config || config.type === 'ollama' || HOTES_LOCAUX.includes(hote(config.baseUrl));
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Refuser', 'Autoriser'],
    defaultId: 0,
    cancelId: 0,
    title: 'Fichier sensible',
    message: `Le chat veut lire ${chemin}, un fichier qui contient souvent des secrets (mots de passe, clés API).`,
    detail: local
      ? 'Le modèle tourne sur ton PC : le contenu reste chez toi.'
      : `Le modèle est en ligne : le contenu partira sur les serveurs ${/^[aeiouyéh]/i.test(config.nom) ? "d'" : 'de '}${config.nom}.`,
  });
  return response === 1;
}

async function runTool(name, args, mode) {
  if (OUTILS_ECRITURE.has(name)) {
    const refus = ecritureRefusee(mode, args.chemin);
    if (refus) return refus;
  }
  switch (name) {
    case 'ouvrir_dossier': {
      const full = path.resolve(String(args.chemin || ''));
      if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) return `Le dossier ${full} n'existe pas. Demande le bon chemin à l'utilisateur.`;
      const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Autoriser', 'Refuser'],
        defaultId: 0,
        cancelId: 1,
        title: 'Ouvrir un dossier',
        message: `L'IA veut accéder au dossier :\n${full}`,
        detail: "Elle pourra lire ses fichiers. Pour chaque modification, elle te redemandera.",
      });
      if (response !== 0) return "L'utilisateur a refusé l'accès à ce dossier.";
      setProject(full);
      return `Dossier ouvert : ${full}\nFichiers :\n${listFiles(full).join('\n')}`;
    }
    case 'lister_fichiers': {
      const files = listFiles(safePath(args.dossier));
      return files.length ? files.join('\n') : '(dossier vide)';
    }
    case 'lire_fichier': {
      const full = safePath(args.chemin);
      const size = fs.statSync(full).size;
      if (size > MAX_FILE) return `Fichier trop gros (${Math.round(size / 1024)} Ko), lecture refusée.`;
      if (estSensible(full) && !(await accordLectureSensible(args.chemin, mode.fournisseurId))) {
        return `${REFUS_LECTURE}${args.chemin} : ce fichier peut contenir des secrets. Fais sans, ou demande-lui l'information dont tu as besoin.`;
      }
      const contenu = fs.readFileSync(full, 'utf8');
      // Lire la suite d'un long fichier coupé pour tenir dans la limite du modèle
      const ligne = Math.floor(Number(args.ligne));
      if (!(ligne > 1)) return contenu;
      const lignes = contenu.split('\n');
      if (ligne > lignes.length) return `${args.chemin} n'a que ${lignes.length} lignes.`;
      return `(${args.chemin}, à partir de la ligne ${ligne} sur ${lignes.length})\n${lignes.slice(ligne - 1).join('\n')}`;
    }
    case 'chercher': {
      return chercherDansProjet(projectDir, args.texte, { regex: args.regex === true || args.regex === 'true', dossier: args.dossier });
    }
    case 'ecrire_fichier': {
      return ecrireAvecAccord(args.chemin, String(args.contenu ?? ''));
    }
    case 'remplacer_texte': {
      const full = safePath(args.chemin);
      if (!fs.existsSync(full)) return `Le fichier ${args.chemin} n'existe pas. Pour créer un fichier, utilise ecrire_fichier.`;
      if (fs.statSync(full).size > MAX_FILE) return 'Fichier trop gros pour être modifié par le chat.' + RIEN_N_A_CHANGE;
      const partout = args.remplacer_partout === true || args.remplacer_partout === 'true';
      const resultat = remplacerTexte(fs.readFileSync(full, 'utf8'), String(args.ancien_texte ?? ''), String(args.nouveau_texte ?? ''), partout);
      if (resultat.erreur) return resultat.erreur;
      const reponse = await ecrireAvecAccord(args.chemin, resultat.contenu);
      // Le nombre de passages changés aide à repérer un renommage incomplet. Pas de consigne ici :
      // qwen3 recopie parfois la réponse de l'outil telle quelle à l’utilisateur.
      if (!reponse.startsWith('Fichier modifié') || !partout) return reponse;
      return `${reponse} (${resultat.fois} remplacement${resultat.fois > 1 ? 's' : ''})`;
    }
    case 'memoriser': {
      const resultat = ajouterFait(readJson('memory.json', []), args.fait);
      if (resultat.erreur) return resultat.erreur;
      writeJson('memory.json', resultat.memoire);
      win.webContents.send('memory-changed', resultat.memoire);
      // L'interface montre discrètement ce qui vient d'être retenu, avec un bouton pour l'annuler
      win.webContents.send('memoire-ajout', { fait: resultat.fait, remplace: resultat.remplace || null });
      return resultat.remplace ? `Mémorisé (remplace « ${resultat.remplace} »).` : 'Mémorisé.';
    }
    default:
      return `Outil inconnu : ${name}`;
  }
}

// Toute écriture passe par la fenêtre avant / après de l'interface (renderer.js),
// qui répond par 'confirm-write-reply'
const REFUS_ECRITURE = "L'utilisateur a refusé la modification.";

// Pour le modèle seulement : le bouton Enregistrer des blocs de code affiche le message de writeWithConfirm à l’utilisateur
async function ecrireAvecAccord(chemin, contenu) {
  const resultat = await writeWithConfirm(chemin, contenu);
  return resultat === REFUS_ECRITURE ? resultat + RIEN_N_A_CHANGE : resultat;
}

const confirmations = new Map();
let prochaineConfirmation = 1;

ipcMain.on('confirm-write-reply', (_e, { id, ok }) => {
  confirmations.get(id)?.(ok);
  confirmations.delete(id);
});

function demanderConfirmation(infos) {
  const id = prochaineConfirmation++;
  return new Promise((resolve) => {
    confirmations.set(id, resolve);
    win.webContents.send('confirm-write', { id, ...infos });
  });
}

async function writeWithConfirm(chemin, contenu) {
  const full = safePath(chemin);
  const exists = fs.existsSync(full);
  let ancien = '';
  if (exists) {
    if (fs.statSync(full).size > MAX_FILE) return 'Fichier existant trop gros pour être remplacé par le chat.';
    ancien = fs.readFileSync(full, 'utf8');
  }
  const ok = await demanderConfirmation({ chemin: full, ancien, nouveau: contenu, existe: exists });
  if (!ok) return REFUS_ECRITURE;
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contenu);
  return `Fichier ${exists ? 'modifié' : 'créé'} : ${chemin}`;
}

// Bouton "Enregistrer" sur un bloc de code
ipcMain.handle('save-code', async (_e, { chemin, contenu }) => {
  try {
    return { ok: true, message: await writeWithConfirm(chemin, contenu) };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

// La bonne fonction d'envoi selon le fournisseur ; la clé est lue ici, jamais reçue de l'interface
async function envoyeurPour(fournisseurId) {
  const config = await configFournisseur(fournisseurId);
  if (!config) throw new Error('Fournisseur inconnu. Choisis-en un dans la liste.');
  if (config.type === 'ollama') return envoyerOllama;
  if (!config.baseUrl) throw new Error(`Aucune adresse pour ${config.nom} : remplis-la dans le panneau Fournisseurs.`);
  if (!config.cle) throw new Error(`Aucune clé API pour ${config.nom} : ajoute-la dans le panneau Fournisseurs.`);
  return (...args) => envoyerOpenAI(config, ...args);
}

// Dernier garde-fou avant d'envoyer : jamais de modèle payant là où seuls les gratuits sont autorisés
function verifierGratuit(fournisseurId, modele) {
  const config = infosFournisseur(fournisseurId);
  if (!config) throw new Error('Fournisseur inconnu : rien n\'a été envoyé.');
  if (!modeleGratuit(config, modele)) {
    throw new Error(`${modele} n'est pas gratuit chez ${config.nom} : rien n'a été envoyé. ${conseilGratuit(config)}`);
  }
}

ipcMain.on('chat', async (event, { id, model, messages, prof, role, fournisseurId = 'ollama' }) => {
  const controller = new AbortController();
  controllers.set(id, controller);
  const history = [...messages];
  let nudged = false;
  const onMorceau = (text) => event.sender.send('chat-chunk', { id, text });
  try {
    verifierGratuit(fournisseurId, model);
    const envoyer = await envoyeurPour(fournisseurId);
    // Petite limite de taille (Ollama et ses 8 192 tokens, Groq gratuit) : chaque envoi est allégé,
    // pour que ce soit nous qui choisissions quoi raccourcir, et pas le modèle qui oublie la question
    const config = infosFournisseur(fournisseurId);
    const limites = config.type === 'ollama' ? LIMITES_OLLAMA : limitesTaille(config);
    let fini = false;
    for (let step = 0; step < MAX_STEPS; step++) {
      const aEnvoyer = limites ? compacter(history, limites.total) : history;
      // onPause : affiche une étiquette pendant que l'app attend la fin de la limite par minute
      const onPause = (secondes) => event.sender.send('chat-tool', { id, name: 'pause', args: { secondes } });
      let { content, toolCalls } = await envoyer(aEnvoyer, model, onMorceau, controller.signal, { prof, role, onPause });
      if (!toolCalls.length && content.includes('"name"')) {
        const parsed = parseTextToolCalls(content);
        if (parsed.length) {
          event.sender.send('chat-undo', { id, length: content.length });
          toolCalls = parsed;
          content = '';
        }
      }
      history.push({ role: 'assistant', content, tool_calls: toolCalls.length ? toolCalls : undefined });
      // Les petits modèles annoncent souvent une action sans la faire : on les relance une fois
      if (!toolCalls.length && !nudged && /je vais (ouvrir|regarder|lire|lister|consulter|jeter|écrire|créer|modifier)/i.test(content)) {
        nudged = true;
        history.push({ role: 'user', content: "Vas-y, utilise l'outil maintenant au lieu de l'annoncer." });
        event.sender.send('chat-chunk', { id, text: '\n\n' });
        continue;
      }
      if (!toolCalls.length) {
        fini = true;
        break;
      }
      for (const call of toolCalls) {
        const { name, arguments: args } = call.function;
        // Les étiquettes montrent seulement le chemin, pas les gros textes
        event.sender.send('chat-tool', { id, name, args: { ...args, contenu: undefined, ancien_texte: undefined, nouveau_texte: undefined } });
        // Écriture refusée par le mode prof ou le rôle : L’utilisateur le voit, même si le modèle prétend le contraire
        if (OUTILS_ECRITURE.has(name) && ecritureRefusee({ prof, role }, args?.chemin)) {
          event.sender.send('chat-tool', { id, name: 'refus', args: { chemin: args.chemin } });
        }
        let result;
        try {
          result = await runTool(name, args || {}, { prof, role, fournisseurId });
        } catch (err) {
          result = `Erreur : ${err.message}`;
        }
        // Une ligne qui résume l'action, gardée par l'interface dans l'historique de la discussion
        // Lecture d'un fichier sensible refusée par l’utilisateur : l'étiquette « Lit .env » ne doit pas laisser croire le contraire
        if (name === 'lire_fichier' && String(result).startsWith(REFUS_LECTURE)) {
          event.sender.send('chat-tool', { id, name: 'refus-lecture', args: { chemin: args.chemin } });
        }
        const action = resumerAction(name, args || {}, result);
        if (action) event.sender.send('chat-action', { id, action });
        // tool_name sert à Ollama, tool_call_id aux fournisseurs OpenAI (chacun ignore l'autre)
        const texte = limites ? raccourcir(String(result), limites.resultatOutil) : String(result);
        history.push({ role: 'tool', content: texte, tool_name: name, tool_call_id: call.id });
      }
    }
    // Toutes les étapes utilisées sans réponse finale : L’utilisateur le voit, au lieu d'une réponse qui s'arrête sans rien dire
    if (!fini) event.sender.send('chat-tool', { id, name: 'limite', args: { etapes: MAX_STEPS } });
    event.sender.send('chat-done', { id });
  } catch (err) {
    if (err.name === 'AbortError') event.sender.send('chat-done', { id });
    else {
      if (err.modeleCasse) marquerModeleCasse(fournisseurId, model);
      event.sender.send('chat-error', { id, error: err.message, modeleCasse: err.modeleCasse ? model : null });
    }
  } finally {
    controllers.delete(id);
  }
});

ipcMain.on('chat-stop', (_e, id) => {
  controllers.get(id)?.abort();
  // Si une fenêtre avant / après attendait, on la considère comme refusée
  confirmations.forEach((resolve) => resolve(false));
  confirmations.clear();
  win.webContents.send('confirm-write-cancel');
});

// Résume le début d'une longue discussion, pour que le modèle ne l'oublie pas
ipcMain.handle('summarize', async (_e, { model, messages, ancienResume, fournisseurId = 'ollama' }) => {
  const nom = lirePrenom() || "L'utilisateur";
  const texte = messages.map((m) => `${m.role === 'user' ? nom : 'Le chat'} : ${m.content}`).join('\n\n');
  const consigne = `Résume cette discussion entre ${nom} et son assistant en 10 lignes maximum, en français.
Garde : ce que ${nom} veut faire, les décisions prises, les fichiers et noms importants, ce qui reste à faire. Pas de blabla.
${ancienResume ? `\nRésumé de ce qui s'est passé encore avant :\n${ancienResume}\n` : ''}
Discussion :
${texte}`;
  const config = await configFournisseur(fournisseurId);
  if (!modeleGratuit(config, model)) return null; // pas de résumé payant
  try {
    if (!config || config.type === 'ollama') {
      const res = await fetch(`${OLLAMA}/api/chat`, {
        method: 'POST',
        body: JSON.stringify({ model, messages: [{ role: 'user', content: consigne }], stream: false, think: model.startsWith('qwen3') ? false : undefined, options: { num_ctx: 8192 } }),
      });
      if (!res.ok) return null; // le résumé est facultatif : on envoie quand même, sans lui
      const data = await res.json();
      return data.message?.content?.trim() || null;
    }
    // Fournisseur en ligne : même requête, sans streaming et sans outils
    const res = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.cle}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: consigne }], stream: false, reasoning_effort: REFLEXION[config.id] }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return null; // y compris si le réglage de réflexion est refusé : le résumé est facultatif
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.replace(/<think>[\s\S]*?<\/think>/g, '').trim() || null;
  } catch {
    return null;
  }
});

// Fichier glissé dans la fenêtre : on lit son texte (le chemin vient de preload.js)
ipcMain.handle('read-dropped', (_e, chemin) => {
  try {
    const stat = fs.statSync(chemin);
    if (stat.isDirectory()) return { dossier: true, chemin };
    if (stat.size > MAX_FILE) return { erreur: `${path.basename(chemin)} est trop gros (${Math.round(stat.size / 1024)} Ko, max 100 Ko).` };
    const contenu = fs.readFileSync(chemin, 'utf8');
    if (contenu.includes('\u0000')) return { erreur: `${path.basename(chemin)} n'est pas un fichier texte.` };
    return { nom: path.basename(chemin), chemin, contenu };
  } catch (err) {
    return { erreur: err.message };
  }
});

ipcMain.handle('fournisseurs-lire', () => versInterface());

// Enregistre un fournisseur : { id, cle?, nom?, baseUrl? }
// cle absente = on garde l'ancienne ; cle vide = on la supprime ; nom et baseUrl seulement pour le personnalisé
ipcMain.handle('fournisseurs-enregistrer', async (_e, { id, cle, nom, baseUrl }) => {
  const base = FOURNISSEURS_DE_BASE.find((f) => f.id === id);
  if (!base || base.type === 'ollama') return { ok: false, erreur: 'Fournisseur inconnu.' };
  // La clé est chiffrée AVANT de lire les réglages : rien ne peut les modifier entre la lecture et l'écriture
  const propre = cle === undefined ? undefined : String(cle).trim();
  let cleChiffree = null;
  if (propre) {
    // Jamais de clé en clair sur le disque, ni « protégée » par un mot de passe connu : si le chiffrement
    // n'est pas vraiment disponible, on refuse
    const chiffrement = await etatChiffrement();
    if (!chiffrement.dispo) return { ok: false, erreur: chiffrement.raison };
    cleChiffree = await chiffrer(propre);
  }
  const reglages = lireReglagesFournisseurs();
  const f = { ...(reglages.fournisseurs[id] || {}) };
  if (base.modifiable) {
    if (nom !== undefined) f.nom = String(nom).trim().slice(0, 40);
    if (baseUrl !== undefined) {
      const url = String(baseUrl).trim().replace(/\/+$/, '');
      if (url && !adresseValide(url)) return { ok: false, erreur: "Adresse invalide : elle doit commencer par https:// (ou http:// pour un serveur sur ton PC)." };
      if (url && !fournisseurGratuit(url)) return { ok: false, erreur: "Adresse refusée : l'app est 100 % gratuite. Seuls un serveur sur ton PC (http://localhost…), Groq, OpenRouter et Gemini sont acceptés." };
      f.baseUrl = url;
    }
  }
  if (propre !== undefined) {
    if (cleChiffree) f.cleChiffree = cleChiffree;
    else delete f.cleChiffree; // clé vide : on la supprime
  }
  reglages.fournisseurs[id] = f;
  writeJson('fournisseurs.json', reglages);
  const avertissement = propre && formatDouteux(id, propre) ? avertissementFormat(id, base.nom) : null;
  return { ok: true, avertissement, reglages: await versInterface() };
});

// Choisit le fournisseur actif et, si donné, le modèle retenu pour lui
ipcMain.handle('fournisseurs-choisir', async (_e, { id, modele }) => {
  if (!FOURNISSEURS_DE_BASE.some((f) => f.id === id)) return { ok: false, erreur: 'Fournisseur inconnu.' };
  const reglages = lireReglagesFournisseurs();
  reglages.actif = id;
  // Un modèle payant n'est jamais retenu
  if (modele && modeleGratuit(infosFournisseur(id), String(modele))) reglages.modeles[id] = String(modele);
  writeJson('fournisseurs.json', reglages);
  return { ok: true, reglages: await versInterface() };
});

// Pour l'accueil du premier lancement. Hors Windows, on ne sait pas s'il est installé tant qu'il ne répond pas.
ipcMain.handle('etat-ollama', async () => {
  const repond = await ollamaRepond();
  return { repond, installe: repond || (process.platform === 'win32' && !!commandeOllama()) };
});

// Télécharge un modèle dans Ollama depuis l'accueil (clic de l'utilisateur), en envoyant la progression
ipcMain.handle('ollama-telecharger', async (event, modele) => {
  if (!/^[\w.-]+(:[\w.-]+)?$/.test(String(modele))) return { ok: false, erreur: 'Nom de modèle invalide.' };
  try {
    const res = await fetch(`${OLLAMA}/api/pull`, { method: 'POST', body: JSON.stringify({ model: modele, stream: true }) });
    if (!res.ok || !res.body) return { ok: false, erreur: `Ollama a répondu ${res.status}.` };
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lignes = buffer.split('\n');
      buffer = lignes.pop();
      for (const ligne of lignes.filter((l) => l.trim())) {
        const d = JSON.parse(ligne);
        if (d.error) return { ok: false, erreur: d.error };
        event.sender.send('ollama-progression', { statut: d.status, fait: d.completed, total: d.total });
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, erreur: err.message };
  }
});

ipcMain.handle('models', async (_e, fournisseurId = 'ollama') => {
  const config = await configFournisseur(fournisseurId);
  if (!config) return { ok: false, models: [], erreur: 'Fournisseur inconnu.' };
  return listerModeles(config);
});

// ---------- Projet ----------
ipcMain.handle('open-project', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Ouvrir un dossier projet' });
  if (!canceled) setProject(path.resolve(filePaths[0]));
  return projectDir;
});

ipcMain.handle('close-project', () => setProject(null));

function setProject(dir) {
  projectDir = dir;
  writeJson('settings.json', { ...readJson('settings.json', {}), projectDir });
  win.webContents.send('project-changed', projectDir);
  return projectDir;
}

// Ouvre un dossier détecté dans le message de l'utilisateur, après confirmation
ipcMain.handle('open-project-path', async (_e, dir) => {
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Ouvrir', 'Non'],
    defaultId: 0,
    cancelId: 1,
    title: 'Ouvrir un dossier',
    message: `Tu parles de ce projet. Je l'ouvre pour que l'IA puisse lire son code ?\n${dir}`,
  });
  if (response === 0) setProject(dir);
  return projectDir;
});

// Contexte donné directement au modèle : liste des fichiers + fichiers cités dans le message
ipcMain.handle('project-context', (_e, message) => {
  if (!projectDir) return null;
  const files = listFiles(projectDir);
  // Au plus MAX_JOINT caractères joints en tout : la suite, le modèle la lit lui-même avec lire_fichier
  let place = MAX_JOINT;
  const mentioned = fichiersCites(message, files).slice(0, 3).map((f) => {
    const content = raccourcir(contenuJoint(projectDir, f), Math.max(place, 500));
    place -= content.length;
    return { path: f, content };
  });
  return { files: files.slice(0, 150), mentioned };
});

// Dossiers de projets connus, donnés au modèle pour qu'il ait les chemins exacts
ipcMain.handle('known-projects', () => {
  const root = path.join(app.getPath('documents'), 'MesProjets');
  const out = [];
  const dossiers = (dir) => fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !IGNORED.has(e.name) && !e.name.startsWith('.'));
  try {
    for (const e of dossiers(root)) {
      const chemin = path.join(root, e.name);
      // Un dossier qui ne contient que des dossiers (ex : Autre) sert à ranger des projets : on liste ce qu'il contient.
      // Sinon c'est un projet, et ses sous-dossiers (src, data, public…) n'en sont pas.
      const contenu = fs.readdirSync(chemin, { withFileTypes: true }).filter((x) => !x.name.startsWith('.') && x.name !== 'desktop.ini');
      if (contenu.length && contenu.every((x) => x.isDirectory())) dossiers(chemin).forEach((s) => out.push(path.join(chemin, s.name)));
      else out.push(chemin);
    }
  } catch {}
  return out.slice(0, 40);
});

ipcMain.handle('special-dirs', () => ({
  maison: app.getPath('home'),
  bureau: app.getPath('desktop'),
  documents: app.getPath('documents'),
  téléchargements: app.getPath('downloads'),
}));

ipcMain.handle('dir-exists', (_e, dir) => {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
});

// Le prénom de l'utilisateur, demandé au premier lancement : le chat s'en sert pour lui parler
const lirePrenom = () => String(readJson('settings.json', {}).prenom || '');

ipcMain.handle('get-prenom', () => lirePrenom());

ipcMain.handle('set-prenom', (_e, prenom) => {
  const propre = nettoyerPrenom(prenom);
  if (!propre) return lirePrenom();
  writeJson('settings.json', { ...readJson('settings.json', {}), prenom: propre });
  return propre;
});

ipcMain.handle('get-project', () => {
  if (projectDir === null) {
    const saved = readJson('settings.json', {}).projectDir;
    if (saved && fs.existsSync(saved)) projectDir = saved;
  }
  return projectDir;
});

// ---------- Mémoire et conversations ----------
ipcMain.handle('load-memory', () => readJson('memory.json', []));
ipcMain.handle('save-memory', (_e, memory) => writeJson('memory.json', memory));
ipcMain.handle('load-convs', () => readJson('conversations.json', []));
ipcMain.handle('save-convs', (_e, convs) => writeJson('conversations.json', convs));
ipcMain.handle('alertes-stockage', () => prendreAlertes());

// Une seule app ouverte à la fois : deux fenêtres liraient et enregistreraient chacune leur version
// des discussions et des réglages, et la dernière qui enregistre effacerait le travail de l'autre.
// Relancer l'app ramène simplement la fenêtre déjà ouverte au premier plan.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(() => {
    demarrerOllama();
    createWindow();
  });
}
app.on('window-all-closed', () => app.quit());
app.on('quit', () => serveurOllama?.kill());
