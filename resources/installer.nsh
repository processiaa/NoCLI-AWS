!macro customInstall
  ; Otorgar permisos de lectura y ejecucion (RX) a BUILTIN\Users (S-1-5-32-545) y Authenticated Users (S-1-5-11)
  ; igual que VS Code en AppData\Local\Programs para que los subprocesos de Chromium carguen las DLLs sin error 0xC0000135
  nsExec::ExecToLog 'icacls "$INSTDIR" /grant "*S-1-5-32-545:(OI)(CI)(RX)" "*S-1-5-11:(OI)(CI)(RX)" /T /Q'
!macroend

