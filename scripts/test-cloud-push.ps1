$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$EnvFile = Join-Path $Root '.env.local'
function Read-EnvFile {
  $map=@{}; if(-not(Test-Path $EnvFile)){return $map}
  foreach($line in Get-Content $EnvFile){$x=$line.Trim();if(-not $x -or $x.StartsWith('#')){continue};$parts=$x.Split('=',2);if($parts.Count -eq 2){$map[$parts[0].Trim().Trim([char]0xFEFF)]=$parts[1].Trim()}}
  return $map
}
$envMap=Read-EnvFile
$Url=[string]$envMap['CLOUD_MONITOR_URL'];$Key=[string]$envMap['CLOUD_MONITOR_API_KEY']
if(-not $Url){throw 'CLOUD_MONITOR_URL is missing. Run scripts\setup-cloud-monitor.ps1 first.'}
if(-not $Key){throw 'CLOUD_MONITOR_API_KEY is missing. Run scripts\setup-cloud-monitor.ps1 first.'}
$Url=$Url.TrimEnd('/')
Write-Host "=== Eason Trading Cloud Push test ===" -ForegroundColor Cyan
try{
  $r=Invoke-RestMethod ($Url+'/v1/devices/test-push') -Method Post -Headers @{'x-api-key'=$Key} -ContentType 'application/json' -Body '{}' -TimeoutSec 20
  if(-not $r.ok){throw 'Cloud accepted the test request but Expo did not report any successful ticket.'}
  Write-Host ("Test push submitted: sent="+$r.sent+", failed="+$r.failed) -ForegroundColor Green
  Write-Host '這只是通知鏈路測試，不會建立 Trigger、交易或 GPT 待辦。請確認手機有收到「Eason Trading 雲端通知測試」。' -ForegroundColor Yellow
}catch{
  $status=$_.Exception.Response.StatusCode.value__
  if($status -eq 409){throw 'Cloud Monitor online, but no enabled phone is registered. Install/pair the push-capable app and open it once while the PC is online.'}
  throw
}
