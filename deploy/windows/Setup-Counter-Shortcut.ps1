# Uses the existing default browser. It never downloads or installs a browser.
param([string]$Origin,[string]$BrowserPath)
$ErrorActionPreference = 'Stop'
if (-not $Origin) { $Origin = (Get-Content (Join-Path $PSScriptRoot 'setup.json') -Raw | ConvertFrom-Json).localOrigin }
$uri = [Uri]$Origin
if ($uri.Scheme -ne 'https' -or $uri.AbsolutePath -ne '/' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment) { throw 'Use the HTTPS server origin, without a path.' }
$Origin = $Origin.TrimEnd('/')
# Older Madina setup enabled silent printing for every profile. Remove that
# per-user override so the normal Reports browser can show its A4 dialog.
foreach ($policy in @('HKCU:\Software\Policies\Google\Chrome','HKCU:\Software\Policies\Microsoft\Edge')) {
    if (Test-Path $policy) { Remove-ItemProperty -Path $policy -Name SilentPrintingEnabled -ErrorAction SilentlyContinue }
}
# Printing an A4 report must not make Windows silently switch the ticket default.
try {
    $printingKey='HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Windows'
    if (-not (Test-Path $printingKey)) { New-Item -Path $printingKey | Out-Null }
    New-ItemProperty -Path $printingKey -Name LegacyDefaultPrinterMode -PropertyType DWord -Value 1 -Force | Out-Null
} catch { Write-Warning 'Turn off Let Windows manage my default printer and set the 80 mm thermal printer as default in Windows Settings.' }
$directory = Join-Path $env:LOCALAPPDATA 'MadinaExpress'
New-Item -ItemType Directory -Force $directory | Out-Null
if ($PSCommandPath -ne (Join-Path $directory 'Setup-Counter-Shortcut.ps1')) { Copy-Item $PSCommandPath (Join-Path $directory 'Setup-Counter-Shortcut.ps1') -Force }
@{localOrigin=$Origin} | ConvertTo-Json | Set-Content (Join-Path $directory 'setup.json') -Encoding ASCII

$progId = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice' -ErrorAction SilentlyContinue).ProgId
$command = ''
if ($progId) {
    $registration = Get-Item "Registry::HKEY_CLASSES_ROOT\$progId\shell\open\command" -ErrorAction SilentlyContinue
    if ($registration) { $command = $registration.GetValue('') }
}
$browser = $BrowserPath
if (-not $browser -and $command -match '^"([^"]+\.exe)"') { $browser = [Environment]::ExpandEnvironmentVariables($Matches[1]) }
elseif (-not $browser -and $command -match '^(.+?\.exe)(?:\s|$)') { $browser = [Environment]::ExpandEnvironmentVariables($Matches[1]) }
if ($progId -like 'MSEdge*' -and (-not $browser -or -not (Test-Path $browser))) {
    $browser = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
}
$name = if ($browser) { [IO.Path]::GetFileName($browser).ToLowerInvariant() } else { '' }
$reportsBrowser = "$env:WINDIR\System32\cmd.exe"
$reportsArguments = "/c start `"`" `"$Origin/manage?view=reports`""
$url = "$Origin/manage?counterPrint=silent"
if ($name -in @('chrome.exe','msedge.exe')) {
    $profile = Join-Path $directory $(if ($name -eq 'chrome.exe') { 'CounterChrome' } else { 'CounterEdge' })
    $running = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like ('*--user-data-dir=*' + $profile + '*') }
    if ($running) { throw 'Close the Madina Express Counter window, then run this setup again.' }
    $preferences = Join-Path $profile 'Default\Preferences'
    New-Item -ItemType Directory -Force (Split-Path $preferences) | Out-Null
    $prefs = @{}
    # Preserve profile preferences (certificate selections, printer and saved data).
    if (Test-Path $preferences) {
        $parsed = Get-Content $preferences -Raw | ConvertFrom-Json
        foreach ($property in $parsed.PSObject.Properties) { $prefs[$property.Name] = $property.Value }
    }
    $printing = if ($prefs.printing) { $prefs.printing | ConvertTo-Json -Depth 60 | ConvertFrom-Json } else { New-Object PSObject }
    $state = @{version=2;isHeaderFooterEnabled=$false;marginsType=1;isLandscapeEnabled=$false;isCssBackgroundEnabled=$true}
    $printing | Add-Member -MemberType NoteProperty -Name print_preview_sticky_settings -Value @{appState=($state | ConvertTo-Json -Compress)} -Force
    $prefs.printing = $printing
    [IO.File]::WriteAllText($preferences,($prefs | ConvertTo-Json -Depth 100 -Compress),(New-Object Text.UTF8Encoding($false)))
    $arguments = "--user-data-dir=`"$profile`" --no-first-run --no-default-browser-check --use-system-default-printer --kiosk-printing --app=`"$url`""
    $reportsProfile = Join-Path $directory $(if ($name -eq 'chrome.exe') { 'ReportsChrome' } else { 'ReportsEdge' })
    $reportPreferences = Join-Path $reportsProfile 'Default\Preferences'
    New-Item -ItemType Directory -Force (Split-Path $reportPreferences) | Out-Null
    $reportPrefs = @{}
    # Preserve profile preferences (certificate selections, printer and saved data).
    if (Test-Path $reportPreferences) {
        $reportParsed = Get-Content $reportPreferences -Raw | ConvertFrom-Json
        foreach ($reportProperty in $reportParsed.PSObject.Properties) { $reportPrefs[$reportProperty.Name] = $reportProperty.Value }
    }
    $reportPrinting = if ($reportPrefs.printing) { $reportPrefs.printing | ConvertTo-Json -Depth 60 | ConvertFrom-Json } else { New-Object PSObject }
    $reportState = @{version=2;isHeaderFooterEnabled=$false}
    if ($reportPrinting.print_preview_sticky_settings.appState) {
        $previous = $reportPrinting.print_preview_sticky_settings.appState | ConvertFrom-Json
        foreach ($saved in $previous.PSObject.Properties) { if ($saved.Name -ne 'isHeaderFooterEnabled') { $reportState[$saved.Name] = $saved.Value } }
    }
    $reportPrinting | Add-Member -MemberType NoteProperty -Name print_preview_sticky_settings -Value @{appState=($reportState | ConvertTo-Json -Compress)} -Force
    $reportPrefs.printing = $reportPrinting
    [IO.File]::WriteAllText($reportPreferences,($reportPrefs | ConvertTo-Json -Depth 100 -Compress),(New-Object Text.UTF8Encoding($false)))
    $reportsBrowser = $browser
    $reportsArguments = "--user-data-dir=`"$reportsProfile`" --no-first-run --no-default-browser-check --new-window `"$Origin/manage?view=reports&counterPrint=dialog`""
} elseif ($name -eq 'firefox.exe') {
    $profile = Join-Path $directory 'CounterFirefox'
    New-Item -ItemType Directory -Force $profile | Out-Null
    $settings = @(
        'user_pref("print.always_print_silent", true);',
        'user_pref("print.show_print_progress", false);',
        'user_pref("security.enterprise_roots.enabled", true);',
        'user_pref("security.osclientcerts.autoload", true);'
    )
    foreach ($position in @('headerleft','headercenter','headerright','footerleft','footercenter','footerright')) { $settings += ('user_pref("print.print_' + $position + '", "");') }
    foreach ($side in @('top','bottom','left','right')) { $settings += ('user_pref("print.print_margin_' + $side + '", "0");') }
    $settings | Set-Content (Join-Path $profile 'user.js') -Encoding ASCII
    $arguments = "-no-remote -profile `"$profile`" `"$url`""
    $reportsProfile = Join-Path $directory 'ReportsFirefox'
    New-Item -ItemType Directory -Force $reportsProfile | Out-Null
    $reportSettings = @('user_pref("print.always_print_silent", false);','user_pref("security.enterprise_roots.enabled", true);','user_pref("security.osclientcerts.autoload", true);')
    foreach ($position in @('headerleft','headercenter','headerright','footerleft','footercenter','footerright')) { $reportSettings += ('user_pref("print.print_' + $position + '", "");') }
    $reportSettings | Set-Content (Join-Path $reportsProfile 'user.js') -Encoding ASCII
    $reportsBrowser = $browser
    $reportsArguments = "-no-remote -profile `"$reportsProfile`" `"$Origin/manage?view=reports&counterPrint=dialog`""

} else {
    $browser = "$env:WINDIR\System32\cmd.exe"
    $arguments = "/c start `"`" `"$Origin/manage`""
    Write-Warning 'This default browser has no supported silent-print mode. It will use its normal print dialog. Edge, Chrome and Firefox are supported.'
}

Add-Type -AssemblyName System.Drawing
$bitmap = New-Object Drawing.Bitmap(64,64)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$font = New-Object Drawing.Font('Segoe UI',25,[Drawing.FontStyle]::Bold)
$brush = New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#185f4a'))
$graphics.FillRectangle($brush,0,0,64,64)
$graphics.DrawString('ME',$font,[Drawing.Brushes]::White,1,10)
$icon = [Drawing.Icon]::FromHandle($bitmap.GetHicon())
$iconPath = Join-Path $directory 'MadinaExpress.ico'
$stream = [IO.File]::Create($iconPath)
try { $icon.Save($stream) } finally { $stream.Dispose();$icon.Dispose();$font.Dispose();$brush.Dispose();$graphics.Dispose();$bitmap.Dispose() }
$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcut = $shell.CreateShortcut((Join-Path $desktop 'Madina Express Counter.lnk'))
$shortcut.TargetPath = $browser
$shortcut.Arguments = $arguments
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = 'Madina Express - silent thermal tickets'
$shortcut.Save()
# Normal browser profile keeps the printer-selection dialog for A4 documents.
$reports = $shell.CreateShortcut((Join-Path $desktop 'Madina Express Reports.lnk'))
$reports.TargetPath = $reportsBrowser
$reports.Arguments = $reportsArguments
$reports.IconLocation = "$iconPath,0"
$reports.Description = 'Madina Express - A4 reports with printer selection'
$reports.Save()
Write-Host 'Counter and Reports shortcuts are ready. No browser was installed.'
Write-Host 'Counter: silent tickets. Reports: normal A4 printer dialog. Set the thermal printer as the Windows default.'
