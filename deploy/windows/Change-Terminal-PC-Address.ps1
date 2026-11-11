$ErrorActionPreference = 'Stop'
$ip = Read-Host 'Enter the main server PC private IPv4 address'
$parsed = $null
if (-not [Net.IPAddress]::TryParse($ip, [ref]$parsed) -or $parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or $ip -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)') { throw 'Enter a private IPv4 address.' }
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw 'Install Google Chrome to use the counter shortcut.' }
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Madina Express Counter.lnk'))
$shortcut.TargetPath = $chrome
$shortcut.Arguments = "--user-data-dir=`"$env:LOCALAPPDATA\MadinaExpress\CounterChrome`" --use-system-default-printer --kiosk-printing --no-first-run --no-default-browser-check --app=https://${ip}:8443/manage"
$shortcut.Save()
Write-Host 'Counter shortcut updated. Close existing counter browser windows, then open Madina Express Counter from the desktop.'
