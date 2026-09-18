param([switch]$SkipPushTest)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$EnvFile = Join-Path $Root ".env.local"
$StateFile = Join-Path $Root "server\data\state.json"

function Read-EnvMap {
  $m=@{}
  if(-not (Test-Path $EnvFile)){return $m}
  foreach($line in Get-Content $EnvFile){
    $x=$line.Trim(); if(-not $x -or $x.StartsWith("#")){continue}
    $p=$x.Split("=",2); if($p.Count -eq 2){$m[$p[0].Trim().Trim([char]0xFEFF)]=$p[1].Trim()}
  }
  return $m
}
function Require([bool]$Ok,[string]$Message){if(-not $Ok){throw $Message}}
function Get-LedgerHash {
  $x = & node (Join-Path $Root "scripts\ledger-fingerprint.mjs") $StateFile
  if($LASTEXITCODE -ne 0 -or -not $x){throw "Could not fingerprint local Ledger truth."}
  return ([string]$x).Trim()
}

Write-Host "=== Eason Trading v0.3.18 production audit ===" -ForegroundColor Cyan
$envMap=Read-EnvMap
$localKey=[string]$envMap['TRADING_API_KEY'];$cloudUrl=([string]$envMap['CLOUD_MONITOR_URL']).TrimEnd('/');$cloudKey=[string]$envMap['CLOUD_MONITOR_API_KEY'];$bearer=[string]$envMap['GPT_DIRECT_MCP_TOKEN']
Require ($localKey.Length -ge 20) "TRADING_API_KEY missing."
Require ($cloudUrl -match '^https://') "CLOUD_MONITOR_URL missing."
Require ($cloudKey.Length -ge 20) "CLOUD_MONITOR_API_KEY missing."
Require ($bearer.Length -ge 20) "GPT_DIRECT_MCP_TOKEN missing."
Require (Test-Path $StateFile) "Local state.json missing."
$localHeaders=@{'x-api-key'=$localKey};$cloudHeaders=@{'x-api-key'=$cloudKey};$bearerHeaders=@{Authorization=('Bearer '+$bearer)}
$before=Get-LedgerHash

$health=Invoke-RestMethod 'http://127.0.0.1:8787/health' -Headers $localHeaders -TimeoutSec 10
Require ($health.ok -eq $true -and $health.version -eq '0.3.18') "Local Backend is not v0.3.18 ready."
Require ($health.auditMode -eq $true) "Production audit requires EASON_AUDIT_MODE=1 so unrelated pending GPT commands cannot be applied during verification."
Require ($health.marketDataVerified -eq $true) "Fugle verification is not ready."

$cloud=Invoke-RestMethod ($cloudUrl+'/health') -Headers $cloudHeaders -TimeoutSec 20
Require ($cloud.ok -eq $true -and $cloud.monitorOnly -eq $true -and $cloud.version -eq '0.3.18') "Cloud Worker health/version/monitorOnly check failed."

$sync=Invoke-RestMethod 'http://127.0.0.1:8787/v1/cloud-monitor/sync?applyCommands=false' -Method Post -Headers $localHeaders -ContentType 'application/json' -Body '{}' -TimeoutSec 90
Require ($sync.ok -eq $true) "Full Backend-to-Cloud sync returned ok=false."

$schema=Invoke-RestMethod ($cloudUrl+'/gpt-action-openapi.json') -TimeoutSec 20
Require ($schema.openapi -eq '3.1.0') "GPT Action OpenAPI is not 3.1.0."
$strategySchema=$schema.paths.'/v1/gpt-action/strategy'.post.requestBody.content.'application/json'.schema
Require ($null -ne $strategySchema.properties.reviewEventId) "Deployed GPT Action schema is missing reviewEventId correlation."

$ready=Invoke-RestMethod ($cloudUrl+'/v1/gpt-action/readiness') -Headers $bearerHeaders -TimeoutSec 20
Require ($ready.ok -eq $true -and $ready.connected -eq $true -and $ready.appOnline -eq $true) "GPT bridge is not freshly synced to the running Backend."
Require ([string]$ready.sourceVersion -eq '0.3.18') "GPT bridge sourceVersion is not v0.3.18."

# Non-mutating Cloud command queue -> local Backend -> Cloud acknowledgement roundtrip.
$ping=Invoke-RestMethod ($cloudUrl+'/v1/gpt-bridge/roundtrip-test') -Method Post -Headers $cloudHeaders -ContentType 'application/json' -Body '{}' -TimeoutSec 20
Require ($ping.ok -eq $true -and $ping.command.id) "Could not queue Cloud/Backend roundtrip PING."
$direct=Invoke-RestMethod 'http://127.0.0.1:8787/v1/gpt-direct/roundtrip-test' -Method Post -Headers $localHeaders -ContentType 'application/json' -Body (@{commandId=[string]$ping.command.id}|ConvertTo-Json -Compress) -TimeoutSec 30
Require ($direct.ok -eq $true -and $direct.ping.ok -eq $true) "Local GPT Direct PING reconcile failed."
$pingStatus=Invoke-RestMethod ($cloudUrl+'/v1/gpt-bridge/commands/'+[uri]::EscapeDataString([string]$ping.command.id)) -Headers $cloudHeaders -TimeoutSec 20
Require ($pingStatus.status -eq 'APPLIED' -and $pingStatus.kind -eq 'PING') "Cloud/Backend roundtrip PING was not acknowledged."

if(-not $SkipPushTest){
  $push=Invoke-RestMethod ($cloudUrl+'/v1/devices/test-push') -Method Post -Headers $cloudHeaders -ContentType 'application/json' -Body '{}' -TimeoutSec 25
  Require ($push.ok -eq $true -and [int]$push.sent -ge 1) "Expo did not return a successful push ticket for any registered phone."
  Write-Host ("Push ticket PASS: sent="+$push.sent+", failed="+$push.failed) -ForegroundColor Green
}

$settings=Invoke-RestMethod 'http://127.0.0.1:8787/v1/settings' -Headers $localHeaders -TimeoutSec 10
$url=[string]$settings.stockChatUrl
$surface='NONE';if($url -match '^https://(www\.)?chatgpt\.com/g/'){$surface='CUSTOM_GPT'}elseif($url -match '^https://(www\.)?chatgpt\.com/c/'){$surface='NORMAL_CHAT'}elseif($url){$surface='OTHER'}

$after=Get-LedgerHash
Require ($before -eq $after) "Ledger truth fingerprint changed during production audit."
Write-Host "Backend/Cloud full sync PASS." -ForegroundColor Green
Write-Host "GPT read bridge + non-mutating command roundtrip PASS." -ForegroundColor Green
Write-Host "Ledger truth fingerprint unchanged." -ForegroundColor Green
Write-Host ("Saved GPT surface: "+$surface) -ForegroundColor $(if($surface -eq 'CUSTOM_GPT'){'Green'}else{'Yellow'})
if($surface -ne 'CUSTOM_GPT'){
  Write-Host "Account-side Action is NOT proven by the saved URL. A normal /c/ chat cannot host the private Action; use an editable custom GPT /g/." -ForegroundColor Yellow
}else{
  Write-Host "Custom GPT URL detected. The Worker Action endpoint is ready; the GPT editor's actual attached Action still requires one real ChatGPT invocation to prove account-side configuration." -ForegroundColor Yellow
}
Write-Host "PRODUCTION AUDIT PASS (code/cloud/backend/push-ticket/ledger)." -ForegroundColor Green
