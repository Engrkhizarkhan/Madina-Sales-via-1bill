# Move the same server to a new LAN without replacing its CA, database or PC pins.
$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run as Administrator.' }
$base = Join-Path $env:ProgramData 'MadinaExpress'
$app = Join-Path $base 'application'
$data = Join-Path $base 'data'
$node = Join-Path $base 'runtime\node.exe'
$envFile = Join-Path $app 'backend\.env'
if (-not (Test-Path $envFile)) { throw 'Install the main PC first.' }
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)' } | Format-Table InterfaceAlias, IPAddress
$ip = Read-Host 'Enter the IPv4 address assigned to this PC on the new LAN'
if ($ip -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)' -or -not (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -eq $ip })) { throw 'Use a private IPv4 address assigned to this PC.' }
$origin = "https://${ip}:8443"
$oldEnvironment = [IO.File]::ReadAllText($envFile)
$oldKey = [IO.File]::ReadAllBytes((Join-Path $data 'tls\server.key'))
$oldCert = [IO.File]::ReadAllBytes((Join-Path $data 'tls\server.crt'))
Stop-ScheduledTask -TaskName 'Madina Express Terminal Server'
Start-Sleep -Seconds 2
Get-CimInstance Win32_Process | Where-Object {
    ($_.ExecutablePath -eq $node -and $_.CommandLine -match 'backend[\\/]node[\\/]server\.js') -or
    ($_.Name -eq 'ssh.exe' -and $_.CommandLine -like '*madina-terminal@62.171.173.11*')
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
try {
    $updated = [regex]::Replace($oldEnvironment, '(?m)^APP_URL=.*$', "APP_URL=$origin")
    $updated = [regex]::Replace($updated, '(?m)^TERMINAL_LOCAL_ORIGIN=.*$', "TERMINAL_LOCAL_ORIGIN=$origin")
    $updated = [regex]::Replace($updated, '(?m)^ALLOWED_ORIGINS=.*$', "ALLOWED_ORIGINS=$origin,https://localhost:8443,https://madinaexpress.duckdns.org,https://staff.madinaexpress.duckdns.org")
    [IO.File]::WriteAllText($envFile, $updated, [Text.Encoding]::UTF8)
    Push-Location $app
    try { & $node 'backend\terminal\initialize.js' $ip --renew; if ($LASTEXITCODE -ne 0) { throw 'Certificate update failed.' } }
    finally { Pop-Location }
    Import-Certificate -FilePath (Join-Path $data 'tls\ca.crt') -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
    Start-ScheduledTask -TaskName 'Madina Express Terminal Server'
    $healthy = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try { if ((Invoke-RestMethod 'https://localhost:8443/api/health' -TimeoutSec 3).status -eq 'ok') { $healthy = $true; break } }
        catch { Start-Sleep -Seconds 2 }
    }
    if (-not $healthy) { throw 'The server did not pass its local health check.' }
} catch {
    Stop-ScheduledTask -TaskName 'Madina Express Terminal Server' -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    [IO.File]::WriteAllText($envFile, $oldEnvironment, [Text.Encoding]::UTF8)
    [IO.File]::WriteAllBytes((Join-Path $data 'tls\server.key'), $oldKey)
    [IO.File]::WriteAllBytes((Join-Path $data 'tls\server.crt'), $oldCert)
    Start-ScheduledTask -TaskName 'Madina Express Terminal Server'
    throw
}
Write-Host "Address updated: $origin/login"
Write-Host 'Reserve this IP in the router and set this trusted LAN connection to Private in Windows.'
Write-Host 'On enrolled child PCs, run Change-Terminal-PC-Address.cmd and enter this same IP. Their enrollment remains valid.'
Start-Process ($origin + '/login')
