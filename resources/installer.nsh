!macro customInstall
  ; Otorgar permisos de lectura y ejecucion (RX) a BUILTIN\Users (S-1-5-32-545), Authenticated Users (S-1-5-11)
  ; y ALL APPLICATION PACKAGES / RESTRICTED (S-1-15-2-1, S-1-15-2-2) en AppData\Local\Programs
  ; para evitar errores 0xC0000135 al cargar DLLs en subprocesos de Chromium en Windows 10/11
  nsExec::ExecToLog 'icacls "$INSTDIR" /grant "*S-1-5-32-545:(OI)(CI)(RX)" "*S-1-5-11:(OI)(CI)(RX)" "*S-1-15-2-1:(OI)(CI)(RX)" "*S-1-15-2-2:(OI)(CI)(RX)" /T /Q'
!macroend
