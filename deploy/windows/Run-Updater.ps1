$ErrorActionPreference = 'Stop'
$base = Join-Path $env:ProgramData 'MadinaExpress'
$hostDirectory = Join-Path $base 'host'
foreach ($name in @('updater-out.log','updater-error.log')) {
    $file = Join-Path $hostDirectory $name
    if ((Test-Path $file) -and (Get-Item $file).Length -gt 5242880) { Move-Item $file ($file + '.previous') -Force }
}
$process = Start-Process -FilePath (Join-Path $base 'runtime\node.exe') -ArgumentList ('"' + (Join-Path $hostDirectory 'windows-agent.mjs') + '"') -WorkingDirectory $hostDirectory -RedirectStandardOutput (Join-Path $hostDirectory 'updater-out.log') -RedirectStandardError (Join-Path $hostDirectory 'updater-error.log') -NoNewWindow -Wait -PassThru
exit $process.ExitCode
