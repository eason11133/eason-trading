$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$mobile = Join-Path $root "mobile"

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "scripts\start-backend.ps1")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not (node -v 2>$null)) { throw "Node.js not found. Node 22.13+ is required." }
$nodeSemver = [version]((node -p "process.versions.node").Trim())
if ($nodeSemver -lt [version]"22.13.0") { throw "Node.js 22.13+ is required. Found $nodeSemver" }

$expoAtRoot = Test-Path (Join-Path $root "node_modules\expo")
$expoAtMobile = Test-Path (Join-Path $mobile "node_modules\expo")
if (-not $expoAtRoot -and -not $expoAtMobile) {
  Push-Location $root
  try {
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
  } finally { Pop-Location }
}

Write-Host "Starting optional LAN development client. Production Android use is the standalone APK; Expo Go is not required." -ForegroundColor Cyan
Set-Location $mobile
node (Join-Path $root "scripts\run-expo.mjs") start --lan
