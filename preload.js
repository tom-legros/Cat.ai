const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Sans argument : modèles d'Ollama, comme avant
  models: (fournisseurId, options) => ipcRenderer.invoke('models', fournisseurId, options),
  // Fournisseurs : l'interface ne reçoit jamais les clés, seulement aCle (vrai / faux)
  lireFournisseurs: () => ipcRenderer.invoke('fournisseurs-lire'),
  enregistrerFournisseur: (payload) => ipcRenderer.invoke('fournisseurs-enregistrer', payload),
  choisirFournisseur: (payload) => ipcRenderer.invoke('fournisseurs-choisir', payload),
  lireAdresseMcp: () => ipcRenderer.invoke('mcp-lire-adresse'),
  enregistrerAdresseMcp: (adresse) => ipcRenderer.invoke('mcp-enregistrer-adresse', adresse),
  demandeMemoire: (texte) => ipcRenderer.invoke('memoire-demande', texte),
  chat: (payload) => ipcRenderer.send('chat', payload),
  stop: (id) => ipcRenderer.send('chat-stop', id),
  onChunk: (cb) => ipcRenderer.on('chat-chunk', (_e, d) => cb(d)),
  onChatEtat: (cb) => ipcRenderer.on('chat-etat', (_e, d) => cb(d)),
  onUndo: (cb) => ipcRenderer.on('chat-undo', (_e, d) => cb(d)),
  onTool: (cb) => ipcRenderer.on('chat-tool', (_e, d) => cb(d)),
  // Résumé d'une action terminée (« a lu main.js »), gardé dans l'historique de la discussion
  onAction: (cb) => ipcRenderer.on('chat-action', (_e, d) => cb(d)),
  onDone: (cb) => ipcRenderer.on('chat-done', (_e, d) => cb(d)),
  onError: (cb) => ipcRenderer.on('chat-error', (_e, d) => cb(d)),
  // Mode Auto : la copie de travail de l'agent (créée, ou ses changements à la fin d'une réponse)
  onAgent: (cb) => ipcRenderer.on('chat-agent', (_e, d) => cb(d)),
  agentChangements: (copie) => ipcRenderer.invoke('agent-changements', copie),
  agentGarder: (copie) => ipcRenderer.invoke('agent-garder', copie),
  agentJeter: (copie) => ipcRenderer.invoke('agent-jeter', copie),
  summarize: (payload) => ipcRenderer.invoke('summarize', payload),
  // Titre court proposé par le modèle après la première réponse (Ollama seulement)
  titreDiscussion: (payload) => ipcRenderer.invoke('titre-discussion', payload),
  onConfirmWrite: (cb) => ipcRenderer.on('confirm-write', (_e, d) => cb(d)),
  onConfirmCancel: (cb) => ipcRenderer.on('confirm-write-cancel', (_e, d) => cb(d)),
  replyConfirmWrite: (id, ok) => ipcRenderer.send('confirm-write-reply', { id, ok }),
  // Electron ne donne plus le chemin d'un fichier glissé directement : on passe par webUtils
  // Un fichier glissé arrive en File (webUtils retrouve son chemin) ; le bouton + passe un chemin du
  // sélecteur. Dans les deux cas, la lecture et ses vérifications se font dans main.js (read-dropped).
  readDropped: (file) => ipcRenderer.invoke('read-dropped', typeof file === 'string' ? file : webUtils.getPathForFile(file)),
  saveCode: (payload) => ipcRenderer.invoke('save-code', payload),
  openProject: () => ipcRenderer.invoke('open-project'),
  closeProject: () => ipcRenderer.invoke('close-project'),
  openProjectPath: (dir) => ipcRenderer.invoke('open-project-path', dir),
  projectContext: (message) => ipcRenderer.invoke('project-context', message),
  specialDirs: () => ipcRenderer.invoke('special-dirs'),
  dirExists: (dir) => ipcRenderer.invoke('dir-exists', dir),
  knownProjects: () => ipcRenderer.invoke('known-projects'),
  getProject: () => ipcRenderer.invoke('get-project'),
  // Bouton Terminal : ouvre catai (le CLI) dans une console
  ouvrirTerminal: () => ipcRenderer.invoke('ouvrir-terminal'),
  machineLegere: () => ipcRenderer.invoke('machine-legere'),
  onProjectChanged: (cb) => ipcRenderer.on('project-changed', (_e, p) => cb(p)),
  // Prénom de l'utilisateur, vide tant qu'il ne l'a pas donné
  getPrenom: () => ipcRenderer.invoke('get-prenom'),
  setPrenom: (prenom) => ipcRenderer.invoke('set-prenom', prenom),
  // Accueil du premier lancement : où en est Ollama, et téléchargement d'un modèle avec sa progression
  etatOllama: () => ipcRenderer.invoke('etat-ollama'),
  telechargerModele: (modele) => ipcRenderer.invoke('ollama-telecharger', modele),
  prechaufferOllama: (choix) => ipcRenderer.invoke('ollama-prechauffer', choix),
  etatPrechauffage: () => ipcRenderer.invoke('etat-prechauffage'),
  onPrechauffage: (cb) => ipcRenderer.on('prechauffage', (_e, etat) => cb(etat)),
  installerOllama: () => ipcRenderer.invoke('ollama-installer'),
  conseilMateriel: () => ipcRenderer.invoke('conseil-materiel'),
  // Pages Modèles et Agents
  catalogueModeles: () => ipcRenderer.invoke('modeles-catalogue'),
  lireEquipe: () => ipcRenderer.invoke('equipe-lire'),
  ajouterAgent: (parent, type, tests) => ipcRenderer.invoke('equipe-ajouter', { parent, type, tests }),
  retirerAgent: (id) => ipcRenderer.invoke('equipe-retirer', id),
  modifierAgent: (id, changement) => ipcRenderer.invoke('equipe-modifier', { id, changement }),
  remettreEquipe: () => ipcRenderer.invoke('equipe-remettre'),
  modeleVoitImages: (choix) => ipcRenderer.invoke('modele-voit-images', choix),
  // Bouton + du chat : sélecteur de fichier, puis lecture par readDropped (mêmes règles que le glisser-déposer)
  choisirFichier: (options) => ipcRenderer.invoke('choisir-fichier', options),
  // Capacités du modèle pour le sélecteur « Réflexion » du chat
  capacitesModele: (choix) => ipcRenderer.invoke('capacites-modele', choix),
  onProgressionOllama: (cb) => ipcRenderer.on('ollama-progression', (_e, p) => cb(p)),
  // Chantier depuis la page Agents : état du dossier, plan, lancement, suivi, puis garder ou jeter
  etatChantier: () => ipcRenderer.invoke('chantier-etat'),
  preparerChantier: () => ipcRenderer.invoke('chantier-preparer'),
  importerPlan: () => ipcRenderer.invoke('chantier-importer-plan'),
  lancerChantier: (plan, action, agent) => ipcRenderer.invoke('chantier-lancer', { plan, action, agent }),
  arreterChantier: () => ipcRenderer.invoke('chantier-arreter'),
  garderChantier: (nom) => ipcRenderer.invoke('chantier-garder', nom),
  jeterChantier: (nom) => ipcRenderer.invoke('chantier-jeter', nom),
  onChantier: (cb) => ipcRenderer.on('chantier-evenement', (_e, evenement) => cb(evenement)),
  // Touches personnelles facultatives (perso.json dans le dossier des données)
  perso: () => ipcRenderer.invoke('perso'),
  // Rôles créés dans Réglages : [{ nom, consigne }]
  onMiseAJour: (cb) => ipcRenderer.on('mise-a-jour', (_e, etat) => cb(etat)),
  telechargerMiseAJour: () => ipcRenderer.invoke('maj-telecharger'),
  installerMiseAJour: () => ipcRenderer.invoke('maj-installer'),
  loadMemory: () => ipcRenderer.invoke('load-memory'),
  saveMemory: (m) => ipcRenderer.invoke('save-memory', m),
  onMemoryChanged: (cb) => ipcRenderer.on('memory-changed', (_e, m) => cb(m)),
  // Le chat vient de retenir un fait tout seul : { fait, remplace }
  onMemoireAjout: (cb) => ipcRenderer.on('memoire-ajout', (_e, ajout) => cb(ajout)),
  loadConvs: () => ipcRenderer.invoke('load-convs'),
  saveConvs: (convs) => ipcRenderer.invoke('save-convs', convs),
  // Fichiers de données abîmés et réparés au démarrage (voir readJson dans main.js)
  alertesStockage: () => ipcRenderer.invoke('alertes-stockage'),
  onAlertesStockage: (cb) => ipcRenderer.on('alertes-stockage', (_e, alertes) => cb(alertes)),
});
