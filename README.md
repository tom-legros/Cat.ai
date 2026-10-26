# Cat Ai

Un assistant de code de bureau, avec un chat noir en pixel art. Il lit ton code, répond à tes questions et peut modifier tes fichiers, toujours après ton accord.

**100 % gratuit** : il tourne avec [Ollama](https://ollama.com) sur ton PC, ou avec l'offre gratuite d'un fournisseur en ligne (Gemini, Groq, OpenRouter). Aucun modèle payant ne peut être utilisé.

![L'accueil de Cat Ai](docs/accueil.png)

## Tuto : prêt en 3 étapes

### 1. Télécharger

Va dans les [Releases](https://github.com/tom-legros/Cat.ai/releases/latest) et prends le fichier de ton système :

- **Windows** : `Cat-Ai-1.0.0-installateur.exe`
- **Linux** : `Cat-Ai-1.0.0.AppImage`

### 2. Installer

- **Windows** : double-clique sur l'installateur. L'app n'est pas signée (un certificat coûte cher), donc Windows affiche « Windows a protégé votre ordinateur » : clique sur **Informations complémentaires**, puis **Exécuter quand même**. Pas besoin d'être administrateur.
- **Linux** : `chmod +x Cat-Ai-1.0.0.AppImage && ./Cat-Ai-1.0.0.AppImage` (sur Arch, il peut falloir `fuse2`).

### 3. Premier lancement

Le chat te demande ton prénom :

![Le chat demande ton prénom](docs/prenom.png)

Puis il te propose deux façons gratuites de le faire parler :

![Les deux façons d'avoir un modèle](docs/premier-lancement.png)

| | Ollama | Gemini |
| --- | --- | --- |
| Pour qui | Les PC puissants (type PC gamer récent). Sur un PC portable classique, il sera très lent | Tout le monde, même sur un petit PC |
| Comment | Clique sur « Télécharger » (5 Go, une seule fois) | Crée une [clé gratuite](https://aistudio.google.com/apikey), colle-la, « C'est prêt » |
| Tes données | Ne sortent pas de ton PC | Partent chez Google |

C'est tout : pose ta question en bas, ou clique sur une suggestion.

Pour aller plus loin, ouvre **Réglages avancés** dans la barre de gauche : mode prof, rôles, choix du modèle et autres clés (Groq, OpenRouter).

![Les réglages avancés](docs/reglages.png)

## Ce qu'il sait faire

- **Lire ton projet** : il ouvre un dossier, lit et cherche dans le code, et répond à partir du vrai code.
- **Modifier des fichiers** : chaque modification s'affiche avant / après, et rien n'est écrit sans ton accord.
- **Pour tout le monde** : il explique, aide à écrire, apprend à coder depuis zéro.
- **Mode prof** : il explique et pose des questions, mais c'est toi qui codes.
- **Rôles** : relecteur (liste les problèmes sans rien toucher), débogueur, rédacteur de README.
- **Mémoire** : il retient ce que tu lui dis d'une discussion à l'autre, et tu peux tout modifier.
- **Sécurité** : un `.env` ou une clé privée n'est jamais lu sans ton accord, les clés API sont chiffrées par le système, et le chat ne sort jamais du dossier ouvert.

## Lancer depuis le code

Il faut [Node.js](https://nodejs.org).

```bash
npm install
npm start
```

| Commande | Rôle |
| --- | --- |
| `npm test` | Lance les tests (`node --test`, sans Electron) |
| `npm run installateur` | Crée l'installateur Windows dans `dist/` |
| `npm run installateur:linux` | Crée l'AppImage (à lancer depuis Linux ou WSL) |

Le code est séparé en deux : `main.js` et `principal/` pour le processus principal (fichiers, modèles, garde-fous), `renderer.js` et `interface/` pour la fenêtre. Les données (discussions, mémoire, clés chiffrées) sont dans `%APPDATA%\assistant-ia` sur Windows et `~/.config/assistant-ia` sur Linux.

## Crédits

- [Electron](https://github.com/electron/electron), [marked](https://github.com/markedjs/marked), [DOMPurify](https://github.com/cure53/DOMPurify), [highlight.js](https://github.com/highlightjs/highlight.js) et [jsdiff](https://github.com/kpdecker/jsdiff).
- [Ollama](https://github.com/ollama/ollama) et les modèles [Qwen](https://github.com/QwenLM/Qwen3) (Apache-2.0).
- Polices sous SIL Open Font License : [Pixelify Sans](https://github.com/eifetx/Pixelify-Sans), [Jost](https://github.com/indestructible-type/Jost), [Marcellus](https://fonts.google.com/specimen/Marcellus), [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono).
- Le chat noir et sa DA viennent de mon portfolio. Application développée avec l'aide de Claude (Anthropic) via Claude Code.

## Licence

[MIT](LICENSE)
