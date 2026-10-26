@echo off
rem Lance l'app sans fenêtre de console (Ollama est démarré par l'app elle-même)
cd /d "%~dp0"
start "" "node_modules\electron\dist\electron.exe" .
