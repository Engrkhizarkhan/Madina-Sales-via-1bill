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
} finally {
    Set-Location $project
    if (Test-Path $base) { Remove-Item $base -Recurse -Force }
}
