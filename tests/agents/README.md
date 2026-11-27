# Banc d'essai des agents

Chaque dossier est un petit projet que l'équipe d'agents (le chantier) doit modifier :

- `plan.md` : ce qu'on demande, comme un utilisateur l'écrirait ;
- `projet/` : le projet de départ, avec parfois des tests visibles par l'agent ;
- `cache/` : les tests cachés, qui notent le résultat (jamais montrés à l'agent) ;
- `solution/` : une solution de référence, qui sert seulement à vérifier que les tests cachés sont justes
  (`tests/banc-agents.test.js`).

Lancer le banc (Ollama doit tourner) : `node outils/banc-agents.cjs qwen3.5:9b`. Voir `docs/conception-agents.md`.
