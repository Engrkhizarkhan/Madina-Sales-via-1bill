$ErrorActionPreference = 'Stop'
$ip = Read-Host 'Enter the main server PC private IPv4 address'
$parsed = $null
if (-not [Net.IPAddress]::TryParse($ip, [ref]$parsed) -or $parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or $ip -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)') { throw 'Enter a private IPv4 address.' }
$helper = Join-Path $env:LOCALAPPDATA 'MadinaExpress\Setup-Counter-Shortcut.ps1'
if (-not (Test-Path $helper)) { $helper = Join-Path $PSScriptRoot 'Setup-Counter-Shortcut.ps1' }
if (-not (Test-Path $helper)) { throw 'Download the current Counter shortcut setup from local Settings first.' }
& $helper -Origin "https://${ip}:8443"
Write-Host 'Address updated. Close old counter windows and use the updated desktop shortcuts.'
