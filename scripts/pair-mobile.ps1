$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$EnvFile = Join-Path $Root ".env.local"

function Import-LocalEnv {
  if (-not (Test-Path $EnvFile)) { return }
  foreach ($line in Get-Content $EnvFile) {
    $x=$line.Trim();if(-not $x -or $x.StartsWith('#')){continue};$parts=$x.Split('=',2)
    if($parts.Count -eq 2){[Environment]::SetEnvironmentVariable($parts[0].Trim().Trim([char]0xFEFF),$parts[1].Trim(),'Process')}
  }
}
function Get-LanIPv4 {
  $rows = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Sort-Object @{Expression={ if ($_.InterfaceAlias -match 'Wi-Fi|Ethernet') {0} else {1} }},InterfaceMetric
  return ($rows | Select-Object -First 1).IPAddress
}

Import-LocalEnv
if (-not $env:TRADING_API_KEY) { throw "TRADING_API_KEY is missing from .env.local." }
$lan=Get-LanIPv4;if(-not $lan){throw "找不到可用的區網 IPv4。手機與電腦要連同一個 Wi-Fi。"}
$headers=@{'x-api-key'=$env:TRADING_API_KEY}
try{$health=Invoke-RestMethod 'http://127.0.0.1:8787/health' -Headers $headers -TimeoutSec 4}catch{throw "Backend 尚未啟動。先開 Eason Trading，再執行手機配對。"}
if($health.ok -ne $true){throw "Backend health check failed."}
$pair=Invoke-RestMethod 'http://127.0.0.1:8787/v1/pairing/start' -Method Post -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 5
Write-Host "";Write-Host "=== 手機配對 ===" -ForegroundColor Cyan
Write-Host ("Backend: http://"+$lan+":8787") -ForegroundColor Green
Write-Host ("配對碼: "+$pair.code) -ForegroundColor Green
Write-Host "配對碼 5 分鐘內有效，而且成功一次後立即失效。" -ForegroundColor Yellow
Write-Host "手機 App 若顯示 Backend 無法連線，點上方提示 → 連接電腦 → 輸入上面的位址與 6 位碼。" -ForegroundColor Gray
