$ErrorActionPreference = 'Stop'
$base = Join-Path $env:ProgramData 'MadinaExpress'
$application = Join-Path $base 'application'
$node = Join-Path $base 'runtime\node.exe'
$logs = Join-Path $base 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
Set-Location $application
$env:TZ = 'Asia/Karachi'
$env:NODE_ENV = 'production'
# Windows PowerShell 5.1 treats redirected native stderr as PowerShell errors.
# Let Start-Process redirect the two OS streams without a PowerShell pipeline.
foreach ($name in @('server', 'server-error')) {
    for ($index = 5; $index -ge 1; $index--) {
        $previous = Join-Path $logs ("$name.$index.log")
        if (Test-Path $previous) {
            if ($index -eq 5) { Remove-Item $previous -Force }
            else { Move-Item $previous (Join-Path $logs ("$name." + ($index + 1) + '.log')) -Force }
        }
    }
    $current = Join-Path $logs ("$name.log")
    if (Test-Path $current) { Move-Item $current (Join-Path $logs ("$name.1.log")) -Force }
}
$process = Start-Process -FilePath $node -ArgumentList 'backend\node\server.js' -WorkingDirectory $application `
    -RedirectStandardOutput (Join-Path $logs 'server.log') -RedirectStandardError (Join-Path $logs 'server-error.log') `
    -NoNewWindow -Wait -PassThru
exit $process.ExitCode
