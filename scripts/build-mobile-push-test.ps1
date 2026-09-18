param(
  [ValidateSet('android','ios')][string]$Platform = 'android'
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Mobile = Join-Path $Root "mobile"
$AppJson = Join-Path $Mobile "app.json"

Write-Host ""
Write-Host "=== Eason Trading push-capable preview build ===" -ForegroundColor Cyan
if (-not (node -v 2>$null)) { throw "Node.js was not found. Install Node.js 22.13+ and retry." }
$nodeSemver=[version]((node -p "process.versions.node").Trim())
if($nodeSemver -lt [version]"22.13.0"){throw "Node.js 22.13+ is required by Expo SDK 57. Found $nodeSemver"}
if (-not (Test-Path $AppJson)) { throw "mobile/app.json was not found." }
$cfg = Get-Content $AppJson -Raw | ConvertFrom-Json
$projectId = [string]$cfg.expo.extra.eas.projectId
if (-not $projectId) {
  throw "EAS projectId is missing. Run scripts\setup-expo-push.ps1 first."
}

Push-Location $Mobile
try {
  & npx eas-cli@24.3.0 whoami *> $null
  if ($LASTEXITCODE -ne 0) { throw "Expo/EAS login is missing. Run scripts\setup-expo-push.ps1 first." }
  Write-Host "Starting $Platform preview build. This is the push-capable test app; Expo Go is not the final PC-off runtime." -ForegroundColor Yellow
  & npx eas-cli@24.3.0 build --platform $Platform --profile preview
  if ($LASTEXITCODE -ne 0) { throw "EAS preview build failed." }
} finally { Pop-Location }
