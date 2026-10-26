# Cat Ai

Un assistant de code de bureau open source : le chat noir en pixel art qui vous aide dans vos projets, lit votre code, répond à vos questions et peut modifier vos fichiers (toujours après validation).

Développé avec **Electron**, il fonctionne soit avec **Ollama** en local (100 % gratuit et privé, par défaut `qwen2.5-coder:7b` ou `qwen3:8b`), soit avec un fournisseur d'IA en ligne compatible OpenAI (Gemini, Groq, OpenRouter) avec une politique stricte garantissant l'utilisation exclusive de modèles gratuits.

---

## Fonctionnalités clés

- **Exploration de projet** : Ouvre un dossier, lit le code source et s'appuie dessus pour contextualiser ses réponses.
- **Recherche globale** : Fouille rapidement dans les fichiers du projet (`chercher`, texte ou expression régulière) en ignorant automatiquement les dossiers sensibles ou binaires.
- **Modification sécurisée** : Chaque modification de fichier passe par une interface avant/après (diff) avec validation obligatoire. Utilise un remplacement chirurgical (`remplacer_texte`) pour préserver le reste du code.
- **Protection des données sensibles** : Bloque l'envoi automatique de fichiers critiques (`.env`, clés privées, etc.) sans accord explicite.
- **Rôles spécialisés** :
  - *Relecteur de code* (analyse sans modifier)
  - *Débogueur* (recherche de bugs et propositions de correctifs)
  - *Rédacteur README* (génération de documentation au format `.md`)
- **Mode Prof** : Explique et guide sans jamais écrire le code à votre place.
- **Mémoire persistante** : Retient les informations clés sur vous et vos projets d'une session à l'autre (avec gestion des doublons et limite de 40 faits).
- **Sécurité des clés API** : Chiffrement natif via le système (`safeStorage` Windows/Linux).
- **Compagnon animé** : Un chat noir en pixel art interactif qui réagit à vos actions et à l'heure de la journée.

---

## Installation et lancement

### Prérequis (pour lancer depuis le code)
- [Node.js](https://nodejs.org)
- [Ollama](https://ollama.com) (pour l'usage local)

### Commandes de démarrage
```bash
npm install
ollama pull qwen2.5-coder:7b
npm start
```

### Construction des installateurs
```bash
# Windows (crée un installateur NSIS dans dist/)
npm run installateur

# Linux (crée une AppImage)
npm run installateur:linux
```

---

## Structure du projet

- **Processus principal (`main.js` et dossier `principal/`)** : Gestion des fenêtres, liaison avec Ollama/fournisseurs, sécurité des fichiers et exécution des outils.
- **Interface (`renderer.js` et dossier `interface/`)** : Rendu web sécurisé via `preload.js`, gestion du chat animé, du Markdown et des fenêtres de diff.
- **Tests (`tests/`)** : Suite de tests unitaires intégrée (`node --test`) vérifiant la sécurité, la gestion des fichiers et les contraintes de gratuité.

---

## Tests

Pour lancer la suite de tests automatisés :
```bash
npm test
```

---

## Licence

Distribué sous licence [MIT](LICENSE).
