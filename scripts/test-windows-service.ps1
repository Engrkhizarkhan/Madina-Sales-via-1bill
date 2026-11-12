$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -ne 5) { throw 'Run this test with Windows PowerShell 5.1.' }
$project = Split-Path $PSScriptRoot -Parent
foreach ($file in Get-ChildItem (Join-Path $project 'deploy\windows\*.ps1')) {
    $tokens = $null
    $errors = $null
    [Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors) | Out-Null
    if ($errors.Count) { throw ($file.Name + ': ' + ($errors.Message -join '; ')) }
    Write-Host ('PASS Windows PowerShell 5.1 syntax: ' + $file.Name)
}
$base = Join-Path $env:ProgramData 'MadinaExpress'
if (Test-Path $base) { throw 'This test requires an isolated runner with no existing Madina Express installation.' }
# Exercise the installer's actual CNG request using the software KSP only on CI,
# where a physical TPM is unavailable. Production retains the platform provider.
$enrollmentScript = Get-Content (Join-Path $project 'deploy\windows\Install-Terminal-PC.ps1') -Raw
$requestMatch = [regex]::Match($enrollmentScript, "(?s)\`$inf = @'\r?\n(?<inf>.*?)\r?\n'@")
if (-not $requestMatch.Success) { throw 'The terminal certificate request template is missing.' }
$requestTemplate = $requestMatch.Groups['inf'].Value
if ($requestTemplate -notmatch 'ProviderName = "Microsoft Platform Crypto Provider"') { throw 'Production enrollment no longer requires a TPM provider.' }
$requestDirectory = Join-Path $env:TEMP ('madina-cng-request-' + [Guid]::NewGuid().ToString('N'))
$keyContainer = 'madina-ci-' + [Guid]::NewGuid().ToString('N')
New-Item -ItemType Directory $requestDirectory | Out-Null
try {
    $testRequest = $requestTemplate.Replace('Microsoft Platform Crypto Provider', 'Microsoft Software Key Storage Provider') + "`r`nKeyContainer = " + $keyContainer
    $requestInf = Join-Path $requestDirectory 'terminal.inf'
    $requestFile = Join-Path $requestDirectory 'terminal.req'
    [IO.File]::WriteAllText($requestInf, $testRequest, [Text.Encoding]::ASCII)
    & certreq.exe -new -user -f $requestInf $requestFile
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $requestFile)) { throw 'Windows CNG certificate request failed.' }
    $key = [Security.Cryptography.CngKey]::Open($keyContainer, [Security.Cryptography.CngProvider]::MicrosoftSoftwareKeyStorageProvider)
    try {
        if ($key.ExportPolicy -ne [Security.Cryptography.CngExportPolicies]::None) { throw 'The device key can be exported.' }
        if ($key.KeySize -ne 2048 -or $key.Algorithm.Algorithm -ne 'RSA') { throw 'Unexpected device key algorithm.' }
    } finally { $key.Dispose() }
    Write-Host 'PASS real Windows CNG enrollment request creates a non-exportable RSA key'
} finally {
    & certutil.exe -user -csp 'Microsoft Software Key Storage Provider' -delkey $keyContainer | Out-Null
    Remove-Item $requestDirectory -Recurse -Force
}
try {
    New-Item -ItemType Directory -Force (Join-Path $base 'runtime'), (Join-Path $base 'application\backend\node'), (Join-Path $base 'logs') | Out-Null
    Copy-Item (Get-Command node.exe).Source (Join-Path $base 'runtime\node.exe')
    @'
const fs = require('node:fs');
console.log('probe started');
console.error('simulated SSH warning on stderr');
setTimeout(() => {
  fs.writeFileSync('service-survived.txt', 'alive');
  console.log('probe still running after stderr');
}, 300);
'@ | Set-Content (Join-Path $base 'application\backend\node\server.js') -Encoding ASCII
    Push-Location $project
    try { & (Join-Path $project 'deploy\windows\Run-Server.ps1') }
    finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw 'The runner exited with a failure.' }
    if (-not (Test-Path (Join-Path $base 'application\service-survived.txt'))) { throw 'Native stderr terminated the server.' }
    if ((Get-Content (Join-Path $base 'logs\server-error.log') -Raw) -notmatch 'simulated SSH warning') { throw 'stderr was not recorded.' }
    if ((Get-Content (Join-Path $base 'logs\server.log') -Raw) -notmatch 'still running after stderr') { throw 'stdout was interrupted.' }
    Write-Host 'PASS a native SSH warning is logged without terminating the Node server'
    $keyPath = Join-Path $base 'test-key'
    Set-Content $keyPath 'fixture only - not a private key' -Encoding ASCII
    $original = Get-Acl -LiteralPath $keyPath
    $userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $original.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($userSid, 'FullControl', 'Allow')))
    Set-Acl -LiteralPath $keyPath -AclObject $original
    $repair = Get-Content (Join-Path $project 'deploy\windows\Repair-Main-PC.ps1') -Raw
    $start = $repair.IndexOf('& icacls.exe $keyPath /setowner')
    $last = 'Set-Acl -LiteralPath $keyPath -AclObject $keyAcl'
    $end = $repair.IndexOf($last, $start) + $last.Length
    if ($start -lt 0 -or $end -lt $start) { throw 'Repair key ACL block is missing.' }
    & ([ScriptBlock]::Create($repair.Substring($start, $end - $start)))
    $actual = Get-Acl -LiteralPath $keyPath
    $allowed = @('S-1-5-19', 'S-1-5-18', 'S-1-5-32-544') | Sort-Object
    $actualSids = @($actual.Access | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value }) | Sort-Object
    if (($allowed -join ',') -ne ($actualSids -join ',')) { throw 'Unexpected principals can read the SSH key.' }
    if (-not $actual.AreAccessRulesProtected) { throw 'The SSH key still inherits permissions.' }
    if ($actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne 'S-1-5-19') { throw 'The SSH key owner is not LocalService.' }
    Write-Host 'PASS repair removes prior explicit key permissions and keeps only the service, SYSTEM and Administrators'
    # Exercise the real updater installation on this disposable Windows runner.
    $app = Join-Path $base 'application'
    New-Item -ItemType Directory -Force (Join-Path $app 'deploy\updater'), (Join-Path $app 'deploy\windows'), (Join-Path $base 'config'), (Join-Path $base 'data') | Out-Null
    Copy-Item (Join-Path $project 'deploy\updater\*') (Join-Path $app 'deploy\updater') -Force
    Copy-Item (Join-Path $project 'deploy\windows\Run-Server.ps1') (Join-Path $app 'deploy\windows') -Force
    Copy-Item (Join-Path $project 'deploy\windows\Run-Updater.ps1') (Join-Path $app 'deploy\windows') -Force
    '{"version":"3.0.0","releaseId":"r-123456789abc","sequence":1}' | Set-Content (Join-Path $app 'build-info.json') -Encoding ASCII
    'TERMINAL_CLOUD_ORIGIN=https://example.invalid' | Set-Content (Join-Path $base 'config\backend.env') -Encoding ASCII
    'fixture only' | Set-Content (Join-Path $base 'config\mysql-admin.cnf') -Encoding ASCII
    '{}' | Set-Content (Join-Path $base 'config\local-secrets.json') -Encoding ASCII
    $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c exit 0'
    $principal = New-ScheduledTaskPrincipal -UserId 'S-1-5-19' -LogonType ServiceAccount
    Register-ScheduledTask -TaskName 'Madina Express Terminal Server' -Action $action -Principal $principal -Trigger (New-ScheduledTaskTrigger -AtStartup) -Force | Out-Null
    & (Join-Path $project 'deploy\windows\Install-Update-Service.ps1')
    $updateTask = Get-ScheduledTask -TaskName 'Madina Express Application Updates'
    if ($updateTask.Principal.UserId -notin @('SYSTEM','S-1-5-18','NT AUTHORITY\SYSTEM')) { throw 'Updater is not running under SYSTEM.' }
    if ($updateTask.Settings.MultipleInstances -ne 'IgnoreNew') { throw 'Update jobs could overlap.' }
    if ((Get-ScheduledTask -TaskName 'Madina Express Terminal Server').Actions.Arguments -notmatch 'host\\Run-Server.ps1') { throw 'Server task does not use the protected stable launcher.' }
    $privateAcl = Get-Acl (Join-Path $base 'config\mysql-admin.cnf')
    $privatePrincipals = @($privateAcl.Access | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value })
    if ($privatePrincipals -contains 'S-1-5-19') { throw 'The app account can read database administrator credentials.' }
    $pointer = Get-Content (Join-Path $base 'host\current.json') -Raw | ConvertFrom-Json
    if ($pointer.application -ne $app -or $pointer.releaseId -ne 'r-123456789abc') { throw 'Initial release pointer is invalid.' }
    Write-Host 'PASS actual Windows updater tasks, protected release pointer and private database administrator permissions'
    $releaseProbe = Join-Path $base 'releases\r-permissions-probe'
    New-Item -ItemType Directory -Force $releaseProbe | Out-Null
    $probeFile = Join-Path $releaseProbe 'build-info.json'
    '{"version":"3.0.0"}' | Set-Content $probeFile -Encoding ASCII
    $blocked = New-Object Security.AccessControl.FileSecurity
    $blocked.SetAccessRuleProtection($true,$false)
    Set-Acl -LiteralPath $probeFile -AclObject $blocked
    $env:MADINA_QA_AGENT_URL = ([Uri](Join-Path $project 'deploy\updater\windows-agent.mjs')).AbsoluteUri
    $aclProbe = Join-Path $base 'release-acl-probe.mjs'
    @'
const {releaseAclCommand}=await import(process.env.MADINA_QA_AGENT_URL);
process.stdout.write(Buffer.from(releaseAclCommand(process.argv[2]),'utf16le').toString('base64'));
'@ | Set-Content $aclProbe -Encoding ASCII
    $encodedAcl = & node.exe $aclProbe $releaseProbe
    if ($LASTEXITCODE -ne 0) { throw 'Could not load the production release permission helper.' }
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $encodedAcl
    if ($LASTEXITCODE -ne 0) { throw 'Production release permission repair failed.' }
    if ((Get-Content $probeFile -Raw | ConvertFrom-Json).version -ne '3.0.0') { throw 'Repaired release file is unreadable.' }
    $probeAcl = Get-Acl $probeFile
    if ($probeAcl.AreAccessRulesProtected) { throw 'A release file does not inherit its protected directory permissions.' }
    $readOnly = @($probeAcl.Access | Where-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -eq 'S-1-5-19' })
    if (-not $readOnly.Count -or ($readOnly | Where-Object { ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Write) -ne 0 })) { throw 'Application can modify a verified release.' }
    Write-Host 'PASS inaccessible release metadata is repaired with inherited read-only application access'

} finally {
    Set-Location $project
    foreach ($name in @('Madina Express Application Updates','Madina Express Terminal Server')) {
        if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $name -Confirm:$false }
    }
    if (Test-Path $base) { Remove-Item $base -Recurse -Force }
}
