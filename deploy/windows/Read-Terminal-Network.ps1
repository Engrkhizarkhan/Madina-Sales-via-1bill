# Read-only operator diagnostics. No adapter, firewall, IP or registry changes.
param([Parameter(Mandatory=$true)][ValidatePattern('^[0-9.]+$')][string]$Address)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$parsed = $null
if (-not [Net.IPAddress]::TryParse($Address, [ref]$parsed) -or $parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { throw 'An installed IPv4 address is required.' }
$warnings = New-Object 'System.Collections.Generic.List[string]'
function Read-Part([string]$Name, [scriptblock]$Read) {
    try { & $Read } catch { $warnings.Add($Name + ': ' + $_.Exception.Message) }
}
$report = [ordered]@{address=$Address; collectedAt=[DateTime]::UtcNow.ToString('o')}
$report.interfaces = @(Read-Part 'interfaces' {
    Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' } |
        Select-Object InterfaceAlias,InterfaceIndex,IPAddress,PrefixLength,AddressState,PrefixOrigin
})
$interface = @($report.interfaces | Where-Object IPAddress -eq $Address | Select-Object -First 1)
$report.adapters = @(Read-Part 'adapters' {
    Get-NetAdapter | Where-Object Status -eq 'Up' | Select-Object Name,InterfaceIndex,InterfaceDescription,MacAddress,LinkSpeed,MediaDuplexState,DriverVersion,DriverDate
})
$report.defaultRoutes = @(Read-Part 'defaultRoutes' { Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Select-Object InterfaceAlias,InterfaceIndex,NextHop,RouteMetric })
$report.connections = @(Read-Part 'connections' {
    Get-NetTCPConnection -LocalPort 8443 | Where-Object State -ne 'Listen' | Sort-Object CreationTime -Descending |
        Select-Object -First 32 LocalAddress,RemoteAddress,RemotePort,State,CreationTime
})
if ($interface.Count) {
    $index = $interface[0].InterfaceIndex
    $adapter = $report.adapters | Where-Object InterfaceIndex -eq $index | Select-Object -First 1
    if ($adapter) {
        $report.statistics = Read-Part 'statistics' { Get-NetAdapterStatistics -Name $adapter.Name | Select-Object Name,ReceivedBytes,SentBytes,ReceivedPacketErrors,OutboundPacketErrors,ReceivedDiscardedPackets,OutboundDiscardedPackets }
        $report.lso = Read-Part 'lso' { Get-NetAdapterLso -Name $adapter.Name | Select-Object Name,IPv4Enabled,IPv6Enabled }
        $report.rsc = Read-Part 'rsc' { Get-NetAdapterRsc -Name $adapter.Name | Select-Object Name,IPv4Enabled,IPv6Enabled,IPv4OperationalState,IPv6OperationalState }
        $report.advanced = @(Read-Part 'advanced' {
            Get-NetAdapterAdvancedProperty -Name $adapter.Name -AllProperties | Where-Object { $_.RegistryKeyword -in @('*SpeedDuplex','*FlowControl','*JumboPacket','*LsoV2IPv4','*LsoV2IPv6','*TCPChecksumOffloadIPv4','*UDPChecksumOffloadIPv4','*IPChecksumOffloadIPv4','*RscIPv4','*RscIPv6','NetworkAddress') } |
                Select-Object DisplayName,DisplayValue,RegistryKeyword,RegistryValue
        })
    }
    $report.ipInterface = Read-Part 'ipInterface' { Get-NetIPInterface -InterfaceIndex $index -AddressFamily IPv4 | Select-Object InterfaceAlias,NlMtu,InterfaceMetric,ConnectionState,Dhcp }
    $report.neighbors = @(Read-Part 'neighbors' { Get-NetNeighbor -InterfaceIndex $index -AddressFamily IPv4 | Where-Object { $_.LinkLayerAddress -and $_.LinkLayerAddress -ne '00-00-00-00-00-00' } | Select-Object -First 32 IPAddress,LinkLayerAddress,State })
}
$report.connections = @(Read-Part 'connections' {
    Get-NetTCPConnection -LocalPort 8443 -ErrorAction Stop | Select-Object -First 64 LocalAddress,LocalPort,RemoteAddress,RemotePort,State
})
$report.tcpGlobal = Read-Part 'tcpGlobal' { (& netsh.exe interface tcp show global) -join "`n" }
$report.recentEvents = @(Read-Part 'recentEvents' {
    Get-WinEvent -FilterHashtable @{LogName='System';StartTime=(Get-Date).AddDays(-4)} -MaxEvents 400 |
        Where-Object { $_.ProviderName -match '(?i)(tcpip|ndis|netadapter|e1.*express|rt640|rtl|netwtw|Dhcp-Client|NetworkProfile)' } |
        Select-Object -First 16 TimeCreated,Id,ProviderName,LevelDisplayName,@{Name='Message';Expression={ $text=[string]$_.Message; $text.Substring(0,[Math]::Min(400,$text.Length)) }}
})
$report.warnings = @($warnings.ToArray())
$report | ConvertTo-Json -Depth 7 -Compress
