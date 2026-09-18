$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$key = (Get-Clipboard).Trim()
if (-not $key -or $key.Length -lt 10) {
  Write-Host "Clipboard does not look like a Fugle API key. Copy the key first." -ForegroundColor Red
  exit 1
}
$file = Join-Path $root '.env.local'
$lines = @()
if (Test-Path $file) { $lines = Get-Content $file | Where-Object { $_ -notmatch '^\s*FUGLE_API_KEY\s*=' } }
$lines += "FUGLE_API_KEY=$key"
Set-Content -Path $file -Value $lines -Encoding ascii
Write-Host "Fugle API key saved locally to .env.local (not printed)." -ForegroundColor Green
Write-Host "Next time, start-web.ps1 will load it automatically." -ForegroundColor Cyan
