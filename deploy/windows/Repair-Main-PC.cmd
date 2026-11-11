@echo off
powershell.exe -NoProfile -Command "if (([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 0 } else { exit 1 }" >nul 2>&1
if %errorlevel% neq 0 (
  set "MADINA_REPAIR_COMMAND=%~f0"
  powershell.exe -NoProfile -Command "Start-Process -FilePath $env:MADINA_REPAIR_COMMAND -Verb RunAs"
  exit /b
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Repair-Main-PC.ps1"
pause
