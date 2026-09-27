param(
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$mobile = Join-Path $repoRoot 'mobile'
$appJson = Join-Path $mobile 'app.json'
$easJson = Join-Path $mobile 'eas.json'
$google = Join-Path $mobile 'google-services.json'
$oldGoogle = 'D:\Downloads\eason-trading-v1-source-v0.3.18\eason-trading-v1\mobile\google-services.json'
$easIgnore = Join-Path $repoRoot '.easignore'
$easIgnoreBackup = Join-Path $repoRoot '.easignore.ota-backup'
$projectId = 'f98e196e-d149-42f8-b7c2-ccb887d60080'
$expectedVersionCode = 323
$npxCmd = (Get-Command npx.cmd -ErrorAction Stop).Source

function Assert-LastExit([string]$Step) {
  if ($LASTEXITCODE -ne 0) { throw "$Step failed with exit code $LASTEXITCODE" }
}

function Run-NodeCheck([string]$RelativePath) {
  $full = Join-Path $repoRoot $RelativePath
  if (Test-Path $full) {
    Write-Host ""
    Write-Host "=== $RelativePath ===" -ForegroundColor Cyan
    node $full
    Assert-LastExit $RelativePath
  }
}

Set-Location $repoRoot

$statusLines = @(git status --porcelain)
if ($LASTEXITCODE -ne 0) { throw "git status failed with exit code $LASTEXITCODE" }
if ($statusLines.Count -gt 0) {
  $allowedDirty = @(
    'mobile/package.json',
    'package-lock.json',
    'mobile/app.json',
    'mobile/eas.json'
  )
  $unexpectedDirty = @()
  foreach ($line in $statusLines) {
    $path = ($line.Substring(3)).Trim()
    if ($path -notin $allowedDirty) { $unexpectedDirty += $line }
  }
  if ($unexpectedDirty.Count -gt 0) {
    Write-Host "Unexpected working tree changes:" -ForegroundColor Yellow
    $unexpectedDirty | ForEach-Object { Write-Host $_ }
    throw "Working tree contains changes outside the OTA setup files. Stop here so existing work is not overwritten."
  }
  Write-Host "Resuming expected OTA setup changes:" -ForegroundColor Yellow
  $statusLines | ForEach-Object { Write-Host $_ }
}

Write-Host "=== Sync main ===" -ForegroundColor Cyan
git pull --ff-only
Assert-LastExit 'git pull'

$head = (git rev-parse HEAD).Trim()
Write-Host "HEAD: $head"

Write-Host ""
Write-Host "=== Install expo-updates with Expo SDK resolver ===" -ForegroundColor Cyan
Set-Location $mobile
$updatesInstalled = node -e "const p=require('./package.json'); process.stdout.write(p.dependencies && p.dependencies['expo-updates'] ? 'yes' : 'no')"
Assert-LastExit 'check expo-updates dependency'
if ($updatesInstalled -ne 'yes') {
  & $npxCmd expo install expo-updates
  Assert-LastExit 'expo install expo-updates'
} else {
  Write-Host "expo-updates already present; keeping the resolved SDK-compatible version."
}

Write-Host ""
Write-Host "=== Configure EAS Update ===" -ForegroundColor Cyan
$nodeScript = @'
const fs = require('fs');

const appPath = process.argv[2];
const easPath = process.argv[3];
const projectId = process.argv[4];
const expectedVersionCode = Number(process.argv[5]);

const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
if (!app.expo) throw new Error('app.json missing expo');
if (app.expo.version !== '0.3.19') throw new Error('Unexpected app version: ' + app.expo.version);
if (app.expo.android?.package !== 'com.eason.trading') throw new Error('Unexpected Android package');
if (Number(app.expo.android?.versionCode) !== expectedVersionCode) {
  throw new Error('Expected versionCode ' + expectedVersionCode + ', found ' + app.expo.android?.versionCode);
}
if (app.expo.extra?.eas?.projectId !== projectId) throw new Error('Unexpected EAS projectId');

app.expo.runtimeVersion = { policy: 'nativeVersion' };
app.expo.updates = {
  ...(app.expo.updates || {}),
  enabled: true,
  url: 'https://u.expo.dev/' + projectId
};

const eas = JSON.parse(fs.readFileSync(easPath, 'utf8'));
eas.cli = { ...(eas.cli || {}), appVersionSource: 'local' };
eas.build = eas.build || {};
eas.build.preview = { ...(eas.build.preview || {}), channel: 'preview' };
eas.build.production = { ...(eas.build.production || {}), channel: 'production' };

fs.writeFileSync(appPath, JSON.stringify(app, null, 2) + '\n');
fs.writeFileSync(easPath, JSON.stringify(eas, null, 2) + '\n');
'@

$tmpJs = Join-Path $env:TEMP 'eason-trading-configure-ota.cjs'
[System.IO.File]::WriteAllText($tmpJs, $nodeScript, [System.Text.UTF8Encoding]::new($false))
node $tmpJs $appJson $easJson $projectId $expectedVersionCode
Assert-LastExit 'OTA config'
Remove-Item $tmpJs -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "=== Validate OTA config ===" -ForegroundColor Cyan
$configCheckScript = @'
const fs = require('fs');

const appPath = process.argv[2];
const easPath = process.argv[3];
const pkgPath = process.argv[4];
const projectId = process.argv[5];

const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
const eas = JSON.parse(fs.readFileSync(easPath, 'utf8'));
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

assert(app.expo?.version === '0.3.19', 'app version mismatch');
assert(app.expo?.android?.package === 'com.eason.trading', 'Android package mismatch');
assert(Number(app.expo?.android?.versionCode) === 323, 'versionCode mismatch');
assert(app.expo?.extra?.eas?.projectId === projectId, 'EAS projectId mismatch');
assert(app.expo?.updates?.enabled === true, 'expo-updates not enabled');
assert(app.expo?.updates?.url === 'https://u.expo.dev/' + projectId, 'updates.url mismatch');
assert(app.expo?.runtimeVersion?.policy === 'nativeVersion', 'runtimeVersion policy mismatch');
assert(eas.build?.preview?.channel === 'preview', 'preview channel mismatch');
assert(eas.build?.production?.channel === 'production', 'production channel mismatch');
assert(eas.build?.preview?.distribution === 'internal', 'preview distribution must remain internal');
assert(eas.build?.preview?.android?.buildType === 'apk', 'preview Android build must remain APK');
assert(Boolean(pkg.dependencies?.['expo-updates']), 'expo-updates dependency missing');

process.stdout.write('OTA config OK: version=0.3.19 versionCode=323 package=com.eason.trading runtimePolicy=nativeVersion previewChannel=preview\n');
'@

$tmpConfigCheck = Join-Path $env:TEMP 'eason-trading-check-ota-config.cjs'
[System.IO.File]::WriteAllText($tmpConfigCheck, $configCheckScript, [System.Text.UTF8Encoding]::new($false))
node $tmpConfigCheck $appJson $easJson (Join-Path $mobile 'package.json') $projectId
Assert-LastExit 'OTA config validation'
Remove-Item $tmpConfigCheck -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "=== TypeScript ===" -ForegroundColor Cyan
& $npxCmd tsc --noEmit
Assert-LastExit 'TypeScript'

Write-Host ""
Write-Host "=== Expo Doctor ===" -ForegroundColor Cyan
& $npxCmd expo-doctor
$doctorExit = $LASTEXITCODE
if ($doctorExit -ne 0) {
  Write-Warning "Expo Doctor reported recommendations. Existing SDK 57 patch-version warnings are allowed only if no new blocking error is shown above."
}

Set-Location $repoRoot
Run-NodeCheck 'scripts\check-mobile-pairing-state.mjs'
Run-NodeCheck 'scripts\check-ts-syntax.mjs'

Write-Host ""
Write-Host "=== Android JS export smoke ===" -ForegroundColor Cyan
$exportDir = Join-Path $env:TEMP 'eason-trading-ota-export'
Remove-Item $exportDir -Recurse -Force -ErrorAction SilentlyContinue
Set-Location $mobile
& $npxCmd expo export --platform android --output-dir $exportDir
Assert-LastExit 'expo export'
Remove-Item $exportDir -Recurse -Force -ErrorAction SilentlyContinue

Set-Location $repoRoot
git diff --check
Assert-LastExit 'git diff --check'

Write-Host ""
Write-Host "=== OTA diff ===" -ForegroundColor Cyan
git --no-pager diff -- mobile/app.json mobile/eas.json mobile/package.json package-lock.json

Write-Host ""
Write-Host "=== Commit OTA configuration ===" -ForegroundColor Cyan
git add mobile/app.json mobile/eas.json mobile/package.json package-lock.json
git diff --cached --check
Assert-LastExit 'staged diff check'

$stagedFiles = @(git diff --cached --name-only)
if ($LASTEXITCODE -ne 0) { throw "git diff --cached --name-only failed with exit code $LASTEXITCODE" }
if ($stagedFiles.Count -gt 0) {
  git commit -m "feat: enable EAS Update for mobile"
  Assert-LastExit 'git commit'
  git push origin main
  Assert-LastExit 'git push'
} else {
  Write-Host "No config changes to commit."
}

if ($SkipBuild) {
  Write-Host ""
  Write-Host "OTA configuration complete. Build skipped by request." -ForegroundColor Green
  exit 0
}

$copiedGoogle = $false
$hadEasIgnore = Test-Path $easIgnore

try {
  Write-Host ""
  Write-Host "=== Prepare proven Firebase archive path ===" -ForegroundColor Cyan
  if (-not (Test-Path $google)) {
    $googleCandidates = @(
      $oldGoogle,
      'D:\Downloads\google-services.json',
      'C:\Users\eason\Downloads\google-services.json'
    )
    $googleSource = $googleCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $googleSource) {
      throw "google-services.json was not found in the current project or the known safe client-config locations."
    }
    Copy-Item $googleSource $google -Force
    $copiedGoogle = $true
    Write-Host "Using client Firebase config from: $googleSource"
  }

  if ($hadEasIgnore) {
    Copy-Item $easIgnore $easIgnoreBackup -Force
  } else {
    Copy-Item (Join-Path $repoRoot '.gitignore') $easIgnore -Force
  }
  Add-Content -LiteralPath $easIgnore -Value ""
  Add-Content -LiteralPath $easIgnore -Value "!mobile/google-services.json"

  Write-Host ""
  Write-Host "=== Verify EAS authentication ===" -ForegroundColor Cyan
  Set-Location $mobile
  & $npxCmd --yes eas-cli@24.3.0 whoami
  Assert-LastExit 'EAS authentication'

  Write-Host ""
  Write-Host "=== Build Android preview 323 (OTA-capable) ===" -ForegroundColor Cyan
  & $npxCmd --yes eas-cli@24.3.0 build --platform android --profile preview --non-interactive --wait
  Assert-LastExit 'EAS Build'

  Write-Host ""
  Write-Host "=== Publish OTA baseline to preview ===" -ForegroundColor Cyan
  & $npxCmd --yes eas-cli@24.3.0 update --channel preview --message "Build 323 OTA baseline" --non-interactive
  Assert-LastExit 'EAS Update'

  Write-Host ""
  Write-Host "SUCCESS: build 323 is OTA-capable and preview channel has a baseline update." -ForegroundColor Green
  Write-Host "Install build 323 once. Future compatible JS/UI/text changes can use EAS Update."
}
finally {
  Set-Location $repoRoot
  if (Test-Path $easIgnoreBackup) {
    Move-Item $easIgnoreBackup $easIgnore -Force
  } elseif (-not $hadEasIgnore -and (Test-Path $easIgnore)) {
    Remove-Item $easIgnore -Force
  }
  if ($copiedGoogle -and (Test-Path $google)) {
    Remove-Item $google -Force
  }
  git reset -- mobile/google-services.json 2>$null | Out-Null
}
