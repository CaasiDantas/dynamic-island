; Desinstalar remove também o "iniciar com o Windows" e a chave do app,
; para não sobrar entrada quebrada no Run nem a marca de primeira execução.
!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Dynamic Island"
  DeleteRegKey HKCU "Software\Dynamic Island"
!macroend
