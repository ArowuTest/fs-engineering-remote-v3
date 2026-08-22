$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Runtime = Join-Path $Root 'runtime'
$Logs = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $Runtime,$Logs | Out-Null
$Port = 8765
$ConfigPath = if ($env:FS_REMOTE_MCP_CONFIG) { $env:FS_REMOTE_MCP_CONFIG } else { Join-Path $Root 'config\local.json' }
if (Test-Path $ConfigPath) {
  try {
    $configured = Get-Content $ConfigPath -Raw | ConvertFrom-Json
    if ($configured.port) { $Port = [int]$configured.port }
  } catch { }
}
$env:ComSpec = 'C:\Windows\System32\cmd.exe'
$env:COMSPEC = $env:ComSpec

$hash = [BitConverter]::ToString(
  [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($Root))
).Replace('-','').Substring(0,12)
$created = $false
$mutex = New-Object Threading.Mutex($true, "Local\FSRemoteMCP_Server_$hash", [ref]$created)
if (-not $created) {
  Write-Output 'FS Remote server watchdog is already running.'
  exit 0
}
Set-Content -Path (Join-Path $Runtime 'server-watchdog.pid') -Value $PID

try {
  while ($true) {
    $log = Join-Path $Logs ('server_' + (Get-Date -Format 'yyyy-MM-dd') + '.log')
    Add-Content $log "[$(Get-Date -Format o)] starting FS Remote server"
    Write-Output "FS Remote server watchdog is active (PID $PID)."
    Write-Output "Server log: $log"
    Write-Output 'Starting: npm.cmd start'
    Push-Location $Root
    try {
      $command = 'npm.cmd start >> "{0}" 2>&1' -f $log
      $child = Start-Process -FilePath $env:ComSpec -ArgumentList '/d','/s','/c',$command -WorkingDirectory $Root -PassThru -WindowStyle Hidden
      $healthy = $false
      for ($attempt = 0; $attempt -lt 20 -and -not $child.HasExited; $attempt++) {
        Start-Sleep -Milliseconds 250
        try {
          $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/healthz" -TimeoutSec 1
          if ($response.StatusCode -eq 200) { $healthy = $true; break }
        } catch { }
      }
      if ($healthy) {
        Write-Output "FS Remote server startup succeeded: health endpoint /healthz is HEALTHY on port $Port."
        Write-Output 'Watchdog remains active in this foreground session.'
      } elseif (-not $child.HasExited) {
        Write-Output 'FS Remote server process is running but /healthz is not yet healthy. Check the server log above.'
      }
      Wait-Process -Id $child.Id
      $child.Refresh()
      $exitCode = $child.ExitCode
    } finally {
      Pop-Location
    }
    Add-Content $log "[$(Get-Date -Format o)] server exited code=$exitCode; restarting in 3s"
    Write-Output "FS Remote server exited code=$exitCode; watchdog will restart it in 3 seconds."
    Start-Sleep -Seconds 3
  }
} finally {
  Remove-Item (Join-Path $Runtime 'server-watchdog.pid') -Force -ErrorAction SilentlyContinue
  if ($mutex) { $mutex.ReleaseMutex(); $mutex.Dispose() }
}
