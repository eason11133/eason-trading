param([switch]$NoPair)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$server = Join-Path $root "server"
$envFile = Join-Path $root ".env.local"

function Import-LocalEnv {
  if (-not (Test-Path $envFile)) { return }
  foreach ($line in Get-Content $envFile) {
    $x = $line.Trim()
    if (-not $x -or $x.StartsWith("#")) { continue }
    $parts = $x.Split("=",2)
    if ($parts.Count -eq 2) {
      [Environment]::SetEnvironmentVariable($parts[0].Trim().Trim([char]0xFEFF),$parts[1].Trim(),"Process")
    }
  }
}
function ApiHeaders { return @{ "x-api-key" = $env:TRADING_API_KEY } }
function Get-LanIPv4 {
  $net = Get-NetIPConfiguration |
    Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address -and $_.NetAdapter.Status -eq "Up" } |
    Sort-Object InterfaceMetric |
    Select-Object -First 1
  if ($net) { return $net.IPv4Address.IPAddress }
  return $null
}

Import-LocalEnv
if (-not $env:FUGLE_API_KEY) { throw "FUGLE_API_KEY missing from .env.local" }
if (-not $env:TRADING_API_KEY) { throw "TRADING_API_KEY missing from .env.local" }
if (-not (node -v 2>$null)) { throw "Node.js not found. Node 22.13+ is required." }
$nodeSemver = [version]((node -p "process.versions.node").Trim())
if ($nodeSemver -lt [version]"22.13.0") { throw "Node.js 22.13+ is required. Found $nodeSemver" }

$listener = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $listener) {
  Start-Process -FilePath "node" -ArgumentList "src/server.mjs" -WorkingDirectory $server | Out-Null
}

$health = $null
for ($i=0; $i -lt 120; $i++) {
  try { $health = Invoke-RestMethod "http://127.0.0.1:8787/health" -Headers (ApiHeaders) -TimeoutSec 3 } catch { $health = $null }
  if ($health -and $health.version -ne "0.3.19") { throw "Wrong backend version is listening on port 8787: $($health.version)" }
  # /health becomes available before the asynchronous Fugle verification/hydration finishes.
  # Do not treat the first HTTP 200 as production-ready; wait for provider verification.
  if ($health -and $health.ok -and $health.marketDataVerified -eq $true) { break }
  Start-Sleep -Milliseconds 500
}
if (-not $health) { throw "Backend health check failed" }
if ($health.version -ne "0.3.19") { throw "Wrong backend version is listening on port 8787: $($health.version)" }
if ($health.marketDataVerified -ne $true) { throw "Fugle verification did not become ready: $($health.marketDataError)" }

Write-Host ""
Write-Host "EASON TRADING BACKEND READY" -ForegroundColor Green
Write-Host ("Version: " + $health.version)
Write-Host ("Quotes ready: " + $health.hydratedSymbols + "/" + $health.activeSymbols)

try {
  $sync = Invoke-RestMethod "http://127.0.0.1:8787/v1/cloud-monitor/sync" -Method Post -Headers (ApiHeaders) -ContentType "application/json" -Body "{}" -TimeoutSec 45
  Write-Host ("Cloud sync: armed=" + $sync.sync.localArmed + ", synced=" + $sync.sync.synced + ", devices=" + $sync.devices.count) -ForegroundColor Green
} catch {
  Write-Host ("Cloud sync warning: " + $_.Exception.Message) -ForegroundColor Yellow
}

$lan = Get-LanIPv4
if ($lan) { Write-Host ("Backend URL: http://" + $lan + ":8787") -ForegroundColor Cyan }
if (-not $NoPair) {
  try {
    $pair = Invoke-RestMethod "http://127.0.0.1:8787/v1/pairing/start" -Method Post -Headers (ApiHeaders) -ContentType "application/json" -Body "{}" -TimeoutSec 5
    Write-Host ("Pairing code: " + $pair.code + " (5 minutes, one use)") -ForegroundColor Yellow
  } catch {
    Write-Host ("Pairing code warning: " + $_.Exception.Message) -ForegroundColor Yellow
  }
}
