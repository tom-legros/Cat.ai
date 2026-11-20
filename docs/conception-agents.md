# Conception du système d'agents de Cat Ai (2.0)

## Le constat

Cat Ai a déjà trois façons de faire travailler un modèle sur un projet :

- **le chat** avec un dossier ouvert : l'agent lit et modifie, avec accord (mode Demander) ou dans une copie git (mode Auto) ;
- **le chantier** : un chef découpe un plan en étapes, des codeurs les font dans une copie git, des contrôles (tests, relecture) acceptent ou refusent chaque étape ;
- **l'équipe** de la page Agents : un arbre (chef, codeurs, testeur, lecteur de logs, relecteur) que l'on compose.

Elles partagent la même boucle d'outils (`principal/agent.js`), mais chaque rôle est codé à part (consignes en dur, outils choisis dans le code). Ajouter un rôle, changer un modèle ou mesurer ce qui marche demande de toucher au code.

Et la contrainte principale ne change pas : **des modèles locaux modestes** (8 192 tokens de contexte, 2 à 9 milliards de paramètres), parfois sur un PC sans carte graphique. Un bon système d'agents pour Cat Ai n'est pas celui qui ressemble le plus à une équipe humaine, c'est celui qui **réussit le plus souvent avec un petit modèle**.

## Les principes

1. **Un seul moteur, des fiches.** Un agent n'est pas du code : c'est une fiche (rôle, consignes, outils permis, modèle, budget, format de sortie). Le moteur est la boucle qui existe déjà.
2. **Des étapes petites et vérifiables.** Un petit modèle réussit une étape qui tient dans un fichier ou deux, pas un plan entier. Le chef découpe jusqu'à ce que chaque étape ait un critère de réussite vérifiable.
3. **Les programmes vérifient, les modèles proposent.** Les tests, le lint, la compilation, `git diff` décident en premier. Un modèle relecteur n'intervient que là où aucun programme ne peut juger.
4. **Monter en gamme seulement si nécessaire.** Chaque étape commence avec le modèle le moins cher (local). Après un échec vérifié, elle passe au modèle suivant de l'échelle (local plus gros, puis gratuit en ligne). Jamais de modèle payant.
5. **Rien ne touche le projet sans accord.** Tout se passe dans une copie git ; l'utilisateur garde ou jette à la fin (déjà en place).
6. **Tout se mesure.** Chaque fiche et chaque modèle ont un taux de réussite, mesuré sur un banc d'essai, comme le benchmark des modèles.

## L'architecture

```mermaid
flowchart TB
    subgraph Entrees[Où l'on travaille]
        Chat[Chat : mode Demander ou Auto]
        Chantier[Chantier : un plan]
        Terminal[Terminal : catai /chantier]
    end
    subgraph Fiches[Fiches d'agent]
        Explorateur
        Chef
        Codeur
        LecteurLogs[Lecteur de logs]
        Relecteur
    end
    Entrees --> Moteur[Moteur unique : la boucle d'outils]
    Fiches --> Moteur
    Moteur --> Outils[Outils permis par la fiche]
    Moteur --> Echelle[Échelle de modèles : local puis gratuit en ligne]
    Outils --> Copie[Copie git du projet]
    Copie --> Controles[Contrôles : tests, puis relecture]
    Controles --> Choix{L'utilisateur}
    Choix -- Garder --> Projet[Le projet]
    Choix -- Jeter --> Rien[Rien ne change]
```

## La fiche d'agent

```json
{
  "id": "codeur",
  "role": "Écrire le code d'une étape",
  "consignes": "…",
  "outils": ["lister_fichiers", "lire_fichier", "chercher", "remplacer_texte", "ecrire_fichier"],
  "permissions": { "ecrire": "copie", "commandes": [] },
  "echelle": [
    { "fournisseur": "ollama", "modele": "qwen3.5:9b" },
    { "fournisseur": "gemini", "modele": "gemini-flash" }
  ],
  "budget": { "tours": 12, "minutes": 10 },
  "entree": ["etape", "fichiers_cites", "notes_projet"],
  "sortie": "diff",
  "controles": ["tests", "relecture"]
}
```

- **outils** : une liste fermée. Moins d'outils, c'est moins de tokens et moins d'erreurs pour un petit modèle.
- **permissions.commandes** : seulement des commandes d'une liste sûre (tests, lint, build), jamais une commande libre écrite par le modèle.
- **echelle** : l'ordre de montée en gamme (principe 4).
- **sortie** : `diff` (le moteur regarde la copie git), `json` (avec un schéma vérifié, pour le chef et le relecteur) ou `texte`.

Les fiches de base (chef, codeur, testeur, lecteur de logs, relecteur, explorateur) sont livrées avec l'app. Les équipes de la page Agents deviennent des arbres de fiches. Une fiche modifiée par l'utilisateur est gardée à part et peut être remise par défaut.

## Les rôles

| Rôle | Ce qu'il fait | Modèle | Sortie |
|---|---|---|---|
| **Explorateur** (nouveau) | une fois par projet : type de projet, commande de tests, conventions, fichiers importants | petit | `notes_projet` |
| **Chef** | découpe le plan en étapes avec un critère vérifiable chacune | le meilleur disponible | JSON |
| **Codeur** | fait une étape dans la copie | échelle local → en ligne | diff |
| **Testeur** | lance la commande de tests trouvée par l'explorateur | aucun (programme) | réussite / sortie |
| **Lecteur de logs** | résume un échec de tests en une consigne de correction | petit | texte court |
| **Relecteur** | compare le diff au critère de l'étape, seulement s'il n'y a pas de test | moyen | JSON `{ok, remarque}` |

### L'explorateur et les notes de projet

C'est ce qui manque le plus aujourd'hui. Avant le premier chantier, l'explorateur écrit `.catai/notes.md` dans le projet (avec accord) :

- le type de projet et la commande de tests : `npm test`, `vendor/bin/codecept run`, `vendor/bin/phpunit`, `pytest`, `godot --headless`… détectés à partir de `package.json`, `composer.json`, `pyproject.toml`, `project.godot`, puis confirmés par un vrai lancement ;
- les dossiers importants et ceux à ignorer ;
- les conventions vues dans le code (langue des noms, style, framework).

Ces notes (800 caractères au plus) sont données à chaque agent à la place d'une longue liste de fichiers : moins de tokens, de meilleures décisions. L'utilisateur peut les corriger à la main.

## Le déroulement d'un chantier

1. **Préparer** : l'explorateur fait ou met à jour les notes ; le chef découpe le plan. L'utilisateur voit les étapes et peut les modifier avant de lancer (déjà possible).
2. **Pour chaque étape** :
   1. le codeur travaille dans la copie, avec l'étape, les notes et les fichiers cités ;
   2. le testeur lance les tests ; en cas d'échec, le lecteur de logs écrit une consigne et le codeur réessaie (3 essais) ;
   3. sans test applicable, le relecteur juge le diff contre le critère ;
   4. après les essais ratés, l'étape monte d'un cran dans l'échelle des modèles ;
   5. une étape réussie devient un commit dans la copie.
3. **Finir** : un rapport (étapes, essais, modèles utilisés, temps) ; l'utilisateur voit le diff complet, garde ou jette.

```mermaid
flowchart TD
    Plan[Plan de l'utilisateur] --> Notes[Explorateur : notes du projet]
    Notes --> Decoupe[Chef : étapes avec critère vérifiable]
    Decoupe --> Valide{L'utilisateur relit les étapes}
    Valide -- corrige --> Decoupe
    Valide -- lance --> Etape[Étape suivante]
    Etape --> Code[Codeur : change la copie]
    Code --> Tests{Tests du projet ?}
    Tests -- réussis --> Commit[Commit dans la copie]
    Tests -- échec --> Logs[Lecteur de logs : consigne de correction]
    Logs --> Essais{Encore un essai ?}
    Essais -- oui --> Code
    Essais -- non --> Monter[Copie remise au dernier commit, modèle suivant de l'échelle]
    Monter --> Code
    Tests -- aucun test --> Relecture{Relecteur : diff conforme au critère ?}
    Relecture -- oui --> Commit
    Relecture -- non --> Essais
    Commit --> Reste{Reste-t-il des étapes ?}
    Reste -- oui --> Etape
    Reste -- non --> Rapport[Rapport et diff complet]
    Rapport --> Choix{Garder ou Jeter}
```

### L'échelle des modèles

```mermaid
stateDiagram-v2
    [*] --> Local: chaque étape commence ici
    Local: modèle local de la fiche
    LocalPlus: plus gros modèle local qui tient en mémoire
    EnLigne: modèle gratuit en ligne (Gemini, Groq)
    Echec: étape abandonnée, le rapport dit pourquoi
    Local --> LocalPlus: 3 essais ratés
    LocalPlus --> EnLigne: 3 essais ratés
    EnLigne --> Echec: 3 essais ratés
    Local --> [*]: étape réussie
    LocalPlus --> [*]: étape réussie
    EnLigne --> [*]: étape réussie
```

L'état est écrit après chaque étape : un chantier arrêté (PC éteint, Ctrl+C) reprend là où il en était (en partie en place).

## Ce que l'interface montre

- La page Agents devient un **tableau de bord** : le chantier en cours (arbre avec l'agent qui a la main, l'étape, le modèle, les essais), puis l'historique des chantiers avec leur rapport.
- Chaque étape réussie montre son petit diff ; à la fin, le diff complet avec **Garder** / **Jeter**.
- Les fiches se modifient dans un panneau simple (modèle, échelle, outils cochés), pas en JSON.

## Le banc d'essai des agents

Sans mesure, on ne sait pas si un changement de consigne aide ou nuit. Le banc d'essai :

- une dizaine de petits dépôts de test dans `tests/agents/` (JavaScript, PHP, Python), chacun avec un plan court et des **tests cachés** que le codeur ne voit pas ;
- une commande lance tous les chantiers avec une configuration donnée (fiches + modèles) et note : étapes réussies, essais, temps, tokens, montées en gamme ;
- les résultats s'ajoutent à un tableau, comme `benchmark.md`.

C'est l'outil qui permet de choisir les consignes et les modèles par défaut avec des chiffres.

## Ce qui n'est pas prévu (et pourquoi)

- **Des agents qui discutent librement entre eux** : avec 8 192 tokens, une conversation entre agents consomme le contexte et dérive. Les agents se passent des objets courts (étape, diff, consigne de correction), pas des messages.
- **Du parallélisme d'écriture** : deux codeurs dans la même copie se marchent dessus, et Ollama ne génère qu'une réponse à la fois sur un PC. Le parallélisme est réservé aux modèles en ligne et aux lectures.
- **Des commandes libres** : le modèle n'écrit jamais une commande à exécuter ; il choisit dans une liste sûre.

## Ce qu'un deuxième avis a changé

La conception a été relue par un autre modèle (Gemini). Trois remarques sont retenues :

- **Le banc d'essai passe en premier.** Changer les fiches ou ajouter l'explorateur sans mesure, c'est optimiser à l'aveugle : on mesure d'abord le chantier actuel, puis chaque changement.
- **Des notes de projet courtes.** Une page de conventions mange le contexte d'un petit modèle. Les notes se limitent aux commandes (tests, build), aux dossiers importants et à ignorer : 800 caractères au plus.
- **Des garde-fous globaux.** Avant chaque montée en gamme, la copie revient au dernier commit valide (le chantier le fait déjà au 3e essai, il faut le garantir aussi au changement de modèle). Et un plafond de temps et de tours pour tout le chantier, pas seulement par étape.

Le chef reste le point fragile : un découpage raté fait échouer tout le reste. D'où le meilleur modèle disponible pour lui, un JSON vérifié (le chantier le valide déjà) et, surtout, des étapes que l'utilisateur voit et corrige avant de lancer.

## Le plan de travail

1. **Banc d'essai minimal** : 3 à 5 petits dépôts avec tests cachés dans `tests/agents/`, une commande, un premier tableau avec le chantier actuel (la mesure de départ).
2. **Fiches** : `principal/fiches.js` (fiches de base, validation, fusion avec celles de l'utilisateur) ; le chantier et l'équipe lisent les fiches au lieu de consignes en dur. Mesure avec le banc.
3. **Garde-fous** : copie remise au dernier commit valide avant chaque montée en gamme, plafond global de temps et de tours.
4. **Explorateur ciblé** : détection du type de projet et de la commande de tests (npm, Codeception, PHPUnit, pytest, Godot), `.catai/notes.md` court, avec accord. Mesure avec le banc.
5. **Échelle de modèles** : montée en gamme après échec vérifié, rapport qui dit quel modèle a fait quoi.
6. **Page Agents** : tableau de bord, édition simple des fiches, remise de `PAGE_AGENTS = true`.
7. Plus tard : chantiers lancés depuis le terminal et le homelab (le même moteur, sans fenêtre), agents planifiés.
