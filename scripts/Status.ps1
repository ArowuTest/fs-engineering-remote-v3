$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$config = Get-Content (Join-Path $Root 'config\local.json') -Raw | ConvertFrom-Json
$tunnel = Get-Content (Join-Path $Root 'config\tunnel.local.json') -Raw | ConvertFrom-Json

Write-Host 'FS Remote status' -ForegroundColor Cyan
try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$($config.port)/healthz" -TimeoutSec 3
  Write-Host "Local server: HEALTHY (roots=$($health.roots))" -ForegroundColor Green
} catch {
  Write-Host "Local server: DOWN ($($_.Exception.Message))" -ForegroundColor Red
}

try {
  $public = Invoke-RestMethod -Uri "$($tunnel.publicBaseUrl)/healthz" -TimeoutSec 5
  Write-Host "Cloudflare tunnel: HEALTHY ($($tunnel.publicBaseUrl))" -ForegroundColor Green
} catch {
  Write-Host "Cloudflare tunnel: DOWN ($($_.Exception.Message))" -ForegroundColor Red
}

try {
  $schema = Invoke-RestMethod -Uri "$($tunnel.publicBaseUrl)/openapi.json" -TimeoutSec 5
  if (-not $schema.paths.'/actions/run-command'.post.operationId) { throw 'runCommand missing' }
  Write-Host 'Actions OpenAPI: HEALTHY' -ForegroundColor Green
} catch {
  Write-Host "Actions OpenAPI: DOWN ($($_.Exception.Message))" -ForegroundColor Red
}

try {
  $headers = @{ Authorization = "Bearer $($config.actionsSecret)" }
  $actions = Invoke-RestMethod -Uri "$($tunnel.publicBaseUrl)/actions/health" -Headers $headers -TimeoutSec 5
  if (-not $actions.ok) { throw 'health returned not-ok' }
  Write-Host 'Actions auth: HEALTHY' -ForegroundColor Green
} catch {
  Write-Host "Actions auth: DOWN ($($_.Exception.Message))" -ForegroundColor Red
}