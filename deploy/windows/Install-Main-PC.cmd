@echo off
powershell.exe -NoProfile -Command "$v = [Environment]::OSVersion.Version; if ($v.Major -lt 10) { Write-Host 'Windows 7 and Windows 8 cannot run this installer. Use a Windows 10 or Windows 11 PC.'; exit 20 }; if ($PSVersionTable.PSVersion -lt [Version]'5.1') { Write-Host 'Windows PowerShell 5.1 or later is required.'; exit 21 }; exit 0"
if errorlevel 1 (
  echo Setup stopped before making changes. Use a compatible Windows PC.
  pause
  exit /b 1
)
powershell.exe -NoProfile -Command "if (([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 0 } else { exit 1 }" >nul 2>&1
if %errorlevel% neq 0 (
  set "MADINA_SETUP_COMMAND=%~f0"
  powershell.exe -NoProfile -Command "Start-Process -FilePath $env:MADINA_SETUP_COMMAND -Verb RunAs"
  exit /b
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Main-PC.ps1"
pause
