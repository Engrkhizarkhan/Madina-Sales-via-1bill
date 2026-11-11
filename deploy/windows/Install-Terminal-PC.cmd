@echo off
powershell.exe -NoProfile -Command "$v = [Environment]::OSVersion.Version; if ($v.Major -lt 10) { Write-Host 'Windows 7 and Windows 8 cannot run this installer. Use a Windows 10 or Windows 11 PC.'; exit 20 }; if ($PSVersionTable.PSVersion -lt [Version]'5.1') { Write-Host 'Windows PowerShell 5.1 or later is required.'; exit 21 }; exit 0"
if errorlevel 1 (
  echo Setup stopped before making changes. Use a compatible Windows PC.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Terminal-PC.ps1"
pause
