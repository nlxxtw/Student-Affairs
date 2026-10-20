param([Parameter(Mandatory=$true)][string]$Root)

$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root)
$updatesRoot = [IO.Path]::GetFullPath((Join-Path $Root 'data\updates'))
$journalPath = Join-Path $updatesRoot 'active-install.json'
if (-not (Test-Path -LiteralPath $journalPath -PathType Leaf)) { return }
$journal = Get-Content -LiteralPath $journalPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($journal.installerProcessId -and (Get-Process -Id ([int]$journal.installerProcessId) -ErrorAction SilentlyContinue)) { return }

# If the target version is already healthy, the installer only missed journal cleanup.
try {
  $health = Invoke-RestMethod -TimeoutSec 2 'http://127.0.0.1:18766/api/health'
  if ($health.ok -eq $true -and [string]$health.version -eq [string]$journal.version) {
    Remove-Item -LiteralPath $journalPath -Force
    return
  }
} catch {}

$rollbackRoot = [IO.Path]::GetFullPath([string]$journal.rollbackRoot)
$stageRoot = [IO.Path]::GetFullPath([string]$journal.stageRoot)
if (-not $rollbackRoot.StartsWith($updatesRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or
    -not $stageRoot.StartsWith($updatesRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe interrupted-update recovery path.' }
$previousManaged = @($journal.previousManaged | ForEach-Object { [string]$_ })
if (Test-Path -LiteralPath $rollbackRoot -PathType Container) {
  Get-ChildItem -LiteralPath $rollbackRoot -Recurse -File | ForEach-Object {
    $relative = $_.FullName.Substring($rollbackRoot.Length).TrimStart('\','/')
    $target = Join-Path $Root $relative
    New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($target)) | Out-Null
    Copy-Item -LiteralPath $_.FullName -Destination $target -Force
  }
}
@($journal.newRelativeFiles | ForEach-Object { [string]$_ }) | ForEach-Object {
    $relative = $_.Replace('\','/').TrimStart('/')
    if (-not $relative -or $relative -match '(^|/)\.\.(/|$)' -or [IO.Path]::IsPathRooted($relative)) { throw 'Unsafe interrupted-update file path.' }
    $backup = Join-Path $rollbackRoot $relative
    $target = Join-Path $Root $relative
    if ($previousManaged -notcontains $relative -and -not (Test-Path -LiteralPath $backup -PathType Leaf) -and (Test-Path -LiteralPath $target -PathType Leaf)) { Remove-Item -LiteralPath $target -Force }
}
$managedManifestPath = Join-Path $updatesRoot 'installed-program-files.json'
$lastInstallPath = Join-Path $updatesRoot 'last-install.json'
if ($journal.previousManagedBase64) { [IO.File]::WriteAllBytes($managedManifestPath,[Convert]::FromBase64String([string]$journal.previousManagedBase64)) } else { Remove-Item -LiteralPath $managedManifestPath -Force -ErrorAction SilentlyContinue }
if ($journal.previousLastInstallBase64) { [IO.File]::WriteAllBytes($lastInstallPath,[Convert]::FromBase64String([string]$journal.previousLastInstallBase64)) } else { Remove-Item -LiteralPath $lastInstallPath -Force -ErrorAction SilentlyContinue }
$progressPath = Join-Path $updatesRoot 'install-progress.json'
$temporary = $progressPath + '.' + $PID + '.tmp'
@{ phase='error'; percent=0; message='An interrupted update was automatically rolled back.'; version=[string]$journal.version; error='The previous update process ended before completion. The prior program files were restored.'; updatedAt=(Get-Date).ToUniversalTime().ToString('o') } |
  ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding UTF8
Move-Item -LiteralPath $temporary -Destination $progressPath -Force
Remove-Item -LiteralPath $journalPath -Force
