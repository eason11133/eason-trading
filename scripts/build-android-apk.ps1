$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$mobile = Join-Path $root "mobile"
if (-not (node -v 2>$null)) { throw "Node.js not found. Node 22.13+ is required." }
$nodeSemver=[version]((node -p "process.versions.node").Trim())
if($nodeSemver -lt [version]"22.13.0"){throw "Node.js 22.13+ is required. Found $nodeSemver"}
$pkg = Get-Content (Join-Path $mobile "package.json") -Raw | ConvertFrom-Json
if ([string]$pkg.version -ne "0.3.18") { throw "This APK builder is for v0.3.18 only." }
$Npx=(Get-Command npx.cmd -ErrorAction SilentlyContinue).Source
if(-not $Npx){$Npx=(Get-Command npx -ErrorAction Stop).Source}

Write-Host "Checking pinned EAS CLI 24.3.0 authentication..." -ForegroundColor Cyan
& $Npx --yes eas-cli@24.3.0 whoami
if($LASTEXITCODE -ne 0){throw "Pinned EAS CLI 24.3.0 authentication failed."}

Push-Location $mobile
try {
  Write-Host "Building final Eason Trading v0.3.18 Android APK on EAS with pinned CLI 24.3.0..." -ForegroundColor Cyan
  & $Npx --yes eas-cli@24.3.0 build --platform android --profile preview --non-interactive --wait
  if($LASTEXITCODE -ne 0){throw "Pinned EAS CLI 24.3.0 Android build failed."}

  Write-Host "Latest finished v0.3.18 Android preview build:" -ForegroundColor Green
  & $Npx --yes eas-cli@24.3.0 build:list --platform android --build-profile preview --app-version 0.3.18 --status finished --limit 1 --non-interactive
  if($LASTEXITCODE -ne 0){throw "EAS build finished, but build:list verification failed."}
} finally { Pop-Location }
