$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$EnvFile = Join-Path $Root '.env.local'
$ApiKey=''
if(Test-Path $EnvFile){foreach($line in Get-Content $EnvFile){$x=$line.Trim();if(-not $x -or $x.StartsWith('#')){continue};$parts=$x.Split('=',2);if($parts.Count -eq 2 -and $parts[0].Trim().Trim([char]0xFEFF) -eq 'TRADING_API_KEY'){$ApiKey=$parts[1].Trim()}}}
if(-not $ApiKey){throw 'TRADING_API_KEY is missing from .env.local.'}
$cfg = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' -and $_.IPv4Address.IPAddress } | Select-Object -First 1
if (-not $cfg) { throw "Could not find the primary LAN IP address." }
$ip = $cfg.IPv4Address.IPAddress
Write-Host "PC LAN IP: $ip"
Write-Host "Phone Backend URL: http://${ip}:8787"
try { Invoke-RestMethod "http://${ip}:8787/health" -Headers @{'x-api-key'=$ApiKey} -TimeoutSec 3 | ConvertTo-Json } catch { Write-Host "Backend is not running, authentication failed, or Windows Firewall is blocking LAN access." -ForegroundColor Yellow }
