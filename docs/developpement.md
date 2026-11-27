# Développer Cat Ai

Tout ce qui sert à travailler sur le code. Pour utiliser l'app, voir le [README](../README.md).

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

Une release contient 4 fichiers, tous dans `dist/` : l'installateur Windows, l'AppImage, `latest.yml` et `latest-linux.yml` (lus par la mise à jour automatique des versions installées). Les messages de commit suivent la forme `type: description` (`feat`, `fix`, `chore`, `docs`, `test`, `refactor`).

Le code est séparé en deux : `main.js` et `principal/` pour le processus principal (fichiers, modèles, garde-fous), `renderer.js` et `interface/` pour la fenêtre. Les données (discussions, mémoire, clés chiffrées) sont dans `%APPDATA%\assistant-ia` sur Windows et `~/.config/assistant-ia` sur Linux.

## La commande `catai`

Le même chat, sans fenêtre, et même app fermée : il démarre Ollama lui-même. Sous Windows, l'installateur ajoute la commande tout seul ; sous Linux, clique sur **Installer** dans Réglages › Avancé › Commande catai.

```bash
catai                      # le chat s'ouvre dans le dossier courant ; tape / pour ses commandes (/modele, /dossier, /prof, /copier…)
catai "explique main.js"   # une question, puis il rend la main
```

Comme dans l'app, chaque modification de fichier est montrée avant d'être écrite et attend ton accord. La sélection à la souris, le copier-coller et la molette marchent comme dans n'importe quel terminal ; un texte collé de plusieurs lignes part en un seul message.

**Sur un petit PC ou un serveur, sans écran.** Node et Ollama suffisent, Electron n'est pas nécessaire :

```bash
npm install --omit=dev
npm link        # la commande catai devient disponible partout
catai
```

Sans l'app, seuls les modèles d'Ollama sont utilisables : les clés des fournisseurs en ligne sont gardées par l'app.

## Tests

Les tests se lancent sur le PC avant chaque commit (`npm test`). Le workflow `installateur-windows.yml` ne tourne que pour un tag de version ou à la main.

### Lancer les tests soi-même

Prérequis : **Node.js 22 à jour**, npm et Git accessibles dans le terminal. Depuis le dossier du projet :

```bash
npm ci
npm test
```

`npm test` utilise `node:test` et `node:assert/strict`, fournis avec Node : aucun framework de test supplémentaire. Les tests n'ont besoin ni d'un modèle Ollama, ni d'une clé API, ni d'une fenêtre Electron. Ils créent des fichiers et dépôts temporaires ; les réponses réseau des tests de sécurité sont simulées. L'installation des dépendances et les builds nécessitent internet.

Pour vérifier seulement une protection :

```bash
node --test tests/confirmation-chemin.test.js
node --test tests/secrets-liens.test.js tests/secrets-renommes.test.js
```

Pour construire un installateur localement après les tests :

```bash
npm run installateur        # Windows
npm run installateur:linux  # Linux
```

Les fichiers arrivent dans `dist/`. Installe les dépendances séparément sur chaque système : ne partage pas `node_modules` entre Windows et Linux.

### Ce que vérifient les tests de sécurité

| Fichier | Rôle |
| --- | --- |
| `tests/chemins-courts-windows.test.js` | Vérifie les copies Git avec les noms courts Windows (8.3), sans modifier le projet original. Ces deux tests sont ignorés sous Linux ou si le volume Windows ne fournit pas de noms courts. |
| `tests/confirmation-chemin.test.js` | Accord/refus, annulation et remplacement de la destination pendant la confirmation, pour créer ou modifier un fichier. |
| `tests/secrets-liens.test.js` | Variantes de casse et lien symbolique vers un fichier sensible ; exclusion des pièces jointes, de la recherche et lecture soumise à accord. |
| `tests/secrets-renommes.test.js` | Secrets reconnaissables après renommage, documents joints et contenu stable pendant la confirmation de lecture. |
| `tests/securite-ipc.test.js` | Vrais handlers avec interface simulée : refus de stockage sans coffre, pièces jointes et bouton Enregistrer. |
| `tests/dependances-securite.test.js` | Vérifie le vrai rendu KaTeX et le refus des options de confiance héritées. |
| `tests/fournisseurs.test.js` | Coffre indisponible, backend Linux `basic_text`, clé illisible et absence de clés dans les données envoyées à l'interface. Le coffre est simulé. |
| `tests/connecteur-mcp.test.js` | Adresses locales, outils déclarés en lecture seule, interdiction des redirections et fermeture de session. |
| `tests/web.test.js` | Tests existants complétés par le contrôle DNS et les redirections vers le réseau privé, sans accès réseau réel. |
| `tests/helpers/charger-module.cjs` | Charge un vrai module en remplaçant uniquement les dépendances externes nécessaires au test. |
| `tests/helpers/machine-normale.cjs` | Rend les tests du mode normal indépendants de la RAM du PC ; les tests dédiés au mode petite machine restent séparés. |

Les tests existants de fichiers, stockage, mode prof et copies Git restent exécutés. Les tests qui découpent le code de l'interface normalisent les fins de ligne Windows/Linux. Sous Windows sans permission de créer des liens symboliques de fichiers, ce seul scénario est signalé comme ignoré ; **il est exécuté sous Linux**, et les tests de jonctions de dossiers restent exécutés sous Windows.

### Protections et limites

- Les chemins sont contrôlés avant et après confirmation ; un changement de projet, de destination réelle ou une annulation empêche l'écriture. Le bouton Enregistrer partage ces contrôles. Cela ferme le scénario reproduit pendant l'attente, mais n'est pas une garantie atomique contre un processus local hostile qui modifie les chemins exactement pendant les accès disque.
- La lecture sensible utilise le texte déjà vérifié avant l'accord, sans relire une éventuelle nouvelle cible après l'attente. Les noms du fichier et de sa cible sont examinés, sans distinction de casse. Certains contenus reconnaissables (affectations de clés, jetons, mots de passe et blocs de clés privées) déclenchent également la protection après renommage. Ce filtre peut manquer un secret arbitraire, obfusqué ou présent dans une image, ou demander confirmation pour un exemple inoffensif. Ce n'est pas un outil exhaustif de détection de secrets. N'ajoute pas de secrets aux conversations.
- En mode Auto et pour les tâches de fond, les écritures sont autorisées dans une copie Git sans confirmation fichier par fichier. Relis les changements avant « Garder ». Cette copie n'est pas un bac à sable système ; les tests et Godot exécutent du code avec les droits de ton compte, et les dépendances peuvent être partagées avec le projet.
- Les permissions « lecture seule » MCP reposent sur les déclarations du serveur : elles ne prouvent pas son innocuité. Utilise un serveur de confiance. Les contenus web et MCP restent des données externes susceptibles de contenir des instructions trompeuses.
- Les tests du coffre valident la logique de l'app avec un faux `safeStorage`, pas le trousseau réel de chaque machine. Ils ne remplacent pas une vérification manuelle d'Electron, de l'interface et des installateurs sur les systèmes visés.
- Les tests réseau vérifient le filtrage déclaré, pas tous les scénarios réseau adverses. Des tests qui passent ne constituent pas un audit exhaustif de sécurité.

Les dépendances de production ont été mises à jour de façon ciblée : PDF.js **6.2.108** ([avis de sécurité](https://github.com/advisories/GHSA-hq66-cqwq-w95j)) et KaTeX **0.18.2** ([avis de sécurité](https://github.com/advisories/GHSA-238p-pmpm-9mq7)). `package.json` fixe ces versions et `package-lock.json` verrouille leur installation. Les tests lisent un vrai PDF et rendent une vraie formule. Pour vérifier les dépendances : `npm audit --omit=dev --audit-level=high`. Cet audit dépend des avis publiés et ne prouve pas l'absence de faille inconnue.
