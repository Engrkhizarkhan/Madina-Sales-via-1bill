# Repair future-dated HTTPS certificates after correcting the Windows clock.
$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run Repair-Local-HTTPS.cmd as Administrator.' }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$base = Join-Path $env:ProgramData 'MadinaExpress'
$application = Join-Path $base 'application'
$pointer = Join-Path $base 'host\current.json'
if (Test-Path $pointer) { $application = (Get-Content $pointer -Raw | ConvertFrom-Json).application }
if (-not $application.StartsWith($base + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'The installed application path is invalid.' }
$configuration = Join-Path $base 'config\backend.env'
$node = Join-Path $base 'runtime\node.exe'
$tls = Join-Path $base 'data\tls'
if (-not (Test-Path $configuration) -or -not (Test-Path $node)) { throw "No main server installation was found at $base. Run this tool on the main server PC." }
foreach ($name in @('ca.crt','ca.key','server.crt','server.key')) {
    if (-not (Test-Path (Join-Path $tls $name))) { throw "Missing $tls\$name. No files were changed. Run this tool on the installed main server PC." }
}
$environment = [IO.File]::ReadAllText($configuration)
$origin = [regex]::Match($environment, '(?m)^TERMINAL_LOCAL_ORIGIN=(.+)$').Groups[1].Value.Trim()
$ip = ([Uri]$origin).Host
Write-Host "Installed main server: $origin"
$cloud = Invoke-RestMethod 'https://madinaexpress.duckdns.org/api/health' -TimeoutSec 20
if ($cloud.status -ne 'ok' -or $cloud.installationId) { throw 'Could not verify the cloud clock.' }
$clockDifference = [Math]::Abs(([DateTimeOffset]::Parse($cloud.time).UtcDateTime - [DateTime]::UtcNow).TotalSeconds)
if ($clockDifference -gt 60) { throw 'The Windows clock is still incorrect. Correct it before repairing certificates.' }
$helper = Join-Path $PSScriptRoot 'Repair-Certificate-Dates.mjs'
$diagnostic = & $node $helper $application $tls $ip --check
if ($LASTEXITCODE -ne 0) { throw 'Certificate checks failed. See the message above; no certificates were changed.' }
$details = $diagnostic | ConvertFrom-Json
Write-Host ('CA valid from: ' + $details.caValidFrom)
Write-Host ('Server certificate valid from: ' + $details.serverValidFrom)
$oldCa = [IO.File]::ReadAllBytes((Join-Path $tls 'ca.crt'))
$oldServer = [IO.File]::ReadAllBytes((Join-Path $tls 'server.crt'))
$stopped = $false
try {
    if ($details.futureCa -or $details.futureServer) {
        Write-Host 'Repairing future certificate dates. The app will restart briefly; the database stays running.'
        Stop-ScheduledTask -TaskName 'Madina Express Application Updates' -ErrorAction SilentlyContinue
        Stop-ScheduledTask -TaskName 'Madina Express Terminal Server' -ErrorAction Stop
        $stopped = $true
        Start-Sleep -Seconds 2
        Get-CimInstance Win32_Process | Where-Object {
            ($_.ExecutablePath -eq $node -and $_.CommandLine -match 'backend[\\/]node[\\/]server\.js') -or
            ($_.Name -eq 'ssh.exe' -and $_.CommandLine -like '*madina-terminal@62.171.173.11*')
        } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        & $node $helper $application $tls $ip
        if ($LASTEXITCODE -ne 0) { throw 'Certificate repair failed.' }
    }
    Import-Certificate -FilePath (Join-Path $tls 'ca.crt') -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
    Import-Certificate -FilePath (Join-Path $tls 'ca.crt') -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
    if ($stopped) { Start-ScheduledTask -TaskName 'Madina Express Terminal Server' }
    Write-Host 'Checking the trusted local HTTPS connection...'
    $healthy = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        try {
            $health = Invoke-RestMethod ($origin + '/api/health') -TimeoutSec 3
            if ($health.status -eq 'ok') { $healthy = $true; break }
        } catch { $lastHealthError = $_.Exception.Message; Start-Sleep -Seconds 2 }
    }
    if (-not $healthy) { throw ('HTTPS did not pass its trusted connection check: ' + $lastHealthError) }
    $originalCa = New-Object Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList (,$oldCa)
    $currentCa = New-Object Security.Cryptography.X509Certificates.X509Certificate2((Join-Path $tls 'ca.crt'))
    if ($originalCa.Thumbprint -ne $currentCa.Thumbprint) {
        foreach ($store in @('Cert:\LocalMachine\Root\','Cert:\CurrentUser\Root\')) {
            $oldPath = $store + $originalCa.Thumbprint
            if (Test-Path $oldPath) { Remove-Item -LiteralPath $oldPath -Force }
        }
    }
} catch {
    if ($stopped) {
        Stop-ScheduledTask -TaskName 'Madina Express Terminal Server' -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        [IO.File]::WriteAllBytes((Join-Path $tls 'ca.crt'), $oldCa)
        [IO.File]::WriteAllBytes((Join-Path $tls 'server.crt'), $oldServer)
        Start-ScheduledTask -TaskName 'Madina Express Terminal Server'
    }
    throw
} finally {
    Start-ScheduledTask -TaskName 'Madina Express Application Updates' -ErrorAction SilentlyContinue
}
Write-Host 'Local HTTPS passed. Database, accounts and private keys were preserved.'
Write-Host 'Close and reopen the browser. Download a NEW PC 1 setup in Settings and run it in your normal Windows profile.'
Write-Host 'Discard the old extracted PC setup folder because it contains the previous certificate.'
Start-Process ($origin + '/login')
