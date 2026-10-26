# Cat Ai

Un chat noir en pixel art qui vit sur ton PC et t'aide pour tout : expliquer un sujet, écrire un message, réviser, apprendre à coder. Il sait aussi lire ton code et le modifier, toujours après ton accord.

**100 % gratuit** : il tourne avec [Ollama](https://ollama.com) sur ton PC, ou avec l'offre gratuite d'un fournisseur en ligne (Gemini, Groq, OpenRouter). Aucun modèle payant ne peut être utilisé.

![L'accueil de Cat Ai](docs/accueil.png)

## Tuto : prêt en 3 étapes

### 1. Télécharger

Va dans les [Releases](https://github.com/tom-legros/Cat.ai/releases/latest) et prends le fichier de ton système :

- **Windows** : `Cat-Ai-1.0.1-installateur.exe`
- **Linux** : `Cat-Ai-1.0.1.AppImage`

### 2. Installer

- **Windows** : double-clique sur l'installateur. L'app n'est pas signée (un certificat coûte cher), donc Windows affiche « Windows a protégé votre ordinateur » : clique sur **Informations complémentaires**, puis **Exécuter quand même**. Pas besoin d'être administrateur.
  - **« Le Contrôle intelligent des applications a bloqué… »** : c'est une protection plus stricte de Windows 11, qui bloque toute app non signée, sans bouton pour passer outre. L'app n'est pas dangereuse, Windows ne la connaît juste pas encore. La signature est en cours (voir [Signature du code](#signature-du-code)). En attendant, la seule solution est de désactiver cette protection dans Sécurité Windows → Contrôle des applications et du navigateur → Paramètres du Contrôle intelligent des applications. C'est une protection de ton PC : ne la coupe que si tu es à l'aise avec ça, et sache que selon ta version de Windows tu ne pourras peut-être pas la réactiver sans réinitialiser Windows.
- **Linux** : `chmod +x Cat-Ai-1.0.1.AppImage && ./Cat-Ai-1.0.1.AppImage` (sur Arch, il peut falloir `fuse2`).

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

## Sous la barre de saisie

Tout se règle d'un clic, sans fouiller dans les menus :

- **Dossier** : ouvre un dossier pour que le chat lise son contenu.
- **Mode prof** : il t'aide à trouver par toi-même, sans donner la réponse.
- **Rôle** : la mission du chat (Assistant, Rédaction, ou ceux pour coder). « Créer un rôle » pour inventer le tien : Coach de révisions, Cuisinier…
- **Fournisseur** et **Modèle** : qui fait réfléchir le chat, et quelle version. Chaque choix a un petit conseil, et le rond montre ce qu'il reste du quota gratuit du jour.

![Le menu des modèles, avec leurs conseils](docs/menu-modeles.png)

![Le menu des rôles](docs/menu-roles.png)

Les clés gratuites (Gemini, Groq, OpenRouter) se collent dans **Réglages**, en bas à gauche, avec un lien « Obtenir une clé » pour chacune.

![Les réglages](docs/reglages.png)

## Ce qu'il sait faire

- **Lire ton projet** : il ouvre un dossier, lit et cherche dans le code, et répond à partir du vrai code.
- **Modifier des fichiers** : chaque modification s'affiche avant / après, et rien n'est écrit sans ton accord.
- **Pour tout le monde** : il explique, aide à écrire, fait réviser, apprend à coder depuis zéro.
- **Mode prof** : il explique et pose des questions, mais c'est toi qui trouves.
- **Rôles** : Rédaction, ceux pour coder (relecteur, débogueur, README), et les tiens.
- **Un vrai chat** : il cligne des yeux, suit ta souris, s'endort quand tu ne fais rien et a toujours une réplique selon l'heure.
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

## Signature du code

L'installateur Windows est construit automatiquement par GitHub Actions à partir de ce dépôt ([`.github/workflows/installateur-windows.yml`](.github/workflows/installateur-windows.yml)). Une demande de signature gratuite pour les projets open source est en cours auprès de SignPath Foundation. Une fois acceptée, chaque installateur sera signé ainsi :

> Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

Tant que cette phrase n'est pas accompagnée d'un installateur signé dans les [Releases](https://github.com/tom-legros/Cat.ai/releases), les installateurs ne sont pas encore signés.

**Rôles** :

- Auteurs, relecteurs et approbateurs : [les membres du dépôt](https://github.com/tom-legros/Cat.ai/graphs/contributors) ayant les droits d'écriture (aujourd'hui, uniquement [tom-legros](https://github.com/tom-legros)).
- Chaque signature est approuvée à la main avant d'être publiée.

**Vie privée** : cette application n'envoie aucune information vers un autre système, sauf quand l'utilisateur le demande. Tes messages partent uniquement vers le fournisseur que tu choisis (Ollama sur ton PC, ou Gemini, Groq ou OpenRouter avec ta propre clé), selon leurs règles de confidentialité : [Google](https://policies.google.com/privacy), [Groq](https://groq.com/privacy-policy/), [OpenRouter](https://openrouter.ai/privacy). Il n'y a ni statistiques ni pistage.

## Crédits

- [Electron](https://github.com/electron/electron), [marked](https://github.com/markedjs/marked), [DOMPurify](https://github.com/cure53/DOMPurify), [highlight.js](https://github.com/highlightjs/highlight.js) et [jsdiff](https://github.com/kpdecker/jsdiff).
- [Ollama](https://github.com/ollama/ollama) et les modèles [Qwen](https://github.com/QwenLM/Qwen3) (Apache-2.0).
- Polices sous SIL Open Font License : [Pixelify Sans](https://github.com/eifetx/Pixelify-Sans), [Jost](https://github.com/indestructible-type/Jost), [Marcellus](https://fonts.google.com/specimen/Marcellus), [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono).
- Le chat noir et sa DA viennent de mon portfolio. Application développée avec l'aide de Claude (Anthropic) via Claude Code.

## Licence

[MIT](LICENSE)
