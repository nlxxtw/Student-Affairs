param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'

function Get-ProgramSha256([string]$FilePath) {
  $fileStream = [IO.File]::OpenRead($FilePath)
  $hashAlgorithm = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($hashAlgorithm.ComputeHash($fileStream)).Replace('-','').ToLowerInvariant() }
  finally { $hashAlgorithm.Dispose(); $fileStream.Dispose() }
}

$root = Split-Path -Parent $PSScriptRoot
$port = 18766
if ($env:XIANGCAI_PORT) {
  $configuredPort = 0
  if (-not [int]::TryParse($env:XIANGCAI_PORT,[ref]$configuredPort) -or $configuredPort -lt 1 -or $configuredPort -gt 65535) { throw 'Invalid XIANGCAI_PORT.' }
  $port = $configuredPort
}
$url = "http://127.0.0.1:$port/"
$landing = $url + "login.html"
$node = Join-Path $root 'runtime\node.exe'
$service = Join-Path $root 'web-server.js'
$appScript = Join-Path $root 'app.js'
$stopScript = Join-Path $PSScriptRoot 'stop-workbench.ps1'
$recoveryScript = Join-Path $PSScriptRoot 'recover-interrupted-update.ps1'

if (Test-Path -LiteralPath $recoveryScript -PathType Leaf) { & $recoveryScript -Root $root }

if (-not (Test-Path -LiteralPath $node) -or -not (Test-Path -LiteralPath $service) -or -not (Test-Path -LiteralPath $appScript)) {
  throw 'Workbench runtime files are missing.'
}

$expectedServerHash = Get-ProgramSha256 $service
$expectedAppHash = Get-ProgramSha256 $appScript
$expectedIndexHash = Get-ProgramSha256 (Join-Path $root 'index.html')
$expectedDemoDataHash = Get-ProgramSha256 (Join-Path $root 'demo-data.js')
$expectedSearchableFilterHash = Get-ProgramSha256 (Join-Path $root 'searchable-filter-selects.js')
$expectedSearchableFilterCssHash = Get-ProgramSha256 (Join-Path $root 'searchable-filter-selects.css')
$healthy = $false
$responding = $false
try {
  $health = Invoke-RestMethod -TimeoutSec 2 ($url + 'api/health')
  $responding = $health.ok -eq $true
  $healthy = $responding -and $health.service -eq 'xiangcai-workbench' -and ([string]$health.serverHash).ToLowerInvariant() -eq $expectedServerHash -and ([string]$health.appHash).ToLowerInvariant() -eq $expectedAppHash -and ([string]$health.indexHash).ToLowerInvariant() -eq $expectedIndexHash -and ([string]$health.demoDataHash).ToLowerInvariant() -eq $expectedDemoDataHash -and ([string]$health.searchableFilterHash).ToLowerInvariant() -eq $expectedSearchableFilterHash -and ([string]$health.searchableFilterCssHash).ToLowerInvariant() -eq $expectedSearchableFilterCssHash
} catch {
  $healthy = $false
}

if ($responding -and -not $healthy) {
  & $stopScript
  $deadline = (Get-Date).AddSeconds(5)
  do {
    Start-Sleep -Milliseconds 150
    try { $stillRunning = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 ($url + 'api/health')).StatusCode -eq 200 } catch { $stillRunning = $false }
  } while ($stillRunning -and (Get-Date) -lt $deadline)
  if ($stillRunning) { throw 'An outdated workbench service is still using port 18766. Stop it and retry.' }
  $healthy = $false
}

if (-not $healthy) {
  $dataDir = Join-Path $root 'data'
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
  Start-Process -FilePath $node -ArgumentList ('"' + $service + '"') -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $dataDir 'server.log') `
    -RedirectStandardError (Join-Path $dataDir 'server-error.log')
  $deadline = (Get-Date).AddSeconds(10)
  do {
    Start-Sleep -Milliseconds 250
    try {
      $health = Invoke-RestMethod -TimeoutSec 1 ($url + 'api/health')
      $healthy = $health.ok -eq $true -and $health.service -eq 'xiangcai-workbench' -and ([string]$health.serverHash).ToLowerInvariant() -eq $expectedServerHash -and ([string]$health.appHash).ToLowerInvariant() -eq $expectedAppHash -and ([string]$health.indexHash).ToLowerInvariant() -eq $expectedIndexHash -and ([string]$health.demoDataHash).ToLowerInvariant() -eq $expectedDemoDataHash -and ([string]$health.searchableFilterHash).ToLowerInvariant() -eq $expectedSearchableFilterHash -and ([string]$health.searchableFilterCssHash).ToLowerInvariant() -eq $expectedSearchableFilterCssHash
    } catch {
      $healthy = $false
    }
  } while (-not $healthy -and (Get-Date) -lt $deadline)
  if (-not $healthy) {
    $errorLog = Join-Path $dataDir 'server-error.log'
    $detail = if (Test-Path -LiteralPath $errorLog) { (Get-Content -LiteralPath $errorLog -Tail 8 -ErrorAction SilentlyContinue) -join [Environment]::NewLine } else { '' }
    throw "The local workbench service failed to start. Check data\server-error.log.`n$detail"
  }
}

if (-not $NoBrowser) { Start-Process $landing }
