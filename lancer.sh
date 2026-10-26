#!/bin/sh
# Lance l'app sur Linux (et macOS) sans garder de terminal ouvert, comme Lancer.bat sur Windows.
# Ollama : s'il ne tourne pas déjà (service système), l'app lance « ollama serve » toute seule.
cd "$(dirname "$0")" || exit 1
nohup ./node_modules/electron/dist/electron . >/dev/null 2>&1 &
