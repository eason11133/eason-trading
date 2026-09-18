param([switch]$RequireMobileTypecheck,[switch]$InstalledRuntime)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not (node -v 2>$null)) { throw "Node.js was not found" }
$nodeSemver=[version]((node -p "process.versions.node").Trim())
if($nodeSemver -lt [version]"22.13.0"){throw "Node.js 22.13+ is required by Expo SDK 57. Found $nodeSemver"}
$nodeArgs=@((Join-Path $root 'scripts\verify-release.mjs'))
if($RequireMobileTypecheck){$nodeArgs+='--require-mobile-typecheck'}
if($InstalledRuntime){$nodeArgs+='--installed-runtime'}
& node @nodeArgs
if($LASTEXITCODE -ne 0){throw "Release verification failed"}
