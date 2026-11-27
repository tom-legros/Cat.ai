; Ajouts à l'installateur Windows (electron-builder, nsis.include).
;
; La commande catai : le dossier resources\bin de l'app est ajouté au PATH du compte (pas de tout le PC) à
; l'installation, et retiré à la désinstallation. Le travail est fait par PowerShell, qui lit le registre sans
; développer les %VARIABLES% et réécrit la même valeur, du même type (REG_EXPAND_SZ) : le reste du PATH ne change
; pas, quelle que soit sa longueur (NSIS couperait une valeur trop longue). Une variable vide est ensuite posée
; puis retirée pour prévenir Windows (WM_SETTINGCHANGE) : un nouveau terminal voit catai sans redémarrer.
; Si quelque chose échoue, l'installation continue : catai reste utilisable avec son chemin complet.

!macro catai_path ACTION
  nsExec::Exec `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$d = '$INSTDIR\resources\bin'; $$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $$true); $$p = [string]$$k.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); $$parts = @($$p -split ';' | Where-Object { $$_ -and ([Environment]::ExpandEnvironmentVariables($$_).TrimEnd('\') -ne $$d) }); if ('${ACTION}' -eq 'ajouter') { $$parts += $$d }; $$k.SetValue('Path', ($$parts -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString); $$k.Close(); [Environment]::SetEnvironmentVariable('CATAI_PREVENIR', '1', 'User'); [Environment]::SetEnvironmentVariable('CATAI_PREVENIR', $$null, 'User')"`
  Pop $0
!macroend

!macro customInstall
  !insertmacro catai_path ajouter
!macroend

!macro customUnInstall
  !insertmacro catai_path retirer
!macroend
