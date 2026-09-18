$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Mobile = Join-Path $Root "mobile"
$AppJson = Join-Path $Mobile "app.json"

Write-Host ""
Write-Host "=== Eason Trading mobile push setup ===" -ForegroundColor Cyan
if (-not (node -v 2>$null)) { throw "Node.js was not found." }
$nodeSemver=[version]((node -p "process.versions.node").Trim())
if($nodeSemver -lt [version]"22.13.0"){throw "Node.js 22.13+ is required by Expo SDK 57. Found $nodeSemver"}
if (-not (npm -v 2>$null)) { throw "npm was not found." }
if (-not (Test-Path $AppJson)) { throw "mobile/app.json was not found." }

Push-Location $Mobile
try {
  Write-Host "Expo account/project linking is required once so the app has extra.eas.projectId." -ForegroundColor Yellow
  & npx eas-cli@24.3.0 whoami *> $null
  if ($LASTEXITCODE -ne 0) {
    & npx eas-cli@24.3.0 login
    if ($LASTEXITCODE -ne 0) { throw "Expo/EAS login failed." }
  }
  & npx eas-cli@24.3.0 init
  if ($LASTEXITCODE -ne 0) { throw "eas init failed." }

  $cfg = Get-Content $AppJson -Raw | ConvertFrom-Json
  $projectId = [string]$cfg.expo.extra.eas.projectId
  if (-not $projectId) { throw "EAS projectId is still missing after eas init." }
  Write-Host "EAS project linked: $projectId" -ForegroundColor Green
  Write-Host "EAS project link is ready. For the real PC-off push test, build the internal preview app with scripts\build-mobile-push-test.ps1; do not rely on Expo Go for Android remote push." -ForegroundColor Yellow
  Write-Host "After installing the preview app: start the local Backend, run scripts\pair-mobile.ps1, pair the phone once, open Notifications until Push shows registered, then run scripts\test-cloud-push.ps1." -ForegroundColor Cyan
} finally { Pop-Location }
