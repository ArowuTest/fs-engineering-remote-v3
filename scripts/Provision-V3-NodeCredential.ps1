param([Parameter(Mandatory=$true)][SecureString]$Secret)
$dir=Join-Path $env:LOCALAPPDATA 'FS-Remote-v3\credentials'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$path=Join-Path $dir 'node-secret.dpapi'
ConvertFrom-SecureString $Secret | Set-Content $path -Encoding ascii
Write-Output "V3 node credential provisioned for the current Windows user at $path"
