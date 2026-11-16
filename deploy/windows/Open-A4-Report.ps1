# Per-user report launcher. It accepts only fixed-format print IDs and approved
# server origins, never arbitrary commands, paths, HTML or browser arguments.
param([string]$Request)
$ErrorActionPreference = 'Stop'
function Get-MadinaReportLaunch([string]$Value, $Configuration) {
    if ($Value.Length -gt 600) { throw 'Invalid report request.' }
    $uri = [Uri]$Value
    if ($uri.Scheme -ne 'madina-report' -or $uri.Host -ne 'print' -or $uri.AbsolutePath -ne '/' -or $uri.UserInfo -or $uri.Fragment -or $uri.Port -ne -1) { throw 'Invalid report request.' }
    Add-Type -AssemblyName System.Web
    $query = [Web.HttpUtility]::ParseQueryString($uri.Query)
    if ($query.Count -ne 3 -or $query.GetValues('job').Count -ne 1 -or $query.GetValues('key').Count -ne 1 -or $query.GetValues('origin').Count -ne 1) { throw 'Invalid report request.' }
    $id = $query['job']; $key = $query['key']; $origin = $query['origin']
    if ($id -cnotmatch '^[a-f0-9]{64}$' -or $key -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid report identifier.' }
    if (@($Configuration.origin,'https://staff.madinaexpress.pk','https://staff.madinaexpress.duckdns.org') -cnotcontains $origin) { throw 'This report server is not approved.' }
    $browser = [string]$Configuration.browser
    $kind = [IO.Path]::GetFileName($browser).ToLowerInvariant()
    if ($kind -notin @('chrome.exe','msedge.exe','firefox.exe') -or -not (Test-Path -LiteralPath $browser)) { throw 'Configure Counter and Reports shortcuts with your existing browser first.' }
    $url = $origin + '/print/report#' + $id + '.' + $key
    $profile = [string]$Configuration.profile
    $root = Join-Path $env:LOCALAPPDATA 'MadinaExpress'
    if ($profile -notin @((Join-Path $root 'ReportsChrome'),(Join-Path $root 'ReportsEdge'),(Join-Path $root 'ReportsFirefox'))) { throw 'Invalid Reports profile.' }
    $arguments = if ($kind -eq 'firefox.exe') { '-no-remote -profile "' + $profile + '" "' + $url + '"' } else { '--user-data-dir="' + $profile + '" --no-first-run --no-default-browser-check --app="' + $url + '"' }
    return @{FilePath=$browser;ArgumentList=$arguments}
}
if ($MyInvocation.InvocationName -ne '.') {
    if ($args.Count -ne 0) { throw 'Invalid report arguments.' }
    $file = Join-Path $env:LOCALAPPDATA 'MadinaExpress\report-launcher.json'
    $configuration = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    $launch = Get-MadinaReportLaunch $Request $configuration
    Start-Process @launch
}
