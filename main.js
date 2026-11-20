const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, Menu, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFileSync } = require('child_process');
const { adresseMcp } = require('./principal/connecteur-mcp');
const { discuter, MAX_STEPS } = require('./principal/agent');
const { creerFileOllama } = require('./principal/file-ollama');
const fileOllama = creerFileOllama();

const { configurerStockage, readJson, writeJson, prendreAlertes } = require('./principal/stockage');
const { IGNORED, MAX_FILE, MAX_FICHIER_OUTIL, cheminSur, estSensible, listFiles, fichiersCites, contenuJoint } = require('./principal/fichiers');
const { outilsPour } = require('./principal/outils');
const { hote, HOTES_LOCAUX, fournisseurGratuit, modeleGratuit, conseilGratuit, adresseValide } = require('./principal/gratuit');
const { LIMITES_OLLAMA, MAX_JOINT, limitesTaille, raccourcir, listeCourte, compacter } = require('./principal/taille');
const { ajouterFait, nettoyerPrenom, nettoyerMemoire, demandeMemoire } = require('./principal/memoire');
const { configurerMiseAJour } = require('./principal/miseajour');
const { urlsDans } = require('./principal/web');
const { integrerMenu } = require('./principal/menu-linux');
const { ouvrirTerminal } = require('./principal/terminal');
const { consigneTitre, nettoyerTitre } = require('./principal/titre');
const { conseilMateriel, catalogueMateriel } = require('./principal/materiel');
const { TYPES, equipeDepuis, equipeParDefaut, ajoutsPossibles, ajouterAgent, retirerAgent, modifierAgent } = require('./principal/equipe');
const { LANGUES_CORRECTION, lignesMenu } = require('./principal/menu-saisie');
const { lancerChantier, preparerPlan, codeurPour, jeterChantier } = require('./principal/chantier');
const { agentsDuChantier, etatDepot, MESSAGES_DEPOT, preparerDepot, garderChantier, resumeChantier } = require('./principal/lancement');
const { NOM_COPIE, brancheDe, copieDe, depotDeLaCopie, preparerCopie, changementsCopie, garderCopie, jeterCopie } = require('./principal/copie-agent');
const { BINAIRES, lireTexteDocument, texteJointDocument, idValide } = require('./principal/documents');
// Textes extraits des PDF et longs fichiers glissés dans la discussion
const DOSSIER_DOCUMENTS = () => path.join(app.getPath('userData'), 'documents');
const { OLLAMA, GARDER_CHARGE, LEGERE, optionsOllama, sansReflexion, REFLEXION, envoyerOllama, envoyerOpenAI, vulkanUtile } = require('./principal/envoi');
const { allegerMessages, dechargerAutres, cacheConnu, cacheReutilisable } = require('./principal/machine-legere');
const { ARRETS, promptBrutPossible, promptQwen } = require('./principal/prompt-brut');
const {
  FOURNISSEURS_DE_BASE, lireReglagesFournisseurs, infosFournisseur, configFournisseur, versInterface,
  etatChiffrement, chiffrer, messageCleIllisible, formatDouteux, avertissementFormat, marquerModeleCasse, listerModeles,
} = require('./principal/fournisseurs');


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
    return (await fetch(`${OLLAMA}/api/version`, { signal: AbortSignal.timeout(5000) })).ok;
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
    title: 'Cat Ai',
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

  // Fautes soulignées dans la saisie, et clic droit pour les corriger (principal/menu-saisie.js)
  try { win.webContents.session.setSpellCheckerLanguages(LANGUES_CORRECTION); } catch { /* langue absente sur ce système */ }
  win.webContents.on('context-menu', (_e, p) => {
    const actions = {
      corriger: (mot) => win.webContents.replaceMisspelling(mot),
      apprendre: (mot) => win.webContents.session.addWordToSpellCheckerDictionary(mot),
      couper: () => win.webContents.cut(),
      copier: () => win.webContents.copy(),
      coller: () => win.webContents.paste(),
    };
    const lignes = lignesMenu(p).map((l) => (l.separateur ? { type: 'separator' } : { label: l.texte, enabled: l.action !== 'rien', click: () => actions[l.action]?.(l.valeur) }));
    if (lignes.length) Menu.buildFromTemplate(lignes).popup({ window: win });
  });
}

// ---------- Outils que le modèle peut utiliser (leur liste : principal/outils.js) ----------
// Le dossier projet ouvert est ici : les fonctions de principal/fichiers.js le reçoivent en paramètre
const safePath = (rel) => cheminSur(projectDir, rel);

// Ce que l'agent (principal/agent.js) demande à l'utilisateur, avec les fenêtres de l'app
const uiFenetres = {
  demander: async ({ titre, message, detail, accepter = 'Autoriser', refuser = 'Refuser', attention = false }) => {
    const { response } = await dialog.showMessageBox(win, { type: attention ? 'warning' : 'question', title: titre, message, detail, buttons: [refuser, accepter], defaultId: 0, cancelId: 0 });
    return response === 1;
  },
  confirmerEcriture: (infos) => demanderConfirmation(infos),
  choisirExecutable: async ({ titre }) => {
    const choix = await dialog.showOpenDialog(win, {
      title: titre, properties: ['openFile'],
      ...(process.platform === 'win32' ? { filters: [{ name: 'Programme Windows', extensions: ['exe'] }] } : {}),
    });
    return choix.canceled ? null : choix.filePaths[0];
  },
};

// Le contexte des outils pour une réponse : dossier ouvert, réglages, ce qui est joint, et comment demander l'accord
// auto : mode Auto, projetInitial est alors le dossier de la copie de l'agent. Il y écrit sans fenêtre avant / après
// (la copie ne touche pas le projet) et n'en sort pas : ouvrir un autre dossier lui est refusé.
function contexteAgent({ prof, fournisseurId, liensDonnes = [], documentsJoints = new Set(), signal, maxExtrait = 20000, requeteId, projetInitial = projectDir, auto = false }) {
  const config = infosFournisseur(fournisseurId);
  let dossier = projetInitial;
  const ui = {
    ...uiFenetres,
    demander: async (infos) => {
      if (signal?.aborted) return false;
      const accord = await uiFenetres.demander(infos);
      return !signal?.aborted && accord;
    },
    choisirExecutable: async (infos) => {
      if (signal?.aborted) return null;
      const choix = await uiFenetres.choisirExecutable(infos);
      return signal?.aborted ? null : choix;
    },
    confirmerEcriture: auto ? async () => !signal?.aborted : infos => demanderConfirmation(infos, { requeteId, signal }),
  };
  return {
    projet: () => dossier,
    ouvrirProjet: dir => {
      signal?.throwIfAborted();
      if (auto) throw new Error("En mode Auto, l'agent reste dans la copie du dossier ouvert.");
      // Un changement manuel intervenu depuis le départ ne doit pas être remplacé par cet outil.
      if (projectDir === dossier) setProject(dir);
      dossier = dir;
      return dossier;
    },
    reglages: () => readJson('settings.json', {}),
    dossierDocuments: DOSSIER_DOCUMENTS(), ui, prof, liensDonnes, documentsJoints, signal, maxExtrait,
    fournisseurLocal: !config || config.type === 'ollama' || HOTES_LOCAUX.includes(hote(config.baseUrl)), nomFournisseur: config?.nom,
  };
}

// Toute écriture passe par la fenêtre avant / après de l'interface (renderer.js),
// qui répond par 'confirm-write-reply'
const REFUS_ECRITURE = "L'utilisateur a refusé la modification.";

const confirmations = new Map();
let prochaineConfirmation = 1;
let confirmationAffichee = null;

function afficherConfirmationSuivante() {
  if (confirmationAffichee !== null || !confirmations.size) return;
  const [id, demande] = confirmations.entries().next().value;
  confirmationAffichee = id;
  win.webContents.send('confirm-write', { ...demande.infos, id, requeteId: demande.requeteId });
}

function terminerConfirmation(id, ok, annulee = false) {
  const demande = confirmations.get(id);
  if (!demande) return;
  confirmations.delete(id);
  demande.signal?.removeEventListener('abort', demande.annuler);
  if (confirmationAffichee === id) {
    confirmationAffichee = null;
    if (annulee) win.webContents.send('confirm-write-cancel', { id });
  }
  demande.resolve(ok === true && !demande.signal?.aborted);
  afficherConfirmationSuivante();
}

ipcMain.on('confirm-write-reply', (_e, { id, ok }) => {
  if (id === confirmationAffichee) terminerConfirmation(id, ok);
});

function demanderConfirmation(infos, { requeteId, signal } = {}) {
  if (signal?.aborted) return Promise.resolve(false);
  const id = prochaineConfirmation++;
  return new Promise((resolve) => {
    const annuler = () => terminerConfirmation(id, false, true);
    confirmations.set(id, { resolve, infos, requeteId, signal, annuler });
    signal?.addEventListener('abort', annuler, { once: true });
    afficherConfirmationSuivante();
  });
}

async function writeWithConfirm(chemin, contenu) {
  const full = safePath(chemin);
  const exists = fs.existsSync(full);
  let ancien = '';
  if (exists) {
    if (fs.statSync(full).size > MAX_FICHIER_OUTIL) return 'Fichier existant trop gros pour être remplacé par le chat.';
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
  if (!config.cle) throw new Error(config.cleIllisible ? messageCleIllisible(config.nom) : `Aucune clé API pour ${config.nom} : ajoute-la dans le panneau Fournisseurs.`);
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

// ---------- Mode Auto : l'agent travaille sur une copie git du projet (principal/copie-agent.js) ----------
// L'interface ne donne que { nom, base } : le chemin de la copie est toujours recalculé ici.
const dossierCopiesAgent = () => path.join(app.getPath('userData'), 'copies-agent');
const copiesOccupees = new Set(); // noms des copies où une réponse est en train d'écrire
const MESSAGES_AUTO = {
  'git-absent': "Git n'est pas installé : le mode Auto en a besoin pour travailler sur une copie. Cat Ai demande avant chaque modification.",
  'pas-de-depot': "Ce dossier n'est pas suivi par git : le mode Auto en a besoin pour travailler sur une copie. Cat Ai demande avant chaque modification.",
  'pas-de-commit': "Ce dossier n'a encore aucune version enregistrée dans git : le mode Auto en a besoin. Cat Ai demande avant chaque modification.",
};
const memeDossier = (a, b) => { try { return path.relative(fs.realpathSync(a), fs.realpathSync(b)) === ''; } catch { return false; } };

function copieParNom({ nom, base } = {}) {
  if (!NOM_COPIE.test(String(nom)) || !/^[0-9a-f]{40}$/.test(String(base))) return null;
  const copie = copieDe(dossierCopiesAgent(), nom);
  if (!fs.existsSync(copie)) return null;
  try {
    const branche = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: copie, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (branche !== brancheDe(nom)) return null;
  } catch { return null; }
  return { nom, base, copie };
}

// La copie de cette discussion si elle existe encore pour le même dépôt, sinon une nouvelle
function copiePourDiscussion(projet, demande) {
  const etat = etatDepot(projet);
  if (!etat.pret) return { erreur: MESSAGES_AUTO[etat.raison] };
  const racine = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: projet, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const sousDossier = path.relative(fs.realpathSync(racine), fs.realpathSync(projet));
  const existante = copieParNom(demande || {});
  if (existante && memeDossier(depotDeLaCopie(existante.copie), racine)) {
    return { ...existante, dossier: sousDossier ? path.join(existante.copie, sousDossier) : existante.copie };
  }
  const nom = `${Date.now().toString(36)}-${require('crypto').randomUUID().slice(0, 8)}`;
  return { ...preparerCopie(projet, dossierCopiesAgent(), nom), nouvelle: true };
}

ipcMain.on('chat', async (event, { id, model, messages, prof, documents = [], fournisseurId = 'ollama', reflexion = false, agent = null }) => {
  if (controllers.has(id)) return; // un doublon IPC ne remplace jamais le contrôleur actif
  const projetInitial = projectDir;
  const documentsJoints = new Set(Array.isArray(documents) ? documents.filter(idValide) : []);
  const controller = new AbortController();
  controllers.set(id, controller);
  // Les liens écrits par l'utilisateur dans la discussion, puis ceux trouvés par chercher_web : lire_page_web les ouvre sans redemander
  const liensDonnes = messages.filter((m) => m.role === 'user').flatMap((m) => urlsDans(m.content));
  const envoiChat = (canal, donnees) => event.sender.send(canal, { id, ...donnees });
  const statistiquesOllama = [];
  let nombreOutils = 0;
  let libererOllama;
  let copieAgent = null;
  // Mode Auto : l'interface apprend la copie de la discussion, puis ses changements avant la fin de la réponse
  const rapporterCopie = () => {
    if (!copieAgent) return;
    try { envoiChat('chat-agent', { nom: copieAgent.nom, base: copieAgent.base, ...changementsCopie(copieAgent.copie, copieAgent.base) }); }
    catch (err) { envoiChat('chat-agent', { nom: copieAgent.nom, base: copieAgent.base, erreur: err.message }); }
  };
try {
    verifierGratuit(fournisseurId, model);
    const envoyer = await envoyeurPour(fournisseurId);
    // Petite limite de taille (Ollama et ses 8 192 tokens, Groq gratuit) : chaque envoi est allégé,
    // pour que ce soit nous qui choisissions quoi raccourcir, et pas le modèle qui oublie la question
    const config = infosFournisseur(fournisseurId);
    const limites = config.type === 'ollama' ? LIMITES_OLLAMA : limitesTaille(config);
    if (agent?.auto === true && projetInitial && !prof) {
      const copie = copiePourDiscussion(projetInitial, agent.copie);
      if (copie.erreur) envoiChat('chat-agent', { erreur: copie.erreur });
      else if (copiesOccupees.has(copie.nom)) throw new Error('Une autre réponse écrit déjà dans cette copie.');
      else { copieAgent = copie; copiesOccupees.add(copie.nom); rapporterCopie(); }
    }
    const ctx = contexteAgent({ prof, fournisseurId, liensDonnes, documentsJoints, signal: controller.signal, maxExtrait: limites ? limites.resultatOutil - 500 : 20000, requeteId: id, projetInitial: copieAgent?.dossier || projetInitial, auto: !!copieAgent });
    if (config.type === 'ollama') {
      // Petite machine : arrêter le préchauffage ne libère pas Ollama (sur le processeur, il finit la lecture commencée,
      // ~15 s). On attend donc qu'il finisse : il lit les mêmes consignes, et la réponse profite de son cache.
      if (!LEGERE) prechauffage?.arret.abort();
      libererOllama = await fileOllama.prendre({ signal: controller.signal,
        onAttente: () => envoiChat('chat-etat', { etat: 'attente-ollama' }) });
      controller.signal.throwIfAborted();
      envoiChat('chat-etat', { etat: 'generation' });
    }
    const { fini } = await discuter({
      messages, modele: model, envoyer, limites, ctx,
      options: { projet: !!projetInitial, documents: documentsJoints.size > 0, connecteur: !!readJson('settings.json', {}).adresseMcp,
        // Mode Réflexion choisi dans le chat : option du transport Ollama seulement (les fournisseurs en ligne
        // gardent leur comportement inchangé). Les chantiers n'ont pas accès à cette option.
        ...(config.type === 'ollama' ? { onStatistiques: (mesure) => statistiquesOllama.push(mesure) } : {}),
        ...(config.type === 'ollama' && reflexion === true ? { reflexion: true } : {}),
      },
      ev: {
        morceau: (text) => envoiChat('chat-chunk', { text }),
        annuler: (length) => envoiChat('chat-undo', { length }),
        outil: (name, args) => { nombreOutils++; envoiChat('chat-tool', { name, args }); },
        action: (action) => envoiChat('chat-action', { action }),
        // Une étiquette pendant que l'app attend la fin de la limite par minute
        pause: (secondes) => envoiChat('chat-tool', { name: 'pause', args: { secondes } }),
      },
    });
    // Toutes les étapes utilisées sans réponse finale : l'utilisateur le voit, au lieu d'une réponse qui s'arrête sans rien dire
    if (!fini) event.sender.send('chat-tool', { id, name: 'limite', args: { etapes: MAX_STEPS } });
    rapporterCopie();
    event.sender.send('chat-done', { id, statistiquesOllama, nombreOutils });
  } catch (err) {
    rapporterCopie();
    if (err.name === 'AbortError') event.sender.send('chat-done', { id, interrompu: true });
    else {
      if (err.modeleCasse) marquerModeleCasse(fournisseurId, model);
      event.sender.send('chat-error', { id, error: err.message, modeleCasse: err.modeleCasse ? model : null });
    }
  } finally {
    libererOllama?.();
    controllers.delete(id);
    if (copieAgent) copiesOccupees.delete(copieAgent.nom);
  }
});

ipcMain.on('chat-stop', (_e, id) => {
  controllers.get(id)?.abort();
  // Le signal refuse uniquement les confirmations appartenant à cette requête.
});

// Mesures natives du résumé, liste fermée : durées Ollama (ns) de la réponse non streamée,
// et tokens « usage » des fournisseurs en ligne remappés sur les mêmes clés. Jamais de contenu.
function mesuresResumeOllama(data) {
  const mesures = {};
  for (const cle of ['total_duration', 'load_duration', 'prompt_eval_count', 'prompt_eval_duration', 'eval_count', 'eval_duration']) {
    if (Number.isFinite(data[cle]) && data[cle] >= 0) mesures[cle] = data[cle];
  }
  return mesures;
}

function mesuresResumeUsage(data) {
  const usage = data?.usage || {};
  const mesures = {};
  if (Number.isFinite(usage.prompt_tokens) && usage.prompt_tokens >= 0) mesures.prompt_eval_count = usage.prompt_tokens;
  if (Number.isFinite(usage.completion_tokens) && usage.completion_tokens >= 0) mesures.eval_count = usage.completion_tokens;
  return mesures;
}

// Résume le début d'une longue discussion, pour que le modèle ne l'oublie pas.
// avecMesures : retourne en plus { resume, mesures } ; sans lui, le contrat historique (contenu seul ou null) est conservé.
ipcMain.handle('summarize', async (_e, { model, messages, ancienResume, fournisseurId = 'ollama', avecMesures = false }) => {
  const nom = lirePrenom() || "L'utilisateur";
  const texte = messages.map((m) => `${m.role === 'user' ? nom : 'Le chat'} : ${m.content}`).join('\n\n');
  const consigne = `Résume cette discussion entre ${nom} et son assistant en 10 lignes maximum, en français.
IMPORTANT : Conserve à l'identique tous les codes de référence, identifiants, noms précis, décisions et contraintes que l'utilisateur demande explicitement de retenir. Préserve aussi ces informations lorsqu'elles figurent dans l'ancien résumé. N'invente jamais d'informations absentes de la discussion.
Garde : ce que ${nom} veut faire, les décisions prises, les fichiers et noms importants, ce qui reste à faire. Pas de blabla.
${ancienResume ? `\nRésumé de ce qui s'est passé encore avant :\n${ancienResume}\n` : ''}
Discussion :
${texte}`;
  const config = await configFournisseur(fournisseurId);
  if (!modeleGratuit(config, model)) return null; // pas de résumé payant
  let libererOllama;
  try {
    if (!config || config.type === 'ollama') {
      const signal = AbortSignal.timeout(60000);
      prechauffage?.arret.abort();
      libererOllama = await fileOllama.prendre({ signal });
      signal.throwIfAborted();
      const res = await fetch(`${OLLAMA}/api/chat`, {
        method: 'POST',
        signal,
        body: JSON.stringify({ model, messages: [{ role: 'user', content: consigne }], stream: false, think: sansReflexion(model), keep_alive: GARDER_CHARGE, options: optionsOllama(model) }),
      });
      if (!res.ok) return null; // le résumé est facultatif : on envoie quand même, sans lui
      const data = await res.json();
      const resume = data.message?.content?.trim() || null;
      return avecMesures ? { resume, mesures: mesuresResumeOllama(data) } : resume;
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
    const resume = data.choices?.[0]?.message?.content?.replace(/<think>[\s\S]*?<\/think>/g, '').trim() || null;
    return avecMesures ? { resume, mesures: mesuresResumeUsage(data) } : resume;
  } catch {
    return null;
  } finally {
    libererOllama?.();
  }
});

// Titre d'une discussion, après sa première réponse : seulement avec Ollama (gratuit, sans quota).
// Si Ollama est déjà occupé (une réponse part), on passe son tour : un titre ne doit jamais retarder un message.
// { occupe: true } dit à l'interface qu'elle pourra réessayer après la réponse suivante.
ipcMain.handle('titre-discussion', async (_e, { model, premierMessage } = {}) => {
  // Petite machine : pas de titre par le modèle. Sa demande remplacerait les consignes gardées en cache par Ollama,
  // et le message suivant devrait tout relire (~13 s sur le processeur). La discussion garde ses premiers mots.
  if (!model || !premierMessage || LEGERE) return null;
  if (fileOllama.occupee) return { occupe: true };
  let libererOllama;
  try {
    const signal = AbortSignal.timeout(20000);
    libererOllama = await fileOllama.prendre({ signal });
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      signal,
      body: JSON.stringify({ model, messages: [{ role: 'user', content: consigneTitre(premierMessage) }], stream: false, think: false, keep_alive: GARDER_CHARGE, options: { ...optionsOllama(model), num_predict: 24, temperature: 0.3 } }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return nettoyerTitre(data.message?.content);
  } catch {
    return null; // le titre est facultatif : la discussion garde le sien
  } finally {
    libererOllama?.();
  }
});

// Fichier glissé dans la fenêtre : on lit son texte (le chemin vient de preload.js)
// Fichier glissé : une image (pour un modèle qui voit), un PDF ou un long texte (rangé, lu par morceaux),
// ou un petit fichier texte joint en entier
// nativeImage ne décode que PNG et JPEG (et ICO sous Windows) : les autres formats sont refusés avec un conseil
const IMAGES = /\.(png|jpe?g|ico)$/i;
const MAX_IMAGE = 20 * 1024 * 1024;
const COTE_IMAGE = 1280; // une photo de téléphone est réduite : assez pour lire un cours, sans remplir le modèle

// Le JPEG n'a pas de transparence : les zones transparentes d'un PNG (schéma, formule) devenaient noires, et un
// texte noir disparaissait. On pose l'image sur du blanc. Les pixels de Chromium sont en BGRA à alpha prémultiplié :
// sur du blanc, chaque couleur gagne ce qui manque d'opacité.
function surFondBlanc(image) {
  const pixels = image.toBitmap();
  let transparent = false;
  for (let i = 3; i < pixels.length && !transparent; i += 4) transparent = pixels[i] < 255;
  if (!transparent) return image;
  for (let i = 0; i < pixels.length; i += 4) {
    const manque = 255 - pixels[i + 3];
    for (let c = 0; c < 3; c++) pixels[i + c] = Math.min(255, pixels[i + c] + manque);
    pixels[i + 3] = 255;
  }
  return nativeImage.createFromBitmap(pixels, image.getSize());
}

// Sélecteur de fichier pour le bouton + du chat : renvoie seulement un chemin, la lecture passe ensuite par
// read-dropped (mêmes vérifications que le glisser-déposer : fichier sensible, format, taille, document).
// Bouton Terminal : catai dans une vraie console, sur le dossier ouvert (ou le dossier personnel)
ipcMain.handle('ouvrir-terminal', () => {
  try {
    return ouvrirTerminal({
      moteur: process.execPath,
      script: path.join(app.getAppPath(), 'cli', 'catai.js'),
      dossier: projectDir && fs.existsSync(projectDir) ? projectDir : os.homedir(),
      dossierLanceur: app.getPath('userData'),
    });
  } catch (err) {
    return { ok: false, erreur: "Impossible d'ouvrir le terminal : " + err.message };
  }
});

ipcMain.handle('choisir-fichier', async (_e, options = {}) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: options.image ? 'Choisir une image' : 'Choisir un fichier',
    properties: options.plusieurs ? ['openFile', 'multiSelections'] : ['openFile'],
    ...(options.image ? { filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }] } : {}),
  });
  if (canceled) return null;
  return options.plusieurs ? filePaths : filePaths[0];
});

ipcMain.handle('read-dropped', async (_e, chemin) => {
  try {
    chemin = fs.realpathSync(chemin);
    const stat = fs.statSync(chemin);
    if (stat.isDirectory()) return { dossier: true, chemin };
    const nom = path.basename(chemin);
    if (!stat.isFile()) return { erreur: "Cette pièce jointe n'est pas un fichier ordinaire." };
    if (estSensible(chemin)) return { erreur: 'Ce fichier est sensible. Pour le lire, ouvre son dossier et demande au chat de le lire : une confirmation sera affichée.' };
    if (/\.(heic|heif|tiff?|svg|gif|webp|bmp|avif)$/i.test(chemin)) return { erreur: `${nom} : ce format d'image n'est pas lu. Enregistre-la en JPG ou en PNG, puis glisse-la à nouveau.` };
    if (IMAGES.test(chemin)) {
      if (stat.size > MAX_IMAGE) return { erreur: `${nom} est trop grosse (${Math.round(stat.size / 1024 / 1024)} Mo).` };
      let image = nativeImage.createFromPath(chemin);
      if (image.isEmpty()) return { erreur: `${nom} n'a pas pu être ouverte comme image.` };
      const { width, height } = image.getSize();
      if (Math.max(width, height) > COTE_IMAGE) image = image.resize(width >= height ? { width: COTE_IMAGE } : { height: COTE_IMAGE }, 'best');
      image = surFondBlanc(image);
      const apercu = image.resize({ height: 64 }).toDataURL();
      return { nom, chemin, image: image.toJPEG(85).toString('base64'), apercu };
    }
    if (BINAIRES.test(chemin)) {
      // Word, PowerPoint, Excel : formats bureautiques pas encore lus. Le dire clairement avant l'envoi,
      // avec la solution (export PDF) au lieu d'un « pas un PDF ni un fichier texte » générique.
      const bureautique = /\.(docx?|odt|pptx?|xlsx?|ods)$/i.test(chemin);
      return { erreur: bureautique
        ? `${nom} : Cat Ai ne lit pas encore les documents Word, PowerPoint ou Excel. Exporte-le en PDF, ou copie son texte ici.`
        : `${nom} n'est pas un PDF ni un fichier texte : Cat Ai ne lit pas ce format. Exporte-le en PDF, ou copie son texte ici.` };
    }
    // PDF, ou fichier texte trop long pour partir en entier : texte extrait et rangé, le modèle le lit par morceaux
    if (/\.pdf$/i.test(chemin) || stat.size > MAX_FILE) {
      const doc = await lireTexteDocument(chemin, DOSSIER_DOCUMENTS());
      return doc.erreur ? doc : { nom, chemin, document: doc.document, joint: texteJointDocument(doc), pages: doc.pages };
    }
    const contenu = fs.readFileSync(chemin, 'utf8');
    if (contenu.includes('\u0000')) return { erreur: `${path.basename(chemin)} n'est pas un fichier texte.` };
    return { nom: path.basename(chemin), chemin, contenu };
  } catch (err) {
    return { erreur: err.message };
  }
});

ipcMain.handle('mcp-lire-adresse', () => readJson('settings.json', {}).adresseMcp || '');
ipcMain.handle('mcp-enregistrer-adresse', (_e, valeur) => {
  const url = valeur === '' ? null : adresseMcp(valeur);
  if (valeur !== '' && !url) return { erreur: 'Entre une URL HTTP locale avec un port, par exemple http://127.0.0.1:8765/mcp.' };
  const adresse = url?.href || '';
  writeJson('settings.json', { ...readJson('settings.json', {}), adresseMcp: adresse });
  return { adresse };
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
  return { repond, installe: repond || (process.platform === 'win32' && !!commandeOllama()), installationWindows: process.platform === 'win32' };
});

// Charge le modèle sur la carte graphique dès qu'il est choisi (ouverture de l'app, changement de modèle) :
// le premier message n'attend plus ~20 s le chargement. Une demande sans texte charge le modèle sans rien générer.
//
// Il lit aussi les consignes du chat et la description de ses outils (2 000 mots environ), exactement comme les enverra
// le prochain message : Ollama garde ce début en mémoire, et le premier message n'a plus que la question à lire.
// Mesuré sur une carte AMD de 8 Go : ~12 s de lecture avant le premier mot sinon. Les outils sont choisis comme dans le handler
// 'chat' (mêmes réglages, sans document joint) et le contexte réduit par compacter, sinon le début ne
// correspondrait plus. Les rappels (mode prof) arrivent après la question : ils ne gênent pas.
//
// Les consignes du dernier préchargement réussi sont retenues (prechauffe.json) : au démarrage suivant, main.js les
// fait lire dès qu'Ollama répond, sans attendre la fenêtre. L'interface est prévenue du début et de la fin
// (« Le chat se réveille… », avec un compteur) ; une demande identique pendant qu'une autre tourne la rejoint.
const FICHIER_PRECHAUFFE = 'prechauffe.json';
let prechauffage = null; // { corps, debut, promesse } pendant qu'Ollama lit

function prechaufferOllama({ modele, consignes, contexteProjet = '', prof }) {
  if (chantierEnCours) return false;
  // Petite machine : mêmes consignes allégées et mêmes outils que l'envoi (principal/envoi.js), sinon le cache ne sert à rien
  const outils = outilsPour({ prof, projet: !!projectDir, documents: false, connecteur: !!readJson('settings.json', {}).adresseMcp, legere: LEGERE });
  let messages;
  try { messages = compacter([{ role: 'system', content: consignes }, { role: 'system', name: 'contexte_projet', content: contexteProjet }], LIMITES_OLLAMA.total); }
  catch { return false; } // Le préchauffage est facultatif ; l'envoi affichera le diagnostic.
  if (LEGERE) messages = allegerMessages(messages);
  // Petite machine et Qwen 3 classique sans outils : même prompt brut que l'envoi (principal/prompt-brut.js), consignes seules
  const brut = LEGERE && promptBrutPossible({ modele, outils, messages });
  const adressePrechauffage = brut ? `${OLLAMA}/api/generate` : `${OLLAMA}/api/chat`;
  const corps = JSON.stringify(brut
    ? { model: modele, prompt: promptQwen(messages, { generation: false }), raw: true, stream: false, keep_alive: GARDER_CHARGE, options: { ...optionsOllama(modele), num_predict: 1, stop: ARRETS } }
    : { model: modele, messages, tools: outils, stream: false, think: sansReflexion(modele), keep_alive: GARDER_CHARGE, options: { ...optionsOllama(modele), num_predict: 1 } });
  if (prechauffage?.corps === corps) return prechauffage.promesse;
  if (fileOllama.occupee) return false;
  // Petite machine : un préchauffage en cours n'est jamais remplacé (Ollama finirait quand même sa lecture)
  if (LEGERE && prechauffage) return false;
  // Petite machine : un modèle qui ne peut pas réutiliser sa lecture (hybride, fenêtre glissante) n'est pas préchauffé.
  // La première fois, on demande son architecture à Ollama, puis on revient ici.
  if (LEGERE && cacheConnu(modele) === false) return false;
  if (LEGERE && cacheConnu(modele) === undefined) {
    cacheReutilisable(OLLAMA, modele).then((ok) => { if (ok) prechaufferOllama({ modele, consignes, contexteProjet, prof }); });
    return false;
  }
  prechauffage?.arret.abort();
  const arret = new AbortController();
  const debut = Date.now();
  win?.webContents.send('prechauffage', { enCours: true, debut });
  const promesse = Promise.resolve().then(async () => {
    let ok = false;
    let libererOllama;
    try {
      const signal = AbortSignal.any([arret.signal, AbortSignal.timeout(60_000)]);
      libererOllama = await fileOllama.prendre({ signal });
      signal.throwIfAborted();
      if (LEGERE) await dechargerAutres(OLLAMA, modele, { signal }); // un seul modèle en mémoire
      const res = await fetch(adressePrechauffage, { method: 'POST', body: corps, signal });
      await res.arrayBuffer();
      ok = res.ok;
    } catch {
      ok = false;
    } finally {
      libererOllama?.();
    }
    if (prechauffage?.promesse !== promesse) return false;
    prechauffage = null;
    if (ok) writeJson(FICHIER_PRECHAUFFE, { modele, consignes, contexteProjet, prof });
    win?.webContents.send('prechauffage', { enCours: false, ok, secondes: Math.round((Date.now() - debut) / 1000) });
    return ok;
  });
  prechauffage = { corps, debut, promesse, arret };
  return promesse;
}

ipcMain.handle('ollama-prechauffer', (_e, choix) => prechaufferOllama(choix));
ipcMain.handle('etat-prechauffage', () => (prechauffage ? { enCours: true, debut: prechauffage.debut } : { enCours: false }));

// Au démarrage : dès qu'Ollama répond (lancé par nous ou déjà là), on précharge avec les consignes de la dernière fois.
// Elles changent rarement d'une ouverture à l'autre ; si elles ont changé, l'interface en enverra d'autres.
async function prechaufferAuDemarrage() {
  const dernier = readJson(FICHIER_PRECHAUFFE, null);
  if (!dernier?.modele || typeof dernier.consignes !== 'string') return;
  chargerProjetEnregistre();
  for (let essai = 0; essai < 30 && !(await ollamaRepond()); essai++) await new Promise((ok) => setTimeout(ok, 1000));
  if (await ollamaRepond()) prechaufferOllama(dernier);
}

// Télécharge un modèle dans Ollama depuis l'accueil (clic de l'utilisateur), en envoyant la progression
// Le modèle choisi voit-il les images ? Ollama le dit (capacité « vision ») ; Gemini flash les voit toujours.
// Pour les autres fournisseurs on ne sait pas : on répond non, l'interface conseille alors un modèle qui voit.
let installationOllama = false;
ipcMain.handle('ollama-installer', async () => {
  if (process.platform !== 'win32') return { erreur: 'Ouvre le site officiel pour installer Ollama sur ce système.' };
  if (installationOllama) return { erreur: 'Une installation est déjà en cours.' };
  if (commandeOllama() || await ollamaRepond()) return { ok: true };
  if (installationOllama) return { erreur: 'Une installation est déjà en cours.' };
  installationOllama = true;
  try {
    const programme = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'winget.exe');
    const { response } = await dialog.showMessageBox(win, {
      type: 'question', title: 'Installer Ollama',
      buttons: ['Annuler', 'Installer'], defaultId: 0, cancelId: 0,
      message: 'Installer Ollama pour ton compte Windows avec WinGet ?',
    });
    if (response !== 1) return { annule: true };
    const code = await new Promise((resolve) => {
      const installateur = spawn(programme, ['install', '--id', 'Ollama.Ollama', '--exact', '--source', 'winget', '--scope', 'user', '--interactive'], {
        cwd: path.dirname(programme), windowsHide: true, stdio: 'ignore',
      });
      installateur.once('error', () => resolve(null));
      installateur.once('close', resolve);
    });
    if (code !== 0 && !commandeOllama()) return { erreur: 'WinGet n’a pas installé Ollama. Utilise le lien vers l’installateur officiel.' };
    await demarrerOllama();
    return { ok: true };
  } finally { installationOllama = false; }
});

ipcMain.handle('modele-voit-images', async (_e, { fournisseurId, modele }) => {
  const config = infosFournisseur(fournisseurId);
  if (!config || config.type === 'ollama') {
    try {
      const res = await fetch(`${OLLAMA}/api/show`, { method: 'POST', body: JSON.stringify({ model: modele }), signal: AbortSignal.timeout(5000) });
      return !!(await res.json()).capabilities?.includes('vision');
    } catch {
      return false;
    }
  }
  return hote(config.baseUrl) === 'generativelanguage.googleapis.com';
});

// Capacités du modèle choisi pour le sélecteur « Réflexion » : le bouton n'apparaît que si le modèle sait réfléchir
// (capability « thinking » dans /api/show). Fournisseurs en ligne : false, leur comportement reste inchangé.
ipcMain.handle('capacites-modele', async (_e, { fournisseurId, modele }) => {
  const config = infosFournisseur(fournisseurId);
  if (!config || config.type === 'ollama') {
    try {
      const res = await fetch(`${OLLAMA}/api/show`, { method: 'POST', body: JSON.stringify({ model: modele }), signal: AbortSignal.timeout(5000) });
      return { reflexion: !!(await res.json()).capabilities?.includes('thinking') };
    } catch {
      return { reflexion: false };
    }
  }
  return { reflexion: false };
});

// Le Qwen conseillé selon la mémoire de la carte graphique (principal/materiel.js), pour l'accueil
ipcMain.handle('conseil-materiel', () => conseilMateriel());
// Petite machine (principal/machine-legere.js) : l'interface se fait plus discrète pour laisser le processeur au modèle
ipcMain.handle('machine-legere', () => LEGERE);
// Page Modèles : le PC (carte graphique, RAM, disque) et chaque modèle connu avec son avis
ipcMain.handle('modeles-catalogue', () => catalogueMateriel());

// Page Agents : l'arbre d'agents du mode chantier (principal/equipe.js). L'interface reçoit l'arbre, et pour
// chaque agent ce qu'on peut encore ajouter dessous ; toutes les règles restent ici.
const vueEquipe = (equipe) => ({
  agents: equipe.agents.map((a) => ({ ...a, avecModele: TYPES[a.type].modele, ajouts: ajoutsPossibles(equipe, a.id) })),
  types: Object.fromEntries(Object.entries(TYPES).map(([id, t]) => [id, t.nom])),
});
function changerEquipe(changer) {
  if (chantierEnCours) return { ok: false, erreur: 'Attends la fin du chantier pour modifier ton équipe.' };
  const reglages = lireReglagesFournisseurs();
  const r = changer(equipeDepuis(reglages, infosFournisseur));
  if (r.erreur) return { ok: false, erreur: r.erreur };
  writeJson('fournisseurs.json', { ...reglages, equipe: r.equipe });
  chantierPrepare = null;
  return { ok: true, id: r.id, ...vueEquipe(r.equipe) };
}
ipcMain.handle('equipe-lire', () => vueEquipe(equipeDepuis(lireReglagesFournisseurs(), infosFournisseur)));
ipcMain.handle('equipe-ajouter', (_e, { parent, type, tests } = {}) => changerEquipe((e) => {
  const r = ajouterAgent(e, String(parent), String(type));
  if (r.erreur || type !== 'codeur' || !tests) return r;
  const agent = r.equipe.agents.find((a) => a.id === r.id);
  const nombre = r.equipe.agents.filter((a) => a.nom.startsWith('Auteur de tests')).length;
  Object.assign(agent, {
    nom: nombre ? `Auteur de tests ${nombre + 1}` : 'Auteur de tests',
    specialite: 'Écrit les tests de régression et les critères de validation. Intervient sur les fichiers de tests.',
    fournisseur: 'ollama',
    modele: e.agents.find((a) => a.type === 'codeur' && a.fournisseur === 'ollama')?.modele || '',
  });
  return r;
}));
ipcMain.handle('equipe-retirer', (_e, id) => changerEquipe((e) => retirerAgent(e, String(id))));
ipcMain.handle('equipe-modifier', (_e, { id, changement } = {}) => changerEquipe((e) => modifierAgent(e, String(id), changement || {}, infosFournisseur)));
ipcMain.handle('equipe-remettre', () => changerEquipe(() => {
  const equipe = equipeParDefaut(lireReglagesFournisseurs());
  const dev = equipe.agents.find((a) => a.type === 'codeur');
  const relecteur = equipe.agents.find((a) => a.type === 'relecteur');
  Object.assign(dev, { nom: 'Dev interface', specialite: 'Intégration des écrans et interactions.' });
  Object.assign(relecteur, { fournisseur: 'ollama', modele: dev.modele });
  equipe.agents.push(
    { ...dev, id: 'codeur-2', nom: 'Dev fonctionnalités', specialite: 'Logique métier et intégration technique.' },
    { ...dev, id: 'codeur-3', nom: 'Auteur de tests', specialite: 'Écrit les tests de régression dans les fichiers de tests.' },
  );
  return { equipe };
}));

ipcMain.handle('ollama-telecharger', async (event, modele) => {
  if (!/^[\w.-]+(:[\w.-]+)?$/.test(String(modele))) return { ok: false, erreur: 'Nom de modèle invalide.' };
  if (/[-:]cloud(?:$|-)/i.test(modele)) return { ok: false, erreur: 'Choisis une variante locale d’Ollama.' };
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

ipcMain.handle('models', async (_e, fournisseurId = 'ollama', options) => {
  const config = await configFournisseur(fournisseurId);
  if (!config) return { ok: false, models: [], erreur: 'Fournisseur inconnu.' };
  return listerModeles(config, { embeddings: options?.embeddings === true });
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
  const { fichiers, coupee } = listeCourte(files);
  return { files: fichiers, coupee, mentioned };
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

// Le dossier ouvert la dernière fois, retrouvé au démarrage (aussi par le préchargement, avant la fenêtre)
function chargerProjetEnregistre() {
  if (projectDir === null) {
    const saved = readJson('settings.json', {}).projectDir;
    if (saved && fs.existsSync(saved)) projectDir = saved;
  }
}

ipcMain.handle('get-project', () => {
  chargerProjetEnregistre();
  return projectDir;
});

// ---------- Mémoire et conversations ----------
ipcMain.handle('load-memory', () => readJson('memory.json', []));
// Touches personnelles (suggestions, répliques, origine du chat) : seulement sur le PC de celui qui écrit perso.json
ipcMain.handle('perso', () => {
  const perso = readJson('perso.json', {});
  return perso && typeof perso === 'object' && !Array.isArray(perso) ? perso : {};
});
// Depuis la fenêtre Mémoire (souvenir modifié ou oublié) : nettoyée, enregistrée, et renvoyée telle qu'enregistrée
ipcMain.handle('memoire-demande', async (_e, texte) => {
  const fait = demandeMemoire(texte);
  if (!fait) return { traitee: false };
  const proposition = ajouterFait(readJson('memory.json', []), fait);
  if (proposition.erreur) return { traitee: true, message: proposition.erreur };
  const { response } = await dialog.showMessageBox(win, {
    type: 'question', title: 'Ajouter à la mémoire',
    buttons: ['Refuser', 'Mémoriser'], defaultId: 0, cancelId: 0,
    message: 'Enregistrer ce souvenir pour les prochaines discussions ?', detail: proposition.fait,
  });
  if (response !== 1) return { traitee: true, message: 'Souvenir refusé.' };
  const ajout = ajouterFait(readJson('memory.json', []), proposition.fait);
  if (ajout.erreur) return { traitee: true, message: ajout.erreur };
  if (writeJson('memory.json', ajout.memoire) === false) return { traitee: true, message: 'Impossible d’enregistrer le souvenir.' };
  win.webContents.send('memory-changed', ajout.memoire);
  win.webContents.send('memoire-ajout', { fait: ajout.fait, remplace: ajout.remplace || null });
  return { traitee: true, message: 'Souvenir enregistré : « ' + ajout.fait + ' ».' };
});
ipcMain.handle('save-memory', (_e, memory) => {
  const propre = nettoyerMemoire(memory);
  writeJson('memory.json', propre);
  return propre;
});
ipcMain.handle('load-convs', () => readJson('conversations.json', []));
ipcMain.handle('save-convs', (_e, convs) => writeJson('conversations.json', convs));
ipcMain.handle('alertes-stockage', () => prendreAlertes());

// ---------- Chantier, lancé depuis la page Agents ----------
// Même moteur et même équipe que `catai chantier` (principal/chantier.js, principal/lancement.js). Le travail se
// fait dans une copie git du projet ouvert : rien n'y est écrit avant que l'utilisateur choisisse de le garder.
let chantierEnCours = null; // { arret } pendant qu'un chantier tourne : un seul à la fois
let chantierPrepare = null;
let chantierReprenable = null;
const direChantier = (evenement) => win?.webContents.send('chantier-evenement', evenement);
const NOM_CHANTIER = /^[\w-]{1,60}$/;
const demanderAccord = async ({ titre, message, detail, accepter }) => (await dialog.showMessageBox(win, {
  type: 'question', buttons: ['Annuler', accepter], defaultId: 0, cancelId: 0, title: titre, message, detail,
})).response === 1;

ipcMain.handle('chantier-etat', () => {
  if (!projectDir) return { projet: null, enCours: !!chantierEnCours };
  const etat = etatDepot(projectDir);
  return { projet: projectDir, enCours: !!chantierEnCours, ...etat, message: etat.pret ? '' : MESSAGES_DEPOT[etat.raison] };
});

// Met le dossier ouvert sous git, après accord : sans ça, pas de copie de travail possible
ipcMain.handle('chantier-preparer', async () => {
  if (!projectDir) return { ok: false, erreur: "Ouvre d'abord un dossier." };
  const accord = await demanderAccord({
    titre: 'Préparer le dossier', message: 'Mettre ce dossier sous git ?', accepter: 'Préparer le dossier',
    detail: `${projectDir}\n\nUn dossier caché « .git » y sera créé, avec une première version de tes fichiers. Tes fichiers ne changent pas, et rien n'est envoyé sur internet.`,
  });
  if (!accord) return { ok: false, annule: true };
  try { return { ok: true, ...preparerDepot(projectDir) }; } catch (err) { return { ok: false, erreur: err.message }; }
});

// Le plan peut venir d'un fichier texte choisi par l'utilisateur
ipcMain.handle('chantier-importer-plan', async () => {
  const choix = await dialog.showOpenDialog(win, { title: 'Choisir un plan', properties: ['openFile'], filters: [{ name: 'Texte', extensions: ['md', 'txt'] }] });
  if (choix.canceled) return null;
  try {
    if (fs.statSync(choix.filePaths[0]).size > 200000) return { erreur: 'Ce fichier est trop gros pour un plan.' };
    return { nom: path.basename(choix.filePaths[0]), texte: fs.readFileSync(choix.filePaths[0], 'utf8') };
  } catch (err) {
    return { erreur: `Impossible de lire ce fichier : ${err.message}` };
  }
});

ipcMain.handle('chantier-lancer', async (_e, { plan, action, agent } = {}) => {
  const texte = String(plan || '').trim();
  if (chantierEnCours) return { ok: false, erreur: 'Un chantier tourne déjà.' };
  const projet = projectDir;
  if (!projet) return { ok: false, erreur: "Ouvre d'abord le dossier de ton projet (bouton Dossier, sous la saisie)." };
  const reprise = action === 'reprendre' ? chantierReprenable : null;
  const preparation = action === 'executer' ? chantierPrepare : null;
  if (action === 'reprendre' && reprise?.projet !== projet) return { ok: false, erreur: 'Ce chantier ne peut plus être repris dans ce dossier.' };
  if (action === 'executer' && preparation?.projet !== projet) return { ok: false, erreur: 'Prépare à nouveau le plan pour ce dossier.' };
  if (!reprise && !preparation && texte.length < 20) return { ok: false, erreur: 'Écris ton plan : ce qu\'il faut faire, étape par étape.' };
  const etat = etatDepot(projet);
  if (!etat.pret) return { ok: false, erreur: MESSAGES_DEPOT[etat.raison], aPreparer: etat.raison !== 'git-absent' };
  const arret = new AbortController();
  chantierEnCours = { arret };
  prechauffage?.arret.abort();
  // Un chantier dure longtemps : le PC ne se met pas en veille pendant qu'il tourne
  const veille = powerSaveBlocker.start('prevent-app-suspension');
  const debut = Date.now();
  const dossierCopies = path.join(app.getPath('userData'), 'chantiers');
  try {
    if (!(await ollamaRepond())) return { ok: false, erreur: 'Ollama ne répond pas : les codeurs du chantier en ont besoin.' };
    arret.signal.throwIfAborted();
    const { chef, codeurs, resume } = agentsDuChantier({
      reglages: lireReglagesFournisseurs(), infos: infosFournisseur, envoyerLocal: envoyerOllama, limitesLocales: LIMITES_OLLAMA,
      limitesEnLigne: (id) => limitesTaille(infosFournisseur(id)),
      // Dernier garde-fou avant chaque appel en ligne : jamais de modèle payant
      envoyerEnLigne: (id) => async (messages, modele, ...reste) => { verifierGratuit(id, modele); return (await envoyeurPour(id))(messages, modele, ...reste); },
      dire: (t) => direChantier({ type: 'info', texte: t }),
    });
    if (action === 'preparer') {
      chantierPrepare = null;
      const locaux = equipeDepuis(lireReglagesFournisseurs(), infosFournisseur).agents.filter((a) => a.fournisseur === 'ollama' && a.modele);
      const installes = await listerModeles(infosFournisseur('ollama'));
      if (!installes.ok) return { ok: false, erreur: installes.erreur };
      const manquants = [...new Set(locaux.map((a) => a.modele))].filter((modele) => !installes.models.includes(modele));
      if (manquants.length) return { ok: false, erreur: `À télécharger dans Modèles : ${manquants.join(', ')}.`, modelesManquants: true };
      const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projet, encoding: 'utf8', windowsHide: true }).trim();
      const etapes = await preparerPlan({ projet, plan: texte, chef, codeurs, signal: arret.signal, base });
      chantierPrepare = { projet, texte, base, etapes, chef, codeurs };
      return { ok: true, preparation: etapes.map((e) => {
        const codeur = codeurPour(codeurs, e);
        return { titre: e.titre, codeur: codeur.nom, modele: codeur.qui() };
      }) };
    }
    const equipe = preparation || { chef, codeurs };
    const etapes = (reprise?.plan || preparation?.etapes)?.map((e) => ({ ...e }));
    if (reprise && agent != null && agent !== '') {
      // Le nom est un libellé : deux codeurs peuvent le partager. Aucun repli par nom.
      const choix = typeof agent === 'string' ? equipe.codeurs.filter((c) => c.id === agent) : [];
      if (choix.length !== 1) return { ok: false, erreur: 'Ce dev est introuvable ou son identifiant est ambigu. Sélectionne à nouveau un codeur.' };
      etapes[reprise.etapes.filter((e) => e.ok).length].agent = choix[0].id;
    }
    direChantier({ type: 'info', texte: `Équipe : ${resume}` });
    if (etat.modifs) direChantier({ type: 'info', texte: `Attention : ${etat.modifs} fichier(s) modifié(s) mais pas enregistré(s) dans git ne seront pas dans la copie.` });
    const r = await lancerChantier({
      projet, plan: reprise?.texte || preparation?.texte || texte, chef: equipe.chef, codeurs: equipe.codeurs, dossierCopies, signal: arret.signal,
      etapes, reprise, nom: reprise?.nom, base: preparation?.base,
      ev: {
        etape: (i, n, titre) => direChantier({ type: 'etape', i, n, titre }),
        info: (t) => direChantier({ type: 'info', texte: t }),
        // Pour la vue en direct : le plan découpé, l'agent qui a la main, le résultat de chaque étape
        plan: (etapes) => direChantier({ type: 'plan', etapes }),
        activite: (a) => direChantier({ type: 'activite', ...(a || { fini: true }) }),
        resultat: (r) => direChantier({ type: 'resultat', ...r }),
      },
    });
    const nom = r.branche.replace('catai/chantier-', '');
    const incomplet = r.etapes.filter((e) => e.ok).length < r.plan.length;
    chantierPrepare = null;
    chantierReprenable = incomplet ? { projet, nom, plan: r.plan, etapes: r.etapes, commit: r.commit, texte: reprise?.texte || preparation?.texte || texte } : null;
    const minutes = Math.max(1, Math.round((Date.now() - debut) / 60000));
    fs.writeFileSync(path.join(dossierCopies, `chantier-${nom}.md`), `${r.rapport}\n\nDurée : ${minutes} min.\n`);
    return { ok: true, nom, rapport: r.rapport, etapes: r.etapes, total: r.plan.length, incomplet, minutes, arrete: arret.signal.aborted, changements: resumeChantier(projet, nom) };
  } catch (err) {
    return { ok: false, erreur: arret.signal.aborted ? 'Chantier arrêté avant la première étape.' : err.message };
  } finally {
    chantierEnCours = null;
    powerSaveBlocker.stop(veille);
  }
});

ipcMain.handle('chantier-arreter', () => { chantierEnCours?.arret.abort(); return { ok: !!chantierEnCours }; });

// Garder : la branche du chantier est fusionnée dans le projet, après accord. C'est le seul moment où un chantier
// écrit dans les fichiers de l'utilisateur.
ipcMain.handle('chantier-garder', async (_e, nom) => {
  const projet = projectDir;
  if (chantierEnCours || !projet || !NOM_CHANTIER.test(String(nom))) return { ok: false, erreur: 'Chantier indisponible.' };
  const accord = await demanderAccord({
    titre: 'Garder le travail', message: 'Mettre le travail du chantier dans ton projet ?', accepter: 'Garder',
    detail: `${resumeChantier(projectDir, nom) || 'Aucun changement.'}\n\nLes fichiers de ${projectDir} seront modifiés. Tu pourras revenir en arrière avec git.`,
  });
  if (!accord) return { ok: false, annule: true };
  if (chantierEnCours || projet !== projectDir) return { ok: false, erreur: 'Le chantier ou le dossier a changé.' };
  const r = garderChantier(projet, nom);
  if (r.ok && chantierReprenable?.nom === nom) chantierReprenable = null;
  if (r.ok) { try { jeterChantier(projet, nom); } catch { /* la copie reste, sans gravité */ } }
  return r;
});

ipcMain.handle('chantier-jeter', async (_e, nom) => {
  const projet = projectDir;
  if (chantierEnCours || !projet || !NOM_CHANTIER.test(String(nom))) return { ok: false, erreur: 'Chantier indisponible.' };
  const accord = await demanderAccord({ titre: 'Jeter le travail', message: 'Jeter tout le travail de ce chantier ?', accepter: 'Jeter', detail: 'La copie et sa branche sont supprimées. Ton projet ne change pas.' });
  if (!accord) return { ok: false, annule: true };
  try {
    if (chantierEnCours || projet !== projectDir) return { ok: false, erreur: 'Le chantier ou le dossier a changé.' };
    jeterChantier(projet, nom);
    if (chantierReprenable?.nom === nom) chantierReprenable = null;
    return { ok: true };
  } catch (err) { return { ok: false, erreur: err.message }; }
});

// ---------- Mode Auto : Voir, Garder, Jeter la copie de l'agent ----------
// Les changements d'une copie (avec le patch pour la fenêtre « Voir »)
ipcMain.handle('agent-changements', (_e, demande = {}) => {
  const c = copieParNom(demande);
  if (!c) return { ok: false, perdue: true };
  try { return { ok: true, ...changementsCopie(c.copie, c.base, { patch: demande.patch === true }) }; }
  catch (err) { return { ok: false, erreur: err.message }; }
});

// Garder : un clic explicite de l'utilisateur, les changements vont dans ses fichiers (sans commit)
ipcMain.handle('agent-garder', (_e, demande = {}) => {
  const c = copieParNom(demande);
  if (!c) return { ok: false, perdue: true, erreur: "Cette copie n'existe plus." };
  if (copiesOccupees.has(c.nom)) return { ok: false, erreur: "L'agent écrit encore : attends la fin de sa réponse." };
  try { return garderCopie(c.copie, c.base, c.nom); } catch (err) { return { ok: false, erreur: err.message }; }
});

// Jeter : irréversible, donc confirmé dans une fenêtre
ipcMain.handle('agent-jeter', async (_e, demande = {}) => {
  const c = copieParNom(demande);
  if (!c) return { ok: false, perdue: true };
  if (copiesOccupees.has(c.nom)) return { ok: false, erreur: "L'agent écrit encore : attends la fin de sa réponse." };
  const accord = await demanderAccord({ titre: 'Jeter le travail', message: "Jeter les changements de l'agent ?", accepter: 'Jeter', detail: 'Sa copie et sa branche sont supprimées. Ton projet ne change pas.' });
  if (!accord) return { ok: false, annule: true };
  if (copiesOccupees.has(c.nom)) return { ok: false, erreur: "L'agent écrit encore : attends la fin de sa réponse." };
  try { return jeterCopie(depotDeLaCopie(c.copie), c.nom); } catch (err) { return { ok: false, erreur: err.message }; }
});

// Une seule app ouverte à la fois : deux fenêtres liraient et enregistreraient chacune leur version
// des discussions et des réglages, et la dernière qui enregistre effacerait le travail de l'autre.
// Relancer l'app ramène simplement la fenêtre déjà ouverte au premier plan.
// La commande catai (cli/catai.js) tourne sans Electron et ne peut pas lire les clés chiffrées. Pour un fournisseur
// en ligne, elle relance l'app en mode « appel » : pas de fenêtre, pas de verrou, une seule demande au modèle.
// La demande arrive dans un fichier temporaire (supprimé aussitôt lu), la réponse repart sur la sortie, une ligne
// JSON par morceau. La clé reste dans ce processus, et le garde-fou « jamais de modèle payant » s'applique.
const APPEL_CATAI = process.argv.indexOf('--catai-appel');
async function appelPourCatai(fichier) {
  const ecrire = (objet) => process.stdout.write(JSON.stringify(objet) + '\n');
  try {
    const { fournisseurId, modele, messages, options = {} } = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    fs.rmSync(fichier, { force: true });
    verifierGratuit(fournisseurId, modele);
    const envoyer = await envoyeurPour(fournisseurId);
    const resultat = await envoyer(messages, modele, (morceau) => ecrire({ morceau }), undefined, { ...options, onPause: (secondes) => ecrire({ pause: secondes }) });
    ecrire({ fin: resultat });
  } catch (err) {
    ecrire({ erreur: err.message });
  } finally {
    fs.rmSync(fichier, { force: true });
    app.exit(0);
  }
}

if (APPEL_CATAI >= 0) {
  app.disableHardwareAcceleration();
  app.whenReady().then(() => appelPourCatai(process.argv[APPEL_CATAI + 1]));
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(() => {
    demarrerOllama().then(prechaufferAuDemarrage);
    createWindow();
    // Une fois l'interface prête à écouter : elle affichera « Cat Ai x.y.z est sortie » s'il y a mieux sur GitHub
    win.webContents.once('did-finish-load', () => {
      configurerMiseAJour((etat) => win?.webContents.send('mise-a-jour', etat));
      menuLinux();
    });
  });
}

// Linux : propose une fois d'ajouter l'AppImage au menu des applications, puis garde l'entrée à jour
// (principal/menu-linux.js). Sans AppImage (npm start, Windows), il n'y a rien à faire.
async function menuLinux() {
  if (process.platform !== 'linux' || !process.env.APPIMAGE) return;
  try {
    await integrerMenu({
      appimage: process.env.APPIMAGE,
      dossierDonnees: process.env.XDG_DATA_HOME || path.join(app.getPath('home'), '.local', 'share'),
      icone: fs.readFileSync(path.join(__dirname, 'icone.png')),
      nomFenetre: app.getName(),
      choix: readJson('settings.json', {}).menuLinux,
      demander: async () => {
        const { response } = await dialog.showMessageBox(win, {
          type: 'question',
          buttons: ['Ajouter', 'Non merci'],
          defaultId: 0,
          cancelId: 1,
          title: 'Menu des applications',
          message: 'Ajouter Cat Ai au menu des applications ?',
          detail: "Tu pourras le lancer depuis le menu de ton bureau, avec son icône, comme une app installée. Laisse le fichier .AppImage là où il est : si tu le déplaces, relance-le une fois et le menu suivra.",
        });
        return response === 0;
      },
      enregistrerChoix: (choix) => writeJson('settings.json', { ...readJson('settings.json', {}), menuLinux: choix }),
    });
  } catch {
    // Un dossier en lecture seule ne doit pas empêcher l'app de démarrer
  }
}
app.on('window-all-closed', () => app.quit());
app.on('quit', () => serveurOllama?.kill());
