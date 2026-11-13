# Run from the Windows profile used for ticketing.
$ErrorActionPreference = 'Stop'
$windowsVersion = [Environment]::OSVersion.Version
if ($windowsVersion.Major -lt 10) {
    throw 'Windows 7 and Windows 8 are not compatible. Use a Windows 10 or Windows 11 PC.'
}
if ($PSVersionTable.PSVersion -lt [Version]'5.1') {
    throw 'Windows PowerShell 5.1 or later is required.'
}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
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
Write-Host "Checking main PC $defaultIp on port 8443..."
if (-not (Test-NetConnection -ComputerName $defaultIp -Port 8443 -InformationLevel Quiet -WarningAction SilentlyContinue)) {
    throw "Cannot reach the main PC at $defaultIp`:8443. Check the LAN cable/router and the PCs' different IPv4 addresses on the same subnet. On the main PC, run Configure-Main-PC-Firewall.ps1 as Administrator. No device key has been created yet."
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
ProviderType = 0
KeySpec = 0
Exportable = FALSE
ExportableEncrypted = FALSE
MachineKeySet = FALSE
RequestType = PKCS10
KeyUsage = 0x80
'@
$infPath = Join-Path $PSScriptRoot 'terminal.inf'
$requestPath = Join-Path $PSScriptRoot 'terminal.req'
[IO.File]::WriteAllText($infPath, $inf, [Text.Encoding]::ASCII)
$keyStorage = 'tpm'
& certreq.exe -new -user -f $infPath $requestPath
if ($LASTEXITCODE -ne 0 -and $setup.allowSoftwareKey -eq $true) {
    Write-Host 'TPM key unavailable. Using the Windows key approved by the main administrator.'
    $keyStorage = 'windows'
    $inf = $inf.Replace('Microsoft Platform Crypto Provider', 'Microsoft Software Key Storage Provider')
    [IO.File]::WriteAllText($infPath, $inf, [Text.Encoding]::ASCII)
    & certreq.exe -new -user -f $infPath $requestPath
}
if ($LASTEXITCODE -ne 0) { throw ('Windows could not create the TPM device key (certreq exit code ' + $LASTEXITCODE + '). In Administrator PowerShell, run: Get-Tpm | Select-Object TpmPresent,TpmReady,TpmEnabled,TpmActivated. Keep this setup folder and share the result; do not clear the TPM.') }
$payload = @{ slot = [int]$setup.slot; token = $setup.token; keyStorage = $keyStorage; request = [IO.File]::ReadAllText($requestPath) } | ConvertTo-Json
$response = Invoke-RestMethod -Method Post -Uri ($setup.localOrigin + '/api/terminal/enroll') -ContentType 'application/json' -Body $payload -TimeoutSec 45
$signed = Join-Path $PSScriptRoot ('terminal-' + $setup.slot + '.cer')
[IO.File]::WriteAllText($signed, $response.certificate, [Text.Encoding]::ASCII)
& certreq.exe -accept -user $signed
if ($LASTEXITCODE -ne 0) { throw 'The certificate could not be installed into this Windows profile.' }
$currentCertificate = New-Object Security.Cryptography.X509Certificates.X509Certificate2($signed)
$installed = Get-Item ("Cert:\CurrentUser\My\" + $currentCertificate.Thumbprint)
if (-not $installed.HasPrivateKey) { throw 'The terminal certificate was installed without its device key.' }
# Avoid duplicate certificate choices after intentionally re-enrolling this slot.
Get-ChildItem Cert:\CurrentUser\My | Where-Object {
    $_.Subject -eq $installed.Subject -and $_.Issuer -eq 'CN=Madina Express Local Terminal CA' -and $_.Thumbprint -ne $installed.Thumbprint
} | ForEach-Object {
    if ($_.GetPublicKeyString() -eq $installed.GetPublicKeyString()) { Remove-Item -LiteralPath $_.PSPath -Force }
    else { Remove-Item -LiteralPath $_.PSPath -DeleteKey -Force }
}

& (Join-Path $PSScriptRoot 'Setup-Counter-Shortcut.ps1') -Origin $setup.localOrigin
Write-Host 'Terminal enrollment is complete. Open Madina Express Counter from the desktop.'
Write-Host 'Use the enrolled Windows profile. Select its terminal certificate when the browser asks.'
Write-Host 'Use the Madina Express Reports desktop shortcut for A4 printer selection.'
Remove-Item (Join-Path $PSScriptRoot 'setup.json') -Force
