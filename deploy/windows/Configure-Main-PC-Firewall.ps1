param([Parameter(Mandatory=$true)][string]$Address)
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this setup as Administrator.' }
$adapter = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -eq $Address } | Select-Object -First 1
if (-not $adapter -or $Address -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)') { throw 'Use the private IPv4 assigned to the main PC LAN adapter.' }
try { Set-NetConnectionProfile -InterfaceIndex $adapter.InterfaceIndex -NetworkCategory Private -ErrorAction Stop }
catch { Write-Warning 'Windows policy prevented changing the network category. The app firewall rule will still be restricted to this local LAN interface and subnet.' }
Get-NetFirewallRule -DisplayName 'Madina Express Local HTTPS' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -Name 'MadinaExpress-Local-HTTPS' -DisplayName 'Madina Express Local HTTPS' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8443 -LocalAddress $Address -RemoteAddress LocalSubnet -InterfaceAlias $adapter.InterfaceAlias -Profile Any | Out-Null
Write-Host "LAN access ready on $Address port 8443 ($($adapter.InterfaceAlias)). Device enrollment is still required for staff."
