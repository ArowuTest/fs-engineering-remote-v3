$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$config = Get-Content (Join-Path $Root 'config\local.json') -Raw | ConvertFrom-Json
$tunnel = Get-Content (Join-Path $Root 'config\tunnel.local.json') -Raw | ConvertFrom-Json
$url = "$($tunnel.publicBaseUrl)/mcp/$($config.endpointSecret)"
Set-Clipboard -Value $url
Write-Host 'Private MCP URL copied to clipboard.' -ForegroundColor Green
Write-Host 'Paste it directly into ChatGPT custom MCP setup. Do not share it publicly.'
