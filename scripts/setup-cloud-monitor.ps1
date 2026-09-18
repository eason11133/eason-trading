$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Cloud = Join-Path $Root "cloudflare"
$NodeSetup = Join-Path $Root "scripts\setup-cloud-monitor.mjs"

Write-Host ""
Write-Host "=== Eason Trading Cloud Monitor setup ===" -ForegroundColor Cyan
if (-not (node -v 2>$null)) { throw "Node.js was not found." }
$nodeSemver=[version]((node -p "process.versions.node").Trim())
if($nodeSemver -lt [version]"22.13.0"){throw "Node.js 22.13+ is required by Expo SDK 57. Found $nodeSemver"}
if (-not (npm -v 2>$null)) { throw "npm was not found." }
if (-not (Test-Path $Cloud)) { throw "cloudflare folder not found: $Cloud" }
if (-not (Test-Path $NodeSetup)) { throw "Node Cloud setup orchestrator not found: $NodeSetup" }

Push-Location $Cloud
try {
  $pkg = Join-Path $Cloud "node_modules\wrangler\package.json"
  if (-not (Test-Path $pkg)) {
    Write-Host "Installing local Wrangler dependency..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) { throw "Cloudflare npm install failed." }
  }
} finally {
  Pop-Location
}

# Do not capture or pipe the Node orchestrator. Interactive Wrangler login must inherit
# the real terminal/browser session; the Node child owns all Wrangler exit-code handling.
& node $NodeSetup
if ($LASTEXITCODE -ne 0) { throw "Cloudflare setup failed with exit code $LASTEXITCODE" }
