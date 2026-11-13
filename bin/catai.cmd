@echo off
rem catai : Cat Ai dans le terminal, avec le moteur de l'app (pas besoin d'installer Node).
rem Ajoute ce dossier a ton PATH pour pouvoir taper catai depuis n'importe quel dossier.
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\..\Cat Ai.exe" "%~dp0..\app.asar\cli\catai.js" %*
