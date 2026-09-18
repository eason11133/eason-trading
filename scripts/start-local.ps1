$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "scripts\start-backend.ps1")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
