$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$TunnelFile = Join-Path $Root 'config\tunnel.local.json'
$Runtime = Join-Path $Root 'runtime'
$Logs = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $Runtime,$Logs | Out-Null
$env:ComSpec = 'C:\Windows\System32\cmd.exe'
$env:COMSPEC = $env:ComSpec

if (!(Test-Path $TunnelFile)) { throw 'config/tunnel.local.json is missing.' }
$tunnel = Get-Content $TunnelFile -Raw | ConvertFrom-Json
if ($tunnel.type -ne 'cloudflare') { throw "Unsupported tunnel type: $($tunnel.type)" }
if (!(Test-Path $tunnel.cloudflaredPath)) { throw "cloudflared not found: $($tunnel.cloudflaredPath)" }
if (!(Test-Path $tunnel.configPath)) { throw "cloudflared config not found: $($tunnel.configPath)" }

$hash = [BitConverter]::ToString(
  [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($Root))
).Replace('-','').Substring(0,12)
$created = $false
$mutex = New-Object Threading.Mutex($true, "Local\FSRemoteMCP_Tunnel_$hash", [ref]$created)
if (-not $created) { Write-Output 'FS Remote tunnel watchdog is already running.'; exit 0 }
Set-Content -Path (Join-Path $Runtime 'tunnel-watchdog.pid') -Value $PID

try {
  while ($true) {
    $log = Join-Path $Logs ('tunnel_' + (Get-Date -Format 'yyyy-MM-dd') + '.log')
    Add-Content $log "[$(Get-Date -Format o)] starting Cloudflare tunnel $($tunnel.publicBaseUrl)"
    $command = '"{0}" --config "{1}" tunnel run "{2}" >> "{3}" 2>&1' -f $tunnel.cloudflaredPath,$tunnel.configPath,$tunnel.tunnelName,$log
    & $env:ComSpec /d /s /c $command
    $exitCode = $LASTEXITCODE
    Add-Content $log "[$(Get-Date -Format o)] cloudflared exited code=$exitCode; restarting in 3s"
    Start-Sleep -Seconds 3
  }
} finally {
  Remove-Item (Join-Path $Runtime 'tunnel-watchdog.pid') -Force -ErrorAction SilentlyContinue
  if ($mutex) { $mutex.ReleaseMutex(); $mutex.Dispose() }
}