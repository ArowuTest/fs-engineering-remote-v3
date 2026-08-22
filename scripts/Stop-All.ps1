$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$env:ComSpec = 'C:\Windows\System32\cmd.exe'
$env:COMSPEC = $env:ComSpec
$rootRegex = [Regex]::Escape($Root)
$serverScript = Join-Path $Root 'scripts\Start-Server.ps1'
$tunnelScript = Join-Path $Root 'scripts\Start-Tunnel.ps1'
$serverWatchdogPattern = '(?i)-File\s+["'']?' + [Regex]::Escape($serverScript) + '["'']?(?:\s|$)'
$tunnelWatchdogPattern = '(?i)-File\s+["'']?' + [Regex]::Escape($tunnelScript) + '["'']?(?:\s|$)'
$tunnelFile = Join-Path $Root 'config\tunnel.local.json'
$tunnelName = $null
if (Test-Path $tunnelFile) {
  $tunnelName = (Get-Content $tunnelFile -Raw | ConvertFrom-Json).tunnelName
}

function Stop-Tree([int]$ProcessId) {
  & $env:ComSpec /d /s /c "taskkill /PID $ProcessId /T /F >nul 2>&1"
}

$watchdogs = Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -ne $PID -and $_.Name -eq 'powershell.exe' -and $_.CommandLine -and (
    $_.CommandLine -match $serverWatchdogPattern -or
    $_.CommandLine -match $tunnelWatchdogPattern
  )
}
foreach ($target in $watchdogs) {
  Write-Output "Stopping watchdog PID $($target.ProcessId): $($target.Name)"
  Stop-Tree $target.ProcessId
}
Start-Sleep -Milliseconds 300
$orphans = Get-CimInstance Win32_Process | Where-Object {
  if ($_.ProcessId -eq $PID -or -not $_.CommandLine) { return $false }
  $serverChild = $_.Name -eq 'node.exe' -and
    $_.CommandLine -match $rootRegex -and $_.CommandLine -match 'src[\\/]index\.ts'
  $tunnelChild = $tunnelName -and $_.Name -eq 'cloudflared.exe' -and
    $_.CommandLine -match ('tunnel\s+run\s+["'']?' + [Regex]::Escape($tunnelName) + '["'']?(?:\s|$)')
  $serverChild -or $tunnelChild
}
foreach ($target in $orphans) {
  Write-Output "Stopping orphan PID $($target.ProcessId): $($target.Name)"
  Stop-Tree $target.ProcessId
}

if (!$watchdogs -and !$orphans) {
  Write-Output 'No FS Remote processes are running.'
} else {
  Write-Output 'FS Remote stopped.'
}