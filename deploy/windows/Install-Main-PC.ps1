# First installation requires an elevated PowerShell window and internet.
$ErrorActionPreference = 'Stop'
$windowsVersion = [Environment]::OSVersion.Version
if ($windowsVersion.Major -lt 10) {
    throw 'Windows 7 and Windows 8 are not compatible. Use a Windows 10 or Windows 11 PC.'
}
if ($PSVersionTable.PSVersion -lt [Version]'5.1') {
    throw 'Windows PowerShell 5.1 or later is required.'
}
if ($windowsVersion.Major -eq 10 -and $windowsVersion.Build -lt 17763) {
    throw 'The main PC requires Windows 10 version 1809 or later, or Windows 11.'
}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if (-not [Environment]::Is64BitOperatingSystem) { throw 'A 64-bit Windows 10 or 11 main PC is required.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Right-click PowerShell, choose Run as administrator, and run this installer again.'
}
$base = Join-Path $env:ProgramData 'MadinaExpress'
$application = Join-Path $base 'application'
$data = Join-Path $base 'data'
$setup = Get-Content (Join-Path $PSScriptRoot 'setup.json') -Raw | ConvertFrom-Json
$manifest = Get-Content (Join-Path $PSScriptRoot 'runtime.json') -Raw | ConvertFrom-Json
$mainIp = Read-Host 'Enter this main PC local IPv4 address (for example 192.168.1.20)'
$parsed = $null
if (-not [Net.IPAddress]::TryParse($mainIp, [ref]$parsed) -or $mainIp -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)') {
    throw 'Enter a private IPv4 address assigned to this main PC.'
}
if (-not (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -eq $mainIp })) {
    throw 'That IP is not assigned to this PC. Run ipconfig and use its IPv4 address.'
}
$confirmed = Read-Host 'All counters will use this main PC. Reserve this IP in the router. Continue? Type YES'
if ($confirmed -cne 'YES') { throw 'Setup stopped before changing the server.' }
# Never import over an old running source. A reset is allowed only before cloud activation.
if (Test-Path (Join-Path $application 'backend\.env')) {
    $cloudState = Invoke-RestMethod -Uri ($setup.cloudOrigin + '/api/terminal-sync/public-status') -TimeoutSec 20
    if (@('standalone', 'provisioned') -notcontains $cloudState.phase) {
        throw 'Cancel the unfinished setup in cloud Settings first. An active main PC must be recovered without resetting its data.'
    }
    if ((Read-Host 'Previous installation found. Type RESET to archive it and start fresh') -cne 'RESET') { throw 'Previous installation retained.' }
    Stop-ScheduledTask -TaskName 'Madina Express Terminal Server' -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    $oldNode = Join-Path $base 'runtime\node.exe'
    Get-CimInstance Win32_Process | Where-Object {
        ($_.ExecutablePath -eq $oldNode -and $_.CommandLine -match 'backend[\\/]node[\\/]server\.js') -or
        ($_.Name -eq 'ssh.exe' -and $_.CommandLine -like '*madina-terminal@62.171.173.11*')
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    if (Get-Service MadinaTerminalMySQL -ErrorAction SilentlyContinue) {
        Stop-Service MadinaTerminalMySQL -Force
        & sc.exe delete MadinaTerminalMySQL | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'The previous database service could not be removed.' }
        [GC]::Collect()
        [GC]::WaitForPendingFinalizers()
        Start-Sleep -Seconds 2
    }
    $archive = $base + '-previous-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
    Move-Item $base $archive
    Write-Host "Previous local installation retained in $archive. It cannot connect using the revoked pairing."
}
New-Item -ItemType Directory -Force $base, $data, (Join-Path $base 'downloads') | Out-Null
& icacls.exe $base /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-19:(OI)(CI)M' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Windows could not protect the installation directory.' }
$downloads = Join-Path $base 'downloads'
function Download-Checked($entry, $destination) {
    if (-not (Test-Path $destination) -or (Get-FileHash $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) {
        for ($downloadAttempt = 1; $downloadAttempt -le 3; $downloadAttempt++) {
            Write-Host ("Downloading " + [IO.Path]::GetFileName($destination) + " (attempt $downloadAttempt/3)")
            try { Invoke-WebRequest -UseBasicParsing -Uri $entry.url -OutFile $destination -TimeoutSec 600; break }
            catch { if ($downloadAttempt -eq 3) { throw }; Start-Sleep -Seconds 3 }
        }
    }
    if ((Get-FileHash $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) {
        Remove-Item $destination -Force
        throw 'The downloaded runtime failed its checksum. Try setup again.'
    }
}
$nodeZip = Join-Path $downloads 'node.zip'
$mysqlZip = Join-Path $downloads 'mysql.zip'
$vc = Join-Path $downloads 'vc_redist.x64.exe'
Write-Host 'Downloading and verifying the server runtimes.'
Download-Checked $manifest.node $nodeZip
Download-Checked $manifest.mysql $mysqlZip
Download-Checked $manifest.vcRuntime $vc
$vcProcess = Start-Process -FilePath $vc -ArgumentList '/install', '/quiet', '/norestart' -PassThru -Wait
if (@(0, 1638, 3010) -notcontains $vcProcess.ExitCode) { throw 'Microsoft Visual C++ runtime installation failed.' }
if (-not (Test-Path (Join-Path $base 'runtime\node.exe'))) {
    Expand-Archive -Path $nodeZip -DestinationPath $downloads -Force
    Move-Item (Join-Path $downloads $manifest.node.folder) (Join-Path $base 'runtime')
}
if (-not (Test-Path (Join-Path $base 'mysql\bin\mysqld.exe'))) {
    Expand-Archive -Path $mysqlZip -DestinationPath $downloads -Force
    Move-Item (Join-Path $downloads $manifest.mysql.folder) (Join-Path $base 'mysql')
}
Expand-Archive -Path (Join-Path $PSScriptRoot 'application.zip') -DestinationPath $application -Force
$ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
if (-not (Test-Path $ssh)) {
    Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0 | Out-Null
}
if (-not (Test-Path $ssh)) { throw 'Install Windows OpenSSH Client, then run setup again.' }
$installationFile = Join-Path $data 'installation.json'
if (-not (Test-Path $installationFile)) {
    @{ installationId = [Guid]::NewGuid().ToString() } | ConvertTo-Json | Set-Content $installationFile -Encoding ASCII
}
$installation = Get-Content $installationFile -Raw | ConvertFrom-Json
$keyPath = Join-Path $data 'tunnel-key'
if (-not (Test-Path $keyPath)) {
    & (Join-Path $env:WINDIR 'System32\OpenSSH\ssh-keygen.exe') -q -t ed25519 -N '""' -f $keyPath
    if ($LASTEXITCODE -ne 0) { throw 'The secure tunnel key could not be generated.' }
}
[IO.File]::WriteAllText((Join-Path $data 'known_hosts'), $setup.knownHost + "`n", [Text.Encoding]::ASCII)
$headers = @{ 'X-Terminal-Token' = $setup.token }
$registration = @{
    installationId = $installation.installationId
    publicKey = [IO.File]::ReadAllText($keyPath + '.pub')
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri ($setup.cloudOrigin + '/api/terminal-sync/register') -Headers $headers -ContentType 'application/json' -Body $registration -TimeoutSec 30 | Out-Null

Write-Host 'Transferring the current database. Cloud booking changes pause; remote admin login remains available.'
Write-Host 'If setup fails, open cloud Settings and cancel unfinished setup before retrying.'
$bootstrapZip = Join-Path $data 'bootstrap.zip'
Invoke-WebRequest -UseBasicParsing -Method Post -Uri ($setup.cloudOrigin + '/api/terminal-sync/bootstrap') -Headers $headers -ContentType 'application/json' -Body (@{ installationId = $installation.installationId } | ConvertTo-Json) -OutFile $bootstrapZip -TimeoutSec 180
$bootstrap = Join-Path $data 'bootstrap'
Expand-Archive -Path $bootstrapZip -DestinationPath $bootstrap -Force
$settings = Get-Content (Join-Path $bootstrap 'settings.json') -Raw | ConvertFrom-Json
$secretsFile = Join-Path $data 'local-secrets.json'
function New-HexSecret {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}
if (-not (Test-Path $secretsFile)) {
    @{ rootPassword = (New-HexSecret); appPassword = (New-HexSecret) } | ConvertTo-Json | Set-Content $secretsFile -Encoding ASCII
}
$secrets = Get-Content $secretsFile -Raw | ConvertFrom-Json
$mysql = Join-Path $base 'mysql\bin\mysql.exe'
$mysqld = Join-Path $base 'mysql\bin\mysqld.exe'
$dbPath = Join-Path $data 'mysql'
$mysqlConfig = Join-Path $data 'mysql.ini'
@"
[mysqld]
basedir=$($base.Replace('\','/'))/mysql
datadir=$($dbPath.Replace('\','/'))
port=3310
bind-address=127.0.0.1
mysqlx=0
server-id=100
gtid-mode=ON
enforce-gtid-consistency=ON
binlog-format=ROW
binlog-expire-logs-seconds=2592000
default-time-zone=+05:00
"@ | Set-Content $mysqlConfig -Encoding ASCII
$fresh = -not (Test-Path (Join-Path $dbPath 'mysql'))
if ($fresh) {
    & $mysqld "--defaults-file=$mysqlConfig" --initialize-insecure
    if ($LASTEXITCODE -ne 0) { throw 'The local MySQL data directory could not be initialized.' }
}
if (-not (Get-Service -Name MadinaTerminalMySQL -ErrorAction SilentlyContinue)) {
    & $mysqld --install MadinaTerminalMySQL "--defaults-file=$mysqlConfig" --local-service
    if ($LASTEXITCODE -ne 0) { throw 'The local MySQL service could not be installed.' }
}
Start-Service MadinaTerminalMySQL
$mysqlAdmin = Join-Path $base 'mysql\bin\mysqladmin.exe'
$started = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    & $mysqlAdmin --no-defaults --host=127.0.0.1 --port=3310 --user=root ping 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $started = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $started) { throw 'MySQL did not start. Check its .err log in the data\mysql folder.' }
$adminConfig = Join-Path $data 'mysql-admin.cnf'
$rootPassword = if ($fresh) { '' } else { $secrets.rootPassword }
@"
[client]
host=127.0.0.1
port=3310
user=root
password=$rootPassword
"@ | Set-Content $adminConfig -Encoding ASCII
function Run-SqlFile($path) {
    $result = Start-Process -FilePath $mysql -ArgumentList ("`"--defaults-extra-file=$adminConfig`" --default-character-set=utf8mb4 --binary-mode") -RedirectStandardInput $path -NoNewWindow -Wait -PassThru
    if ($result.ExitCode -ne 0) { throw 'The local database operation failed. Keep the setup files and check the error above.' }
}
$init = Join-Path $data 'initialize.sql'
@"
SET SESSION sql_log_bin=0;
ALTER USER 'root'@'localhost' IDENTIFIED BY '$($secrets.rootPassword)';
CREATE DATABASE IF NOT EXISTS madina_express CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'madina_app'@'127.0.0.1' IDENTIFIED BY '$($secrets.appPassword)';
ALTER USER 'madina_app'@'127.0.0.1' IDENTIFIED BY '$($secrets.appPassword)';
GRANT SELECT,INSERT,UPDATE,DELETE ON madina_express.* TO 'madina_app'@'127.0.0.1';
CREATE USER IF NOT EXISTS 'madina_repl'@'127.0.0.1' IDENTIFIED BY '$($settings.replicationPassword)';
ALTER USER 'madina_repl'@'127.0.0.1' IDENTIFIED BY '$($settings.replicationPassword)';
GRANT REPLICATION SLAVE ON *.* TO 'madina_repl'@'127.0.0.1';
"@ | Set-Content $init -Encoding ASCII
Run-SqlFile $init
(Get-Content $adminConfig -Raw).Replace("password=$rootPassword", "password=$($secrets.rootPassword)") | Set-Content $adminConfig -Encoding ASCII
$import = Join-Path $data 'import.sql'
$stream = [IO.File]::Create($import)
try {
    $prefix = [Text.Encoding]::ASCII.GetBytes("SET SESSION sql_log_bin=0;`nUSE madina_express;`n")
    $stream.Write($prefix, 0, $prefix.Length)
    $input = [IO.File]::OpenRead((Join-Path $bootstrap 'database.sql'))
    try { $input.CopyTo($stream) } finally { $input.Dispose() }
} finally { $stream.Dispose() }
Run-SqlFile $import
$origin = "https://${mainIp}:8443"
$environment = @"
APP_ENV=production
APP_URL=$origin
ALLOWED_ORIGINS=$origin,https://localhost:8443,https://madinaexpress.duckdns.org,https://staff.madinaexpress.duckdns.org
DB_HOST=127.0.0.1
DB_PORT=3310
DB_NAME=madina_express
DB_USER=madina_app
DB_PASSWORD=$($secrets.appPassword)
SESSION_SECURE=true
PAYMENT_MODE=disabled
PUBLIC_SITE_ENABLED=true
NODE_ENV=production
RESTRICT_STAFF_DEVICES=true
ADMIN_TOTP_HEX=$($settings.adminOtpHex)
ADMIN_TOTP_PAUSED=false
NODE_API_HOST=127.0.0.1
NODE_API_PORT=43101
TRUST_PROXY=1
TERMINAL_ROLE=terminal
TERMINAL_DIRECTORY=$data
TERMINAL_LOCAL_ORIGIN=$origin
TERMINAL_CLOUD_ORIGIN=$($setup.cloudOrigin)
TERMINAL_RELAY_KEY=$($settings.relayKey)
TERMINAL_INSTALL_TOKEN=$($setup.token)
TERMINAL_INSTALLATION_ID=$($installation.installationId)
TERMINAL_SSH_PATH=$ssh
TERMINAL_MYSQLDUMP=$base\mysql\bin\mysqldump.exe
"@
[IO.File]::WriteAllText((Join-Path $application 'backend\.env'), $environment, [Text.Encoding]::UTF8)
@"
[client]
host=127.0.0.1
port=3310
user=madina_app
password=$($secrets.appPassword)
"@ | Set-Content (Join-Path $data 'backup.cnf') -Encoding ASCII
Push-Location $application
try {
    & (Join-Path $base 'runtime\node.exe') 'backend\terminal\initialize.js' $mainIp
    if ($LASTEXITCODE -ne 0) { throw 'The terminal HTTPS certificate could not be created.' }
} finally { Pop-Location }
Import-Certificate -FilePath (Join-Path $data 'tls\ca.crt') -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
# The SSH private key is readable only by LocalService, Administrators and SYSTEM.
& icacls.exe $keyPath /setowner '*S-1-5-19' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'The tunnel key owner could not be set to the service account.' }
$keyAcl = New-Object Security.AccessControl.FileSecurity
$keyAcl.SetAccessRuleProtection($true, $false)
foreach ($entry in @(@('S-1-5-19', 'Read'), @('S-1-5-18', 'FullControl'), @('S-1-5-32-544', 'FullControl'))) {
    $sid = New-Object Security.Principal.SecurityIdentifier($entry[0])
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, $entry[1], 'Allow')
    $keyAcl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $keyPath -AclObject $keyAcl
if (-not (Get-NetFirewallRule -DisplayName 'Madina Express Local HTTPS' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'Madina Express Local HTTPS' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8443 -Profile Private -RemoteAddress LocalSubnet | Out-Null
}
$network = Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -ne 'Disconnected' }
if ($network.NetworkCategory -notcontains 'Private') {
    Write-Warning 'Set the terminal router connection to Private in Windows network settings so the child PCs can connect.'
}
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"" + (Join-Path $application 'deploy\windows\Run-Server.ps1') + "`"")
$taskPrincipal = New-ScheduledTaskPrincipal -UserId 'S-1-5-19' -LogonType ServiceAccount
$taskSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable
Register-ScheduledTask -TaskName 'Madina Express Terminal Server' -Action $action -Principal $taskPrincipal -Trigger (New-ScheduledTaskTrigger -AtStartup) -Settings $taskSettings -Force | Out-Null
Start-ScheduledTask -TaskName 'Madina Express Terminal Server'
$localReady = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        $health = Invoke-RestMethod -Uri 'https://localhost:8443/api/health' -TimeoutSec 3
        if ($health.status -eq 'ok' -and $health.installationId -eq $installation.installationId) { $localReady = $true; break }
    } catch { Start-Sleep -Seconds 2 }
}
if (-not $localReady) {
    throw "The local app did not start. Check $base\logs\server-error.log and run the main PC repair from the staff site. Your imported database is retained."
}
Write-Host 'Local HTTPS is ready. Verifying the secure cloud connection and database synchronization.'
$paired = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $readyFile = Join-Path $data 'ready.json'
    if (Test-Path $readyFile) {
        $readyState = Get-Content $readyFile -Raw | ConvertFrom-Json
        if ($readyState.installationId -eq $installation.installationId) { $paired = $true; break }
    }
    if (($attempt % 10) -eq 0) { Write-Host 'Waiting for cloud acknowledgement; remote admin login remains available.' }
    Start-Sleep -Seconds 2
}
if (-not $paired) {
    throw "The local service started but cloud pairing is incomplete. Check $base\logs\server-error.log and $data\connection.json. Remote admin login remains available. Do not start taking bookings until setup is confirmed."
}
Remove-Item $init, $import, $bootstrapZip -Force
Remove-Item $bootstrap -Recurse -Force
Write-Host "Main PC service installed. Open $origin/login to sign in as admin."
Write-Host 'Allow its first cloud connection to complete. Then open Settings, generate PC 1 setup for this Windows profile, and PC 2 / PC 3 setup for the child PCs.'
Write-Host 'Keep the main PC awake and reserve its IP in the router. The local server starts automatically after reboot.'
Write-Host 'When moving to the terminal LAN, run Change-Main-PC-Network.cmd from the extracted setup to enter its new IP.'
Start-Process ($origin + '/login')
