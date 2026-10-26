const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Sans argument : modèles d'Ollama, comme avant
  models: (fournisseurId) => ipcRenderer.invoke('models', fournisseurId),
  // Fournisseurs : l'interface ne reçoit jamais les clés, seulement aCle (vrai / faux)
  lireFournisseurs: () => ipcRenderer.invoke('fournisseurs-lire'),
  enregistrerFournisseur: (payload) => ipcRenderer.invoke('fournisseurs-enregistrer', payload),
  choisirFournisseur: (payload) => ipcRenderer.invoke('fournisseurs-choisir', payload),
  chat: (payload) => ipcRenderer.send('chat', payload),
  stop: (id) => ipcRenderer.send('chat-stop', id),
  onChunk: (cb) => ipcRenderer.on('chat-chunk', (_e, d) => cb(d)),
  onUndo: (cb) => ipcRenderer.on('chat-undo', (_e, d) => cb(d)),
  onTool: (cb) => ipcRenderer.on('chat-tool', (_e, d) => cb(d)),
  onDone: (cb) => ipcRenderer.on('chat-done', (_e, d) => cb(d)),
  onError: (cb) => ipcRenderer.on('chat-error', (_e, d) => cb(d)),
  summarize: (payload) => ipcRenderer.invoke('summarize', payload),
  onConfirmWrite: (cb) => ipcRenderer.on('confirm-write', (_e, d) => cb(d)),
  onConfirmCancel: (cb) => ipcRenderer.on('confirm-write-cancel', () => cb()),
  replyConfirmWrite: (id, ok) => ipcRenderer.send('confirm-write-reply', { id, ok }),
  // Electron ne donne plus le chemin d'un fichier glissé directement : on passe par webUtils
  readDropped: (file) => ipcRenderer.invoke('read-dropped', webUtils.getPathForFile(file)),
  saveCode: (payload) => ipcRenderer.invoke('save-code', payload),
  openProject: () => ipcRenderer.invoke('open-project'),
  closeProject: () => ipcRenderer.invoke('close-project'),
  openProjectPath: (dir) => ipcRenderer.invoke('open-project-path', dir),
  projectContext: (message) => ipcRenderer.invoke('project-context', message),
  specialDirs: () => ipcRenderer.invoke('special-dirs'),
  dirExists: (dir) => ipcRenderer.invoke('dir-exists', dir),
  knownProjects: () => ipcRenderer.invoke('known-projects'),
  getProject: () => ipcRenderer.invoke('get-project'),
  onProjectChanged: (cb) => ipcRenderer.on('project-changed', (_e, p) => cb(p)),
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
