$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ConfigFile = Join-Path $Root 'config\local.json'
$config = Get-Content $ConfigFile -Raw | ConvertFrom-Json
if (-not $config.actionsSecret -or $config.actionsSecret.Length -lt 32) {
  throw 'Actions API key is missing or invalid in config/local.json.'
}
Set-Clipboard -Value $config.actionsSecret
Write-Output 'Actions API key copied to clipboard.'