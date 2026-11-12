# Repair an existing installation without restoring or changing its database.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this repair as Administrator.' }
$base = Join-Path $env:ProgramData 'MadinaExpress'
$data = Join-Path $base 'data'
$app = Join-Path $base 'application'
$pointer = Join-Path $base 'host\current.json'
if (Test-Path $pointer) { $app = (Get-Content $pointer -Raw | ConvertFrom-Json).application }
$node = Join-Path $base 'runtime\node.exe'
$keyPath = Join-Path $data 'tunnel-key'
$runner = if (Test-Path $pointer) { Join-Path $base 'host\Run-Server.ps1' } else { Join-Path $app 'deploy\windows\Run-Server.ps1' }
$configuration = Join-Path $base 'config\backend.env'
if (-not (Test-Path $configuration)) { $configuration = Join-Path $app 'backend\.env' }
if (-not (Test-Path $configuration) -or -not (Test-Path $keyPath) -or -not (Test-Path $node)) {
    throw 'The main PC installation is incomplete. Keep ProgramData and contact support before continuing.'
}
Write-Host 'Repairing the existing main PC service. The database is retained.'
$task = Get-ScheduledTask -TaskName 'Madina Express Terminal Server' -ErrorAction SilentlyContinue
if ($task) { Stop-ScheduledTask -TaskName $task.TaskName -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
# Stop only this application's Node server and dedicated tunnel, including orphaned children.
Get-CimInstance Win32_Process | Where-Object {
    ($_.ExecutablePath -eq $node -and $_.CommandLine -match 'backend[\\/]node[\\/]server\.js') -or
    ($_.Name -eq 'ssh.exe' -and $_.CommandLine -like '*madina-terminal@62.171.173.11*')
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
if (Test-Path $runner) { Copy-Item $runner ($runner + '.before-repair') -Force }
Copy-Item (Join-Path $PSScriptRoot 'Run-Server.ps1') $runner -Force
& icacls.exe $keyPath /setowner '*S-1-5-19' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'The tunnel key owner could not be repaired.' }
$keyAcl = New-Object Security.AccessControl.FileSecurity
$keyAcl.SetAccessRuleProtection($true, $false)
foreach ($entry in @(@('S-1-5-19', 'Read'), @('S-1-5-18', 'FullControl'), @('S-1-5-32-544', 'FullControl'))) {
    $sid = New-Object Security.Principal.SecurityIdentifier($entry[0])
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, $entry[1], 'Allow')
    $keyAcl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $keyPath -AclObject $keyAcl
Import-Certificate -FilePath (Join-Path $data 'tls\ca.crt') -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
Start-Service MadinaTerminalMySQL
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"$runner`"")
$account = New-ScheduledTaskPrincipal -UserId 'S-1-5-19' -LogonType ServiceAccount
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable
Register-ScheduledTask -TaskName 'Madina Express Terminal Server' -Action $action -Principal $account -Trigger (New-ScheduledTaskTrigger -AtStartup) -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'Madina Express Terminal Server'
$healthy = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        $health = Invoke-RestMethod -Uri 'https://localhost:8443/api/health' -TimeoutSec 3
        if ($health.status -eq 'ok') { $healthy = $true; break }
    } catch { Start-Sleep -Seconds 2 }
}
if (-not $healthy) {
    Write-Host 'The app is not responding yet. Current logs:'
    Get-ChildItem (Join-Path $base 'logs\server*.log') | ForEach-Object { Write-Host $_.Name; Get-Content $_.FullName -Tail 20 }
    Get-ScheduledTaskInfo -TaskName 'Madina Express Terminal Server' | Format-List LastRunTime, LastTaskResult
    throw 'Copy the errors above to support. Keep the existing installation data.'
}
Write-Host 'Local HTTPS is responding. Waiting for cloud activation...'
for ($attempt = 0; $attempt -lt 45; $attempt++) {
    if (Test-Path (Join-Path $data 'ready.json')) { break }
    Start-Sleep -Seconds 2
}
$environment = Get-Content (Join-Path $app 'backend\.env')
$originLine = $environment | Where-Object { $_ -like 'TERMINAL_LOCAL_ORIGIN=*' } | Select-Object -First 1
$origin = $originLine.Substring($originLine.IndexOf('=') + 1).Trim()
if (Test-Path (Join-Path $data 'ready.json')) {
    Write-Host "Main PC is ready. Open $origin/login"
    Start-Process ($origin + '/login')
} else {
    Write-Warning 'The local app is running, but cloud activation is still pending.'
    Get-Content (Join-Path $base 'logs\server-error.log') -Tail 30
}
