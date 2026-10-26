# Le chat noir

Un assistant de code de bureau : le chat noir de mon portfolio, en pixel art, qui m'aide sur mes projets.
Il lit mon code, répond à mes questions et peut modifier des fichiers (toujours avec mon accord).

Application faite avec Electron. Le modèle d'IA au choix :
- **Ollama, en local** : tout reste sur mon PC, gratuit et sans limite (par défaut `qwen3:8b`).
- **Un fournisseur en ligne compatible OpenAI** : Gemini, Groq, OpenRouter, ou un autre serveur sur mon PC (LM Studio…).
  Plus rapide et plus intelligent, mais les messages, la mémoire et les fichiers lus partent sur les serveurs
  du fournisseur, et les offres gratuites ont des limites.

**100 % gratuit** : l'app n'utilise que des modèles gratuits, rien ne peut être facturé.
Gemini : seulement les modèles « flash ». OpenRouter : seulement les « :free ». Groq : son offre gratuite.
Toute autre adresse en ligne (OpenAI, Anthropic, Mistral…) est refusée. Un modèle payant n'apparaît pas dans la liste,
et s'il arrivait quand même jusqu'à l'envoi, rien ne partirait.

## Ce qu'il sait faire

- **Discuter de mes projets** : il ouvre un dossier quand je le cite (« regarde mon portfolio »), lit les fichiers et s'appuie sur le vrai code.
- **Modifier des fichiers** : chaque modification passe par une fenêtre avant / après (lignes retirées et ajoutées) que je dois valider.
  Pour corriger un fichier, il ne remplace que le passage concerné (`remplacer_texte`) au lieu de tout réécrire : c'est plus rapide, et un petit modèle n'abîme plus le reste du fichier. Le passage doit apparaître une seule fois, sinon il doit préciser (ou demander à tout remplacer, pour un renommage).
  Une écriture refusée (par moi, le mode prof ou le rôle) s'affiche dans la réponse, même si le modèle prétend le contraire.
- **Fichiers sensibles protégés** : le contenu d'un `.env`, d'une clé privée (`.pem`, `id_rsa`…) ou d'un fichier de jetons (`.npmrc`…) n'est jamais joint tout seul à un message. Si le chat veut en lire un, une fenêtre me demande mon accord et me dit si le contenu resterait sur mon PC ou partirait en ligne. Les modèles comme `.env.example` restent lisibles.
- **Il reste dans le dossier ouvert**, même si un lien symbolique ou une jonction Windows mène ailleurs.
- **Mode prof** : il explique, donne des pistes et me pose des questions, mais n'écrit pas le code à ma place.
- **Rôles** : une seule mission à la fois, pour qu'il reste concentré (surtout avec un petit modèle local). Choix dans la barre de gauche :
  - **Relecteur de code** : lit le code et liste les problèmes (bugs, sécurité, lisibilité, performance), sans rien modifier.
  - **Débogueur** : cherche la cause d'un bug et propose la plus petite correction.
  - **Rédacteur README** : écrit ou met à jour la doc à partir du vrai code, et ne peut écrire que des fichiers `.md`.

  Ce que chaque rôle a le droit d'écrire est vérifié dans `main.js`, pas seulement demandé au modèle. Le mode prof passe avant le rôle.
- **Mémoire** : il retient ce que je lui dis sur moi et mes projets, d'une discussion à l'autre.
- **Résumé automatique** : quand une discussion devient trop longue, il résume le début pour ne pas l'oublier.
- **Glisser-déposer** : je lâche un fichier sur la fenêtre pour qu'il le lise.
- **Plusieurs fournisseurs** : choix du fournisseur et du modèle dans la barre de gauche ; seuls les modèles capables de discuter sont proposés, et un modèle qui n'existe plus est retiré tout seul. Le modèle conseillé (bon en code, sans vider le quota gratuit) a une étoile ★, ceux qui vident vite le quota un ▲.
- **Clés API protégées** : saisies dans le panneau « Clés API », chiffrées par Windows (`safeStorage`), jamais réaffichées ni envoyées à l'interface.
- **Le chat** : il cligne des yeux, suit la souris, s'endort quand je ne fais rien, sautille quand il a fini de répondre, et a des répliques selon l'heure et le projet ouvert.

## Installation

Il faut [Node.js](https://nodejs.org) et [Ollama](https://ollama.com).

```bash
npm install
ollama pull qwen3:8b
npm start
```

L'application lance Ollama toute seule en arrière-plan si besoin.
Pour un fournisseur en ligne : « Clés API » dans la barre de gauche, coller la clé, puis le choisir dans « Fournisseur ».
Sur Windows, `Lancer.bat` démarre l'app sans fenêtre de console.

## Organisation

| Fichier | Rôle |
| --- | --- |
| `main.js` | Processus principal : fenêtre, Ollama et fournisseurs en ligne, clés chiffrées, outils du modèle (lire, écrire, mémoriser) et ce que chaque mode ou rôle peut écrire, confirmations |
| `preload.js` | Pont sécurisé entre l'interface et le processus principal |
| `renderer.js` | Interface : discussion, personnalité du chat, mode prof, rôles (consignes), avant / après, résumé |
| `chat.js` | Le chat noir en pixel art (sprite, animations, expressions) |
| `style.css` | La DA, reprise de mon portfolio |
| `outils/generer-icone.js` | Génère l'icône en pixel art à partir du sprite : `icone.png` et `icone-pixel.ico` (`node outils/generer-icone.js`) |

Les données (discussions, mémoire, réglages, clés chiffrées dans `fournisseurs.json`) sont dans `%APPDATA%\assistant-ia`, jamais dans le projet.

Elles ne peuvent pas être perdues par un plantage :
- **Écriture atomique** : chaque fichier est d'abord écrit à côté, puis remplace l'ancien d'un seul coup. Un plantage ou une coupure de courant laisse l'ancienne version ou la nouvelle, jamais un fichier à moitié écrit.
- **Sauvegarde** : avant chaque enregistrement, la version précédente est gardée dans `nom.json.sauvegarde`.
- **Réparation** : un fichier abîmé n'est jamais écrasé. Il est mis de côté (`nom.json.illisible-date`), l'app repart de la sauvegarde et le chat prévient dans la discussion.
- **Une seule app à la fois** : la relancer ramène la fenêtre déjà ouverte, pour que deux fenêtres n'enregistrent pas chacune leur version par-dessus l'autre.

## Crédits

Ce projet s'appuie sur le travail d'autres personnes, merci à elles.

### Bibliothèques

| Projet | Utilisé pour | Licence |
| --- | --- | --- |
| [Electron](https://github.com/electron/electron) | L'application de bureau | MIT |
| [marked](https://github.com/markedjs/marked) | Transformer les réponses (Markdown) en HTML | MIT |
| [DOMPurify](https://github.com/cure53/DOMPurify) de Cure53 | Nettoyer ce HTML pour que le modèle ne puisse rien injecter | MPL-2.0 ou Apache-2.0 |
| [highlight.js](https://github.com/highlightjs/highlight.js) | Colorer le code dans les réponses | BSD-3-Clause |
| [jsdiff](https://github.com/kpdecker/jsdiff) | Calculer les différences de la fenêtre avant / après | BSD-3-Clause |

### IA

| Projet | Utilisé pour | Licence |
| --- | --- | --- |
| [Ollama](https://github.com/ollama/ollama) | Faire tourner le modèle sur la carte graphique | MIT |
| [Qwen3](https://github.com/QwenLM/Qwen3) de l'équipe Qwen (Alibaba) | Le modèle par défaut (`qwen3:8b`) | Apache-2.0 |
| [Qwen2.5-Coder](https://github.com/QwenLM/Qwen2.5-Coder) de l'équipe Qwen (Alibaba) | Modèle secondaire (`qwen2.5-coder:7b`) | Apache-2.0 |

### Polices (SIL Open Font License)

- [Jost](https://github.com/indestructible-type/Jost) par Owen Earl (indestructible type*)
- [Marcellus](https://fonts.google.com/specimen/Marcellus) par Astigmatic
- [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) par JetBrains

### Le reste

- Le chat noir, son sprite et sa DA viennent de mon portfolio.- Application développée avec l'aide de Claude (Anthropic) via Claude Code.

## Licence

MIT
