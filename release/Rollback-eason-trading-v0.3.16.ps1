$ErrorActionPreference="Stop"
$Downloads=Join-Path $env:USERPROFILE 'Downloads'
$BackupBase=Join-Path $Downloads 'eason-trading-backups'
$CurrentPointer=Join-Path $Downloads 'eason-trading-current.txt'
function Hash([string]$p){if(Test-Path $p){return (Get-FileHash -Algorithm SHA256 $p).Hash.ToLowerInvariant()};return $null}
function ValidJsonState([string]$p){if(-not(Test-Path $p)){return $false};try{$x=Get-Content $p -Raw|ConvertFrom-Json;return ($null -ne $x.positions -and $null -ne $x.trades -and $null -ne $x.metadata)}catch{return $false}}
$current=$null;if(Test-Path $CurrentPointer){$current=(Get-Content $CurrentPointer -Raw).Trim()}
$backups=@(Get-ChildItem $BackupBase -Directory -ErrorAction SilentlyContinue|Sort-Object Name -Descending);$Backup=$null
if($current){foreach($b in $backups){$f=Join-Path $b.FullName 'installed-root.txt';if((Test-Path $f)-and((Get-Content $f -Raw).Trim() -eq $current)){$Backup=$b;break}}}
if(-not $Backup){$Backup=$backups|Where-Object{Test-Path (Join-Path $_.FullName 'previous-root.txt')}|Select-Object -First 1;Write-Host 'Active pointer did not identify a backup; using legacy newest compatible backup.' -ForegroundColor Yellow}
if(-not $Backup){throw 'No Eason Trading rollback backup was found.'}
$PreviousRoot=(Get-Content (Join-Path $Backup.FullName 'previous-root.txt') -Raw).Trim();if(-not(Test-Path $PreviousRoot)){throw "Previous install folder no longer exists: $PreviousRoot"}
foreach($port in 8787,8081){$listeners=Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue;foreach($listener in $listeners){Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue}}

# Snapshot the CURRENT active ledger before any rollback write. New trades made after the upgrade must never be erased.
$InstalledRootFile=Join-Path $Backup.FullName 'installed-root.txt';$InstalledRoot=$null
if(Test-Path $InstalledRootFile){$InstalledRoot=(Get-Content $InstalledRootFile -Raw).Trim()}
$CarryState=$null;$CarryEnv=$null
if($InstalledRoot -and (Test-Path $InstalledRoot)){
 $CurrentState=Join-Path $InstalledRoot 'server\data\state.json';$CurrentEnv=Join-Path $InstalledRoot '.env.local'
 if(ValidJsonState $CurrentState){$CarryState=Join-Path $Backup.FullName 'rollback-current-state.json';Copy-Item $CurrentState $CarryState -Force;Write-Host 'Latest active ledger snapshotted for rollback carry-forward.' -ForegroundColor Green}
 if(Test-Path $CurrentEnv){$CarryEnv=Join-Path $Backup.FullName 'rollback-current-env.local';Copy-Item $CurrentEnv $CarryEnv -Force}
 $carryManifest=[ordered]@{capturedAt=(Get-Date).ToString('o');sourceRoot=$InstalledRoot;stateSha256=Hash $CarryState;envSha256=Hash $CarryEnv}
 $carryManifest|ConvertTo-Json|Set-Content (Join-Path $Backup.FullName 'rollback-current-manifest.json') -Encoding utf8
 # Disarm Cloud targets before old code resumes.
 if(Test-Path $CurrentEnv){$map=@{};foreach($line in Get-Content $CurrentEnv){$x=$line.Trim();if(-not $x -or $x.StartsWith('#')){continue};$parts=$x.Split('=',2);if($parts.Count -eq 2){$map[$parts[0].Trim()]=$parts[1].Trim()}};if($map['CLOUD_MONITOR_URL'] -and $map['CLOUD_MONITOR_API_KEY']){try{Invoke-RestMethod ($map['CLOUD_MONITOR_URL'].TrimEnd('/')+'/v1/monitor/targets') -Method Put -Headers @{'x-api-key'=$map['CLOUD_MONITOR_API_KEY']} -ContentType 'application/json' -Body '{"targets":[]}' -TimeoutSec 15|Out-Null;Write-Host 'Cloud Monitor targets disarmed before rollback.' -ForegroundColor Green}catch{Write-Host 'Could not disarm Cloud Monitor automatically. Check Cloudflare before relying on notifications.' -ForegroundColor Yellow}}}
}

# Verify the pre-install safety backup. It remains the disaster-recovery fallback, not the default state to restore.
$manifestFile=Join-Path $Backup.FullName 'backup-manifest.json';if(Test-Path $manifestFile){$m=Get-Content $manifestFile -Raw|ConvertFrom-Json;foreach($pair in @(@('state.json','state'),@('state.json.bak','stateBak'),@('.env.local','env'))){$f=Join-Path $Backup.FullName $pair[0];$expected=[string]$m.files.($pair[1]);if($expected -and (Hash $f) -ne $expected){throw "Backup integrity check failed for $($pair[0])"}}}
$BackupState=Join-Path $Backup.FullName 'state.json';$BackupStateBak=Join-Path $Backup.FullName 'state.json.bak';$BackupEnv=Join-Path $Backup.FullName '.env.local'
$StateToRestore=$null
if($CarryState -and (ValidJsonState $BackupState)){
 $MergedState=Join-Path $Backup.FullName 'rollback-merged-state.json'
 node (Join-Path $InstalledRoot 'scripts\merge-rollback-state.mjs') $BackupState $CarryState $MergedState
 if($LASTEXITCODE -ne 0 -or -not(ValidJsonState $MergedState)){throw 'Could not merge the latest ledger into the previous-version state safely.'}
 $StateToRestore=$MergedState
 Write-Host 'Latest durable data merged into the previous-version state schema.' -ForegroundColor Green
}elseif($CarryState){$StateToRestore=$CarryState}elseif(ValidJsonState $BackupState){$StateToRestore=$BackupState}
$EnvToRestore=if($CarryEnv){$CarryEnv}elseif(Test-Path $BackupEnv){$BackupEnv}else{$null}
if($StateToRestore){New-Item -ItemType Directory -Force -Path (Join-Path $PreviousRoot 'server\data')|Out-Null;Copy-Item $StateToRestore (Join-Path $PreviousRoot 'server\data\state.json') -Force}
# Keep the old pre-upgrade state as state.json.bak when available, giving one more manual recovery point.
if(Test-Path $BackupState){Copy-Item $BackupState (Join-Path $PreviousRoot 'server\data\state.json.bak') -Force}elseif(Test-Path $BackupStateBak){Copy-Item $BackupStateBak (Join-Path $PreviousRoot 'server\data\state.json.bak') -Force}
if($EnvToRestore){Copy-Item $EnvToRestore (Join-Path $PreviousRoot '.env.local') -Force}
Set-Content $CurrentPointer $PreviousRoot -Encoding ascii
Set-Location $PreviousRoot
Write-Host "Restored code root $PreviousRoot; latest active ledger was carried forward when available." -ForegroundColor Green
Write-Host "Pre-upgrade backup remains intact at $($Backup.FullName)." -ForegroundColor DarkGray
PowerShell -ExecutionPolicy Bypass -File .\scripts\start-web.ps1
