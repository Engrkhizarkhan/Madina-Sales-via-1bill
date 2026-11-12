$ErrorActionPreference = 'Stop'
$base = Join-Path $env:ProgramData 'MadinaExpress'
$hostDirectory = Join-Path $base 'host'
$application = (Get-Content (Join-Path $hostDirectory 'current.json') -Raw | ConvertFrom-Json).application
if (-not $application.StartsWith($base + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid selected application path.' }
$agent = Join-Path $application 'deploy\updater\windows-agent.mjs'
foreach ($name in @('updater-out.log','updater-error.log')) {
    $file = Join-Path $hostDirectory $name
    if ((Test-Path $file) -and (Get-Item $file).Length -gt 5242880) { Move-Item $file ($file + '.previous') -Force }
}
$process = Start-Process -FilePath (Join-Path $base 'runtime\node.exe') -ArgumentList ('"' + $agent + '"') -WorkingDirectory $hostDirectory -RedirectStandardOutput (Join-Path $hostDirectory 'updater-out.log') -RedirectStandardError (Join-Path $hostDirectory 'updater-error.log') -NoNewWindow -Wait -PassThru
exit $process.ExitCode
