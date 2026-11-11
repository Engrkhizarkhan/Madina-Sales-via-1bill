$ErrorActionPreference = 'Stop'
$base = Join-Path $env:ProgramData 'MadinaExpress'
$application = Join-Path $base 'application'
$node = Join-Path $base 'runtime\node.exe'
$logs = Join-Path $base 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
Set-Location $application
$env:TZ = 'Asia/Karachi'
$env:NODE_ENV = 'production'
$log = Join-Path $logs 'server.log'
if ((Test-Path $log) -and (Get-Item $log).Length -gt 10MB) {
    for ($i = 5; $i -ge 1; $i--) {
        $old = Join-Path $logs ("server.$i.log")
        if (Test-Path $old) {
            if ($i -eq 5) { Remove-Item $old -Force }
            else { Move-Item $old (Join-Path $logs ('server.' + ($i + 1) + '.log')) -Force }
        }
    }
    Move-Item $log (Join-Path $logs 'server.1.log') -Force
}
& $node 'backend\node\server.js' *>> $log
exit $LASTEXITCODE
