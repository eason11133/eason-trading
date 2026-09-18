$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$EnvFile = Join-Path $Root ".env.local"

function Read-EnvFile {
  $map = @{}
  if (-not (Test-Path $EnvFile)) { return $map }
  foreach ($line in Get-Content $EnvFile) {
    $x = $line.Trim()
    if (-not $x -or $x.StartsWith('#')) { continue }
    $parts = $x.Split('=',2)
    if ($parts.Count -eq 2) { $map[$parts[0].Trim().Trim([char]0xFEFF)] = $parts[1].Trim() }
  }
  return $map
}
function Local-Headers($envMap) {
  $h = @{}
  if ($envMap['TRADING_API_KEY']) { $h['x-api-key'] = [string]$envMap['TRADING_API_KEY'] }
  return $h
}

Write-Host ""
Write-Host "=== Eason Trading GPT Action setup helper ===" -ForegroundColor Cyan
$envMap = Read-EnvFile
$worker = ([string]$envMap['CLOUD_MONITOR_URL']).TrimEnd('/')
$token = [string]$envMap['GPT_DIRECT_MCP_TOKEN']
if (-not $worker -or -not $token) {
  throw "GPT Direct cloud settings are not present yet. Run scripts\setup-cloud-monitor.ps1 first."
}

$bearer = @{ Authorization = ('Bearer ' + $token) }
$schemaUrl = $worker + '/gpt-action-openapi.json'
$instructionsUrl = $worker + '/gpt-action-instructions.txt'
$privacyUrl = $worker + '/privacy'

Write-Host "Checking deployed Action bridge..." -ForegroundColor Yellow
$ready = Invoke-RestMethod ($worker + '/v1/gpt-action/readiness') -Headers $bearer -TimeoutSec 20
$schema = Invoke-RestMethod $schemaUrl -TimeoutSec 20
if ($schema.openapi -ne '3.1.0' -or -not $schema.paths.'/v1/gpt-action/strategy') {
  throw "The deployed GPT Action schema is not the expected Eason Trading strategy-only API."
}

$stockChatUrl = ''
try {
  $settings = Invoke-RestMethod 'http://127.0.0.1:8787/v1/settings' -Headers (Local-Headers $envMap) -TimeoutSec 5
  $stockChatUrl = [string]$settings.stockChatUrl
} catch {}

$surface = 'UNKNOWN'
if ($stockChatUrl -match 'chatgpt\.com/g/') { $surface = 'EXISTING_CUSTOM_GPT' }
elseif ($stockChatUrl -match 'chatgpt\.com/c/') { $surface = 'NORMAL_CHAT' }
elseif ($stockChatUrl) { $surface = 'OTHER_URL' }

$guide = @"
EASON TRADING GPT ACTION CONNECTION

Worker: $worker
Schema URL: $schemaUrl
Privacy URL: $privacyUrl
Instructions URL: $instructionsUrl
Authentication: API key -> Bearer
Bearer token: [kept private in .env.local; copied to clipboard by this helper]

Current App bridge:
- state synced: $($ready.connected)
- local app online now: $($ready.appOnline)
- state age seconds: $($ready.stateAgeSeconds)
- pending strategy commands: $($ready.pendingCommands)
- source version: $($ready.sourceVersion)

Saved stock GPT URL: $stockChatUrl
Detected surface: $surface

ONE-TIME GPT CONFIGURATION
1. Open the existing stock GPT in the GPT editor.
2. If Apps are enabled on this GPT, disable Apps first. A GPT cannot use Apps and Actions at the same time.
3. Actions -> Create new action. If Actions are unavailable, make sure the GPT is using a non-Pro model that supports Actions.
4. Authentication -> API Key -> Bearer.
5. Run this helper immediately before editing the GPT; it copies the private Bearer token to the Windows clipboard. Paste it only into the Action Authentication field.
6. Import schema from: $schemaUrl
7. Add the rules from: $instructionsUrl to the GPT instructions.
8. Save/update the existing GPT.
9. In Preview, ask: "讀取 Eason Trading 現在的雷達狀態，不要修改。"
10. Then test one harmless strategy change and confirm the App reflects it.

IMPORTANT
- If Detected surface is NORMAL_CHAT, this saved URL is a normal Plus conversation. You cannot attach a private write Action to that normal conversation. Use an existing editable custom GPT instead.
- GPT Direct may change strategy only. It cannot create trades, edit cash, edit holding quantities, or initialize/correct the authoritative Ledger.
- After Direct Actions are connected, normal daily use does not require copying EASON_TRADING_UPDATE_V1.
"@

$outDir = Join-Path $Root 'runtime'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outFile = Join-Path $outDir 'gpt-action-setup.txt'
Set-Content -Path $outFile -Value $guide -Encoding utf8

Write-Host ""
if ($surface -eq 'EXISTING_CUSTOM_GPT') {
  Write-Host "Detected an existing custom GPT URL. GPT Actions are the preferred Plus path for this setup." -ForegroundColor Green
} elseif ($surface -eq 'NORMAL_CHAT') {
  Write-Host "The saved stock URL is a normal ChatGPT conversation. A private write Action cannot be attached to that normal chat on Plus." -ForegroundColor Yellow
} else {
  Write-Host "Could not prove the saved stock URL is an editable custom GPT. The Action bridge itself is online." -ForegroundColor Yellow
}
Write-Host "Action bridge state synced: $($ready.connected); app online now: $($ready.appOnline)" -ForegroundColor Green
Write-Host "Setup guide written to: $outFile" -ForegroundColor Green
Write-Host ""
Write-Host "Schema URL:" -ForegroundColor Cyan
Write-Host $schemaUrl
Write-Host ""
$sha = [System.Security.Cryptography.SHA256]::Create()
try {
  $tokenBytes = [System.Text.Encoding]::UTF8.GetBytes($token)
  $fingerprint = ([System.BitConverter]::ToString($sha.ComputeHash($tokenBytes))).Replace('-','').Substring(0,12).ToLowerInvariant()
} finally { $sha.Dispose() }
$copied = $false
try {
  Set-Clipboard -Value $token
  $copied = $true
} catch {}
Write-Host "Bearer token fingerprint: $fingerprint" -ForegroundColor DarkGray
if ($copied) {
  Write-Host "Private Bearer token copied to clipboard. Paste it only into the GPT Action Authentication field; do not paste it into chat." -ForegroundColor Green
} else {
  Write-Host "Could not access the Windows clipboard. The token remains private in .env.local; do not print or share it." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "GPT instruction rules:" -ForegroundColor Cyan
Write-Host $instructionsUrl
