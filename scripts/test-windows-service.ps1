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
# Exercise real shortcut/profile creation without launching or installing a browser.
$counterProfile = Join-Path $env:LOCALAPPDATA 'MadinaExpress'
if (Test-Path $counterProfile) { throw 'Shortcut tests require a clean Windows runner profile.' }
try {
    $edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $edge) { throw 'The Windows CI image must include its existing Edge browser.' }
    $legacyPolicy='HKCU:\Software\Policies\Microsoft\Edge'
    if (-not (Test-Path $legacyPolicy)) { New-Item -Path $legacyPolicy -Force | Out-Null }
    New-ItemProperty -Path $legacyPolicy -Name SilentPrintingEnabled -Value 1 -PropertyType DWord -Force | Out-Null
    New-ItemProperty -Path $legacyPolicy -Name AutoLaunchProtocolsFromOrigins -Value '[{"protocol":"company-tool","allowed_origins":["https://company.example"]}]' -PropertyType String -Force | Out-Null
    & (Join-Path $project 'deploy\windows\Setup-Counter-Shortcut.ps1') -Origin 'https://192.168.50.1:8443' -BrowserPath $edge
    if ((Get-ItemProperty $legacyPolicy -ErrorAction SilentlyContinue).SilentPrintingEnabled -eq 1) { throw 'The old global silent-print override still affects A4 reports.' }

    $desktop = [Environment]::GetFolderPath('Desktop')
    $shell = New-Object -ComObject WScript.Shell
    $counter = $shell.CreateShortcut((Join-Path $desktop 'Madina Express Counter.lnk'))
    $reports = $shell.CreateShortcut((Join-Path $desktop 'Madina Express Reports.lnk'))
    if ($counter.TargetPath -ne $edge -or $counter.Arguments -notmatch '--kiosk-printing' -or $counter.Arguments -notmatch 'counterPrint=silent') { throw 'Counter shortcut does not configure the existing browser for silent tickets.' }
    if ($reports.Arguments -match 'kiosk-printing' -or $reports.Arguments -notmatch 'view=reports') { throw 'A4 reports do not use the normal browser profile.' }
    if (-not (Test-Path (Join-Path $counterProfile 'MadinaExpress.ico'))) { throw 'ME app icon was not generated.' }
    $prefs = Get-Content (Join-Path $counterProfile 'CounterEdge\Default\Preferences') -Raw | ConvertFrom-Json
    $printing = $prefs.printing.print_preview_sticky_settings.appState | ConvertFrom-Json
    if ($printing.isHeaderFooterEnabled -ne $false -or $printing.marginsType -ne 1) { throw 'Thermal profile still enables browser headers/footers or margins.' }
    & (Join-Path $project 'deploy\windows\Setup-Counter-Shortcut.ps1') -Origin 'https://192.168.50.2:8443' -BrowserPath $edge
    if ($shell.CreateShortcut((Join-Path $desktop 'Madina Express Counter.lnk')).Arguments -notmatch '192.168.50.2:8443') { throw 'Moving the counter address does not update its shortcut.' }
    . (Join-Path $project 'deploy\windows\Open-A4-Report.ps1')
    $configuration = Get-Content (Join-Path $counterProfile 'report-launcher.json') -Raw | ConvertFrom-Json
    $id = 'a' * 64; $key = 'b' * 64
    $request = 'madina-report://print/?origin=' + [Uri]::EscapeDataString('https://192.168.50.2:8443') + '&job=' + $id + '&key=' + $key
    $launch = Get-MadinaReportLaunch $request $configuration
    if ($launch.FilePath -ne $edge -or $launch.ArgumentList -match 'kiosk-printing' -or $launch.ArgumentList -notmatch '/print/report#') { throw 'A4 handoff does not use the normal dialog profile.' }
    foreach ($bad in @($request.Replace('192.168.50.2','evil.example'),$request.Replace($id,'bad'),$request + '&unexpected=1',$request.Replace('madina-report:','powershell:'))) {
        $rejected = $false
        try { Get-MadinaReportLaunch $bad $configuration | Out-Null } catch { $rejected = $true }
        if (-not $rejected) { throw 'The report launcher accepted an invalid or untrusted request.' }
    }
    if (-not (Test-Path 'HKCU:\Software\Classes\madina-report\shell\open\command')) { throw 'A4 report protocol is not registered.' }
    $rules = (Get-ItemProperty $legacyPolicy).AutoLaunchProtocolsFromOrigins | ConvertFrom-Json
    if (@($rules | Where-Object { $_.protocol -eq 'company-tool' }).Count -ne 1 -or @($rules | Where-Object { $_.protocol -eq 'madina-report' }).Count -ne 1) { throw 'Printing setup replaced or duplicated protocol rules.' }
    if (-not ($rules | Where-Object { $_.protocol -eq 'madina-report' -and $_.allowed_origins -contains 'https://192.168.50.2:8443' })) { throw 'A4 launching is not scoped to the configured server.' }
    Write-Host 'PASS existing browser, unchanged silent thermal mode, one-click A4 dialog handoff, strict launcher origin/ID validation and scoped protocol registration'
} finally {
    if (Test-Path $counterProfile) { Remove-Item $counterProfile -Recurse -Force }
    Remove-Item 'HKCU:\Software\Classes\madina-report' -Recurse -Force -ErrorAction SilentlyContinue
    foreach ($policy in @('HKCU:\Software\Policies\Google\Chrome','HKCU:\Software\Policies\Microsoft\Edge')) { Remove-ItemProperty $policy -Name AutoLaunchProtocolsFromOrigins -ErrorAction SilentlyContinue }
    foreach ($name in @('Madina Express Counter.lnk','Madina Express Reports.lnk')) {
        $path = Join-Path ([Environment]::GetFolderPath('Desktop')) $name
        if (Test-Path $path) { Remove-Item $path -Force }
    }
}
$base = Join-Path $env:ProgramData 'MadinaExpress'
if (Test-Path $base) { throw 'This test requires an isolated runner with no existing Madina Express installation.' }
# Exercise the actual enrollment cleanup against a disposable Windows store.
# Moving this profile from PC 1 to PC 2 must keep only PC 2's identity, without
# removing the CA, unrelated certificates or a different company's identity.
$fixtureCertificates = @()
try {
    $ca = New-SelfSignedCertificate -Subject 'CN=Madina Express Local Terminal CA' -CertStoreLocation Cert:\CurrentUser\My -KeyUsage CertSign,CRLSign -KeyExportPolicy NonExportable -TextExtension @('2.5.29.19={critical}{text}ca=true&pathlength=0')
    $otherCa = New-SelfSignedCertificate -Subject 'CN=Other Company CA' -CertStoreLocation Cert:\CurrentUser\My -KeyUsage CertSign,CRLSign -KeyExportPolicy NonExportable -TextExtension @('2.5.29.19={critical}{text}ca=true&pathlength=0')
    $fixtureCertificates += $ca, $otherCa
    $oldPc1 = New-SelfSignedCertificate -Subject 'CN=Madina Express Terminal 1' -Signer $ca -CertStoreLocation Cert:\CurrentUser\My -KeyExportPolicy NonExportable
    $oldPc2 = New-SelfSignedCertificate -Subject 'CN=Madina Express Terminal 2' -Signer $ca -CertStoreLocation Cert:\CurrentUser\My -KeyExportPolicy NonExportable
    $installed = New-SelfSignedCertificate -Subject 'CN=Madina Express Terminal 2' -Signer $ca -CertStoreLocation Cert:\CurrentUser\My -KeyExportPolicy NonExportable
    $unrelated = New-SelfSignedCertificate -Subject 'CN=Personal Work Certificate' -CertStoreLocation Cert:\CurrentUser\My -KeyExportPolicy NonExportable
    $foreign = New-SelfSignedCertificate -Subject 'CN=Madina Express Terminal 1' -Signer $otherCa -CertStoreLocation Cert:\CurrentUser\My -KeyExportPolicy NonExportable
    $fixtureCertificates += $oldPc1, $oldPc2, $installed, $unrelated, $foreign
    $enrollment = Get-Content (Join-Path $project 'deploy\windows\Install-Terminal-PC.ps1') -Raw
    $start = $enrollment.IndexOf('$oldCertificates = @(Get-ChildItem Cert:\CurrentUser\My | Where-Object {')
    $end = $enrollment.IndexOf('& (Join-Path $PSScriptRoot ''Setup-Counter-Shortcut.ps1'')', $start)
    if ($start -lt 0 -or $end -lt $start) { throw 'The enrollment certificate cleanup block is missing.' }
    & ([ScriptBlock]::Create($enrollment.Substring($start, $end - $start)))
    # Use a fresh native store handle, as a newly opened browser would.
    $store = New-Object Security.Cryptography.X509Certificates.X509Store('My','CurrentUser')
    try {
        $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
        $remaining = @($store.Certificates)
        foreach ($removed in @($oldPc1,$oldPc2)) {
            if ($remaining.Thumbprint -contains $removed.Thumbprint) { throw ('An obsolete terminal certificate still appears: ' + $removed.Subject) }
        }
        foreach ($kept in @($ca,$otherCa,$installed,$unrelated,$foreign)) {
            if ($remaining.Thumbprint -notcontains $kept.Thumbprint) { throw 'Certificate cleanup removed the active or an unrelated identity.' }
        }
        if (-not ($remaining | Where-Object { $_.Thumbprint -eq $installed.Thumbprint }).HasPrivateKey) { throw 'The current terminal lost its private key.' }
    } finally { $store.Close() }
    Write-Host 'PASS PC 2 enrollment removes old local PC 1 and duplicate PC 2 certificates while preserving active and unrelated keys'
} finally {
    foreach ($certificate in $fixtureCertificates) {
        $path = 'Cert:\CurrentUser\My\' + $certificate.Thumbprint
        if (Test-Path $path) { Remove-Item -LiteralPath $path -DeleteKey -Force }
    }
}
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
