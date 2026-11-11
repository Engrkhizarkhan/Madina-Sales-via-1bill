# Run from the Windows profile used for ticketing.
$ErrorActionPreference = 'Stop'
$setup = Get-Content (Join-Path $PSScriptRoot 'setup.json') -Raw | ConvertFrom-Json
$certificatePath = Join-Path $PSScriptRoot 'terminal-ca.cer'
if ((Get-FileHash $certificatePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $setup.caFingerprint) {
    throw 'The setup certificate was changed. Generate a new setup file on the main PC.'
}
$defaultIp = ([Uri]$setup.localOrigin).Host
$mainIp = Read-Host "Main PC local IP [$defaultIp]"
if ([string]::IsNullOrWhiteSpace($mainIp)) { $mainIp = $defaultIp }
$parsed = $null
if (-not [Net.IPAddress]::TryParse($mainIp, [ref]$parsed) -or $mainIp -ne $defaultIp) {
    throw 'Use the IP saved by the main PC installer. If it changed, update the main PC installation first.'
}
Import-Certificate -FilePath $certificatePath -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
$inf = @'
[Version]
Signature="$Windows NT$"
[NewRequest]
Subject = "CN=Madina Express Terminal"
KeyAlgorithm = RSA
KeyLength = 2048
HashAlgorithm = SHA256
ProviderName = "Microsoft Platform Crypto Provider"
Exportable = FALSE
MachineKeySet = FALSE
RequestType = PKCS10
KeyUsage = 0x80
'@
$infPath = Join-Path $PSScriptRoot 'terminal.inf'
$requestPath = Join-Path $PSScriptRoot 'terminal.req'
[IO.File]::WriteAllText($infPath, $inf, [Text.Encoding]::ASCII)
& certreq.exe -new -user $infPath $requestPath
if ($LASTEXITCODE -ne 0) { throw 'Windows could not create the device key. Check that TPM is enabled, then try again.' }
$payload = @{ slot = [int]$setup.slot; token = $setup.token; request = [IO.File]::ReadAllText($requestPath) } | ConvertTo-Json
$response = Invoke-RestMethod -Method Post -Uri ($setup.localOrigin + '/api/terminal/enroll') -ContentType 'application/json' -Body $payload
$signed = Join-Path $PSScriptRoot ('terminal-' + $setup.slot + '.cer')
[IO.File]::WriteAllText($signed, $response.certificate, [Text.Encoding]::ASCII)
& certreq.exe -accept -user $signed
if ($LASTEXITCODE -ne 0) { throw 'The certificate could not be installed into this Windows profile.' }

$launcherDirectory = Join-Path $env:LOCALAPPDATA 'MadinaExpress'
New-Item -ItemType Directory -Force $launcherDirectory | Out-Null
$launcher = @'
@echo off
setlocal
set "chrome=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not exist "%chrome%" set "chrome=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%chrome%" set "chrome=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%chrome%" (
    echo Install Google Chrome to use the counter launcher.
    pause
    exit /b 1
)
start "" "%chrome%" --user-data-dir="%LOCALAPPDATA%\MadinaExpress\CounterChrome" --no-first-run --no-default-browser-check --use-system-default-printer --kiosk-printing --app="__ORIGIN__/manage"
'@
$launcherPath = Join-Path $launcherDirectory 'Madina-Express-Counter.cmd'
[IO.File]::WriteAllText($launcherPath, $launcher.Replace('__ORIGIN__', $setup.localOrigin), [Text.Encoding]::ASCII)
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path $desktop 'Madina Express Counter.lnk'))
$shortcut.TargetPath = $launcherPath
$shortcut.Save()
Write-Host 'Terminal enrollment is complete. Open Madina Express Counter from the desktop.'
Write-Host 'Use the enrolled Windows profile. Select its terminal certificate when Chrome asks.'
Write-Host 'Open the same local address in regular Firefox for the A4 report print dialog.'
Remove-Item (Join-Path $PSScriptRoot 'setup.json') -Force
