param(
  [Parameter(Mandatory=$true)][string]$Root,
  [Parameter(Mandatory=$true)][string]$Package,
  [Parameter(Mandatory=$true)][string]$ExpectedSha256,
  [Parameter(Mandatory=$true)][string]$ExpectedVersion,
  [Parameter(Mandatory=$true)][int]$ParentProcessId
)

$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root)
$Package = [IO.Path]::GetFullPath($Package)
if (-not (Test-Path -LiteralPath $Package -PathType Leaf)) { throw '更新包不存在。' }
$updatesRoot = Join-Path $Root 'data\updates'
$bootstrapRoot = Join-Path $updatesRoot ('bootstrap-' + [Guid]::NewGuid().ToString('N'))
$installerPath = Join-Path $bootstrapRoot 'install-workbench-update.ps1'
$progressPath = Join-Path $updatesRoot 'install-progress.json'

function Write-BootstrapProgress {
  New-Item -ItemType Directory -Force -Path $updatesRoot | Out-Null
  $temporary = $progressPath + '.' + $PID + '.tmp'
  @{ phase='bootstrap'; percent=16; message='更新引导程序已启动，正在准备安装组件…'; version=$ExpectedVersion; error=''; updatedAt=(Get-Date).ToUniversalTime().ToString('o') } |
    ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding UTF8
  Move-Item -LiteralPath $temporary -Destination $progressPath -Force
}

function Write-BootstrapFailure([string]$Message) {
  New-Item -ItemType Directory -Force -Path $updatesRoot | Out-Null
  if (Test-Path -LiteralPath $progressPath -PathType Leaf) {
    try {
      $existing = Get-Content -LiteralPath $progressPath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($existing.phase -eq 'error') { return }
    } catch {}
  }
  $temporary = $progressPath + '.' + $PID + '.tmp'
  @{ phase='error'; percent=16; message='更新引导程序执行失败。'; version=$ExpectedVersion; error=$Message; updatedAt=(Get-Date).ToUniversalTime().ToString('o') } |
    ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding UTF8
  Move-Item -LiteralPath $temporary -Destination $progressPath -Force
}

$failed = $false
try {
  Write-BootstrapProgress
  # Check before executing any installer supplied by this package.
  if ($ExpectedSha256 -notmatch '^[0-9a-fA-F]{64}$') { throw '升级包校验值无效。' }
  $packageStream = [IO.File]::OpenRead($Package)
  $hashAlgorithm = [Security.Cryptography.SHA256]::Create()
  try { $actualSha256 = [BitConverter]::ToString($hashAlgorithm.ComputeHash($packageStream)).Replace('-','') }
  finally { $hashAlgorithm.Dispose(); $packageStream.Dispose() }
  if (-not $actualSha256.Equals($ExpectedSha256,[StringComparison]::OrdinalIgnoreCase)) { throw '升级包完整性校验失败，未执行安装组件。' }
  New-Item -ItemType Directory -Force -Path $bootstrapRoot | Out-Null
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($Package)
  try {
    # Archive tools do not consistently expose path separators through
    # ZipArchive.GetEntry, so compare a normalized package-root path.
    $entries = @($zip.Entries | Where-Object {
      $_.FullName.Replace('\', '/').TrimStart('/') -eq 'scripts/install-workbench-update.ps1'
    })
    if ($entries.Count -ne 1) { throw '升级包必须包含唯一的安装组件。' }
    $entry = $entries[0]
    if ($null -eq $entry -or [string]::IsNullOrWhiteSpace($entry.Name)) { throw '更新包缺少安装组件。' }
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$installerPath,$true)
  } finally { $zip.Dispose() }
  & $installerPath -Root $Root -Package $Package -ExpectedSha256 $ExpectedSha256 -ExpectedVersion $ExpectedVersion -ParentProcessId $ParentProcessId
  if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw ('安装组件执行失败，退出码：' + $LASTEXITCODE) }
} catch {
  $failed = $true
  try { Write-BootstrapFailure $_.Exception.Message } catch {}
  [Console]::Error.WriteLine(('更新引导程序失败：' + $_.Exception.Message))
} finally {
  if (Test-Path -LiteralPath $bootstrapRoot) { Remove-Item -LiteralPath $bootstrapRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
if ($failed) { exit 1 }
