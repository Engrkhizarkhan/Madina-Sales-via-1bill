# Invoked by the elevated main installer after pairing; never by a web request.
$ErrorActionPreference = 'Stop'
$base = Join-Path $env:ProgramData 'MadinaExpress'
$application = Join-Path $base 'application'
$hostDirectory = Join-Path $base 'host'
$configDirectory = Join-Path $base 'config'
New-Item -ItemType Directory -Force $hostDirectory, $configDirectory | Out-Null
foreach ($name in @('release.mjs','engine.mjs','windows-agent.mjs','release-public-key.pem')) {
    Copy-Item (Join-Path $application ('deploy\updater\' + $name)) (Join-Path $hostDirectory $name) -Force
}
Copy-Item (Join-Path $application 'deploy\windows\Run-Server.ps1') (Join-Path $hostDirectory 'Run-Server.ps1') -Force
Copy-Item (Join-Path $application 'deploy\windows\Run-Updater.ps1') (Join-Path $hostDirectory 'Run-Updater.ps1') -Force
$build = Get-Content (Join-Path $application 'build-info.json') -Raw | ConvertFrom-Json
@{application=$application;releaseId=$build.releaseId;version=$build.version;sequence=$build.sequence} | ConvertTo-Json | Set-Content (Join-Path $hostDirectory 'current.json') -Encoding ASCII
$environment = [IO.File]::ReadAllText((Join-Path $configDirectory 'backend.env'))
$cloud = [regex]::Match($environment,'(?m)^TERMINAL_CLOUD_ORIGIN=(.+)$').Groups[1].Value.Trim()
@{project='madina-express';cloudOrigin=$cloud} | ConvertTo-Json | Set-Content (Join-Path $hostDirectory 'updater.json') -Encoding ASCII
# Application and updater code are read-only to the LocalService app account.
& icacls.exe $base /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-19:(OI)(CI)RX' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'The installation root could not be protected.' }
foreach ($directory in @((Join-Path $base 'data'),(Join-Path $base 'logs'))) {
    & icacls.exe $directory /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-19:(OI)(CI)M' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'The application data directory could not be protected.' }
}
foreach ($private in @('mysql-admin.cnf','local-secrets.json')) {
    $file = Join-Path $configDirectory $private
    if (Test-Path $file) {
        & icacls.exe $file /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Administrator database credentials could not be protected.' }
    }
}
$serverAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"" + (Join-Path $hostDirectory 'Run-Server.ps1') + "`"")
Set-ScheduledTask -TaskName 'Madina Express Terminal Server' -Action $serverAction | Out-Null
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"" + (Join-Path $hostDirectory 'Run-Updater.ps1') + "`"")
$principal = New-ScheduledTaskPrincipal -UserId 'S-1-5-18' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew -StartWhenAvailable
$repeat = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'Madina Express Application Updates' -Action $action -Principal $principal -Trigger @((New-ScheduledTaskTrigger -AtStartup),$repeat) -Settings $settings -Force | Out-Null
Write-Host 'Signed remote updates enabled. The main admin can pause them in Settings.'
