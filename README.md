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
- **Chercher dans le projet** : pour savoir où une fonction ou un texte est utilisé, il fouille tous les fichiers d'un coup (`chercher`, texte ou expression régulière) au lieu de les lire un par un. Les fichiers sensibles, binaires ou trop gros ne sont pas fouillés.
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
- **Mémoire** : il retient ce que je lui dis sur moi et mes projets, d'une discussion à l'autre. Quand il retient quelque chose tout seul, c'est affiché sous « Mémoire » avec un bouton « Annuler ». Pas de doublons (un fait plus complet remplace l'ancien), et 40 faits au plus, car toute la mémoire est relue à chaque message.
- **Il se souvient de ce qu'il a fait** : d'un message à l'autre, il garde une ligne par action (« a lu main.js », « a modifié style.css », « L’utilisateur a refusé… »), sans le contenu des fichiers pour ne pas remplir le contexte. Il ne relit pas tout, et ne prétend pas avoir modifié un fichier qu'il n'a pas touché.
- **Résumé automatique** : quand une discussion devient trop longue, il résume le début pour ne pas l'oublier.
- **Place dans le contexte** : avec Ollama (8 192 tokens), chaque envoi est allégé par l'app elle-même, pour qu'un gros fichier lu ne fasse jamais disparaître ma question. Les fichiers cités sont joints dans une limite raisonnable (le chat lit la suite avec `lire_fichier`, à partir de la ligne voulue), et si les consignes deviennent trop lourdes, la réponse commence par un avertissement.
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

**Processus principal** (accès au disque, aux clés et au modèle) :

| Fichier | Rôle |
| --- | --- |
| `main.js` | Le chef d'orchestre : fenêtre, lancement d'Ollama, boucle d'outils du modèle, confirmations (avant / après, fichiers sensibles), échanges avec l'interface |
| `principal/outils.js` | Les outils proposés au modèle, ce que chaque mode ou rôle peut écrire, `remplacer_texte` |
| `principal/fichiers.js` | Fichiers du projet : chemins sûrs, fichiers sensibles, liste, recherche, fichiers cités |
| `principal/envoi.js` | Envoi au modèle : Ollama, ou un fournisseur compatible OpenAI (streaming, limites, erreurs) |
| `principal/fournisseurs.js` | Fournisseurs et clés API chiffrées, liste des modèles |
| `principal/gratuit.js` | La règle « 100 % gratuit » : adresses et modèles autorisés |
| `principal/taille.js` | Garder chaque envoi sous la limite du fournisseur |
| `principal/stockage.js` | Écriture atomique, sauvegarde et réparation des données |

Les modules de `principal/` ne dépendent pas d'Electron (sauf les clés, dans `fournisseurs.js`) : ils se testent avec Node seul.

**Interface** (une page web enfermée, sans accès au disque) :

| Fichier | Rôle |
| --- | --- |
| `preload.js` | Pont sécurisé entre l'interface et le processus principal |
| `interface/personnalite.js` | Nom, répliques, rôles et consignes données au modèle |
| `interface/markdown.js` | Rendu des réponses (Markdown, code coloré, étiquettes d'action) |
| `interface/modeles.js` | Choix des modèles : le conseillé ★, les gourmands ▲ |
| `interface/difference.js` | Calcul de la fenêtre avant / après |
| `renderer.js` | Le reste de l'interface : discussion, envoi, accueil, projet, mémoire, fournisseurs, démarrage |
| `chat.js` | Le chat noir en pixel art (sprite, animations, expressions) |
| `style.css` | La DA, reprise de mon portfolio |
| `outils/generer-icone.js` | Génère l'icône en pixel art à partir du sprite : `icone.png` et `icone-pixel.ico` (`node outils/generer-icone.js`) |

Les données (discussions, mémoire, réglages, clés chiffrées dans `fournisseurs.json`) sont dans `%APPDATA%\assistant-ia`, jamais dans le projet.

Elles ne peuvent pas être perdues par un plantage :
- **Écriture atomique** : chaque fichier est d'abord écrit à côté, puis remplace l'ancien d'un seul coup. Un plantage ou une coupure de courant laisse l'ancienne version ou la nouvelle, jamais un fichier à moitié écrit.
- **Sauvegarde** : avant chaque enregistrement, la version précédente est gardée dans `nom.json.sauvegarde`.
- **Réparation** : un fichier abîmé n'est jamais écrasé. Il est mis de côté (`nom.json.illisible-date`), l'app repart de la sauvegarde et le chat prévient dans la discussion.
- **Une seule app à la fois** : la relancer ramène la fenêtre déjà ouverte, pour que deux fenêtres n'enregistrent pas chacune leur version par-dessus l'autre.

## Tests

```bash
npm test
```

Les tests utilisent `node --test`, le lanceur intégré à Node : aucune dépendance en plus, et pas besoin de lancer Electron.
Ils sont dans `tests/` et vérifient d'abord les garde-fous :

| Fichier | Ce qu'il vérifie |
| --- | --- |
| `gratuit.test.js` | Aucun fournisseur ni modèle payant ne passe, même avec une adresse déguisée |
| `outils.test.js` | Ce que chaque mode ou rôle peut écrire, `remplacer_texte` (0, 1 ou plusieurs passages), appels d'outils écrits en texte |
| `fichiers.test.js` | Sur un projet piégé (lien qui mène dehors, lien cassé, `.env`, binaire) : le chat reste dans le dossier, les secrets ne partent pas |
| `stockage.test.js` | Écriture atomique, sauvegarde, réparation d'un fichier abîmé (dans un dossier temporaire, jamais les vraies données) |
| `taille.test.js` | Rester sous la limite d'un fournisseur sans casser la discussion |
| `envoi.test.js` | Formats Ollama / OpenAI, erreurs des fournisseurs, attente après une limite |
| `modeles.test.js` | Choix du modèle conseillé ★ et repérage des gourmands ▲ |

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
