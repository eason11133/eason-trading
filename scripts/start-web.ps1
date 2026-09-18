$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$server = Join-Path $root 'server'
$mobile = Join-Path $root 'mobile'

function Import-LocalEnv {
  $envFile = Join-Path $root '.env.local'
  if (-not (Test-Path $envFile)) { return }
  foreach ($line in Get-Content $envFile) {
    $x = $line.Trim()
    if (-not $x -or $x.StartsWith('#')) { continue }
    $parts = $x.Split('=',2)
    if ($parts.Count -eq 2) { [Environment]::SetEnvironmentVariable($parts[0].Trim().Trim([char]0xFEFF), $parts[1].Trim(), 'Process') }
  }
}
function ApiHeaders { if ($env:TRADING_API_KEY) { return @{ 'x-api-key' = $env:TRADING_API_KEY } } return @{} }

Import-LocalEnv
if (-not $env:FUGLE_API_KEY) { throw "Fugle API Key not found. No demo fallback is allowed." }
if (-not $env:TRADING_API_KEY) { throw "TRADING_API_KEY not found. Run the installer/upgrade so the local API never starts without authentication." }
if (-not (node -v 2>$null)) { throw "Node.js was not found. Install Node.js 22.13+ and retry." }
$nodeSemver=[version]((node -p "process.versions.node").Trim())
if($nodeSemver -lt [version]"22.13.0"){throw "Node.js 22.13+ is required by Expo SDK 57. Found $nodeSemver"}

$expoAtRoot = Test-Path (Join-Path $root 'node_modules\expo')
$expoAtMobile = Test-Path (Join-Path $mobile 'node_modules\expo')
if (-not $expoAtRoot -and -not $expoAtMobile) {
  Write-Host "First launch: installing mobile dependencies..." -ForegroundColor Yellow
  Push-Location $mobile
  try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
  } finally { Pop-Location }
}

foreach ($port in 8787,8081) {
  $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($listener in $listeners) { Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Milliseconds 350

Start-Process -FilePath "node" -ArgumentList "src/server.mjs" -WorkingDirectory $server | Out-Null
$api = 'http://127.0.0.1:8787'
$health = $null
for ($i=0; $i -lt 60; $i++) {
  try { $health = Invoke-RestMethod "$api/health" -Headers (ApiHeaders) -TimeoutSec 3 } catch {}
  if ($health -and $health.marketDataVerified -eq $true -and $health.quotesReady -eq $true) { break }
  Start-Sleep -Milliseconds 500
}
if (-not $health) { throw "Backend health check failed at $api/health" }
if ($health.marketDataVerified -ne $true) { throw "Fugle verification failed: $($health.marketDataError)" }
if ($health.quotesReady -ne $true) { throw "Not every active symbol has a verified Fugle quote: $($health.hydratedSymbols)/$($health.activeSymbols)" }

Write-Host "Backend OK - version $($health.version)" -ForegroundColor Green
Write-Host "Market data: Fugle VERIFIED" -ForegroundColor Green
Write-Host "Quotes hydrated: $($health.hydratedSymbols)/$($health.activeSymbols)" -ForegroundColor Green
$env:EXPO_PUBLIC_TRADING_API_URL = $api
$env:EXPO_PUBLIC_TRADING_API_KEY = $env:TRADING_API_KEY
$env:EXPO_PUBLIC_FOCUS_WS = 'false'
$env:EXPO_OFFLINE = '1'
$env:EXPO_NO_DEPENDENCY_VALIDATION = '1'

Write-Host "Starting web app..." -ForegroundColor Cyan
Write-Host "Browser URL: http://localhost:8081" -ForegroundColor Green
Set-Location $mobile
node (Join-Path $root 'scripts\run-expo.mjs') start --web
