$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Output = Join-Path (Split-Path -Parent $Root) 'FS-Remote-Engineering-Agent-v2.zip'
$Stage = Join-Path $env:TEMP ('fs-remote-package-' + [Guid]::NewGuid().ToString('N'))
$PackageRoot = Join-Path $Stage 'FS-Remote-MCP'

$excludedDirectories = @('.git', 'node_modules', 'logs', 'runtime', '.tmp-build')
$excludedFiles = @('config\local.json', 'config\tunnel.local.json', '.env')

try {
  New-Item -ItemType Directory -Force -Path $PackageRoot | Out-Null
  Get-ChildItem -LiteralPath $Root -Force | ForEach-Object {
    if ($excludedDirectories -contains $_.Name) { return }
    Copy-Item -LiteralPath $_.FullName -Destination $PackageRoot -Recurse -Force
  }
  foreach ($relative in $excludedFiles) {
    $candidate = Join-Path $PackageRoot $relative
    if (Test-Path -LiteralPath $candidate) { Remove-Item -LiteralPath $candidate -Force }
  }
  if (Test-Path -LiteralPath $Output) { Remove-Item -LiteralPath $Output -Force }
  Compress-Archive -Path $PackageRoot -DestinationPath $Output -CompressionLevel Optimal
  Write-Output "Created $Output"
} finally {
  if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
}
