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
if (-not (Test-Path -LiteralPath (Join-Path $Root 'web-server.js') -PathType Leaf)) { throw '程序目录无效。' }

$dataRoot = Join-Path $Root 'data'
$updatesRoot = Join-Path $dataRoot 'updates'
$progressPath = Join-Path $updatesRoot 'install-progress.json'
$managedManifestPath = Join-Path $updatesRoot 'installed-program-files.json'
$lastInstallPath = Join-Path $updatesRoot 'last-install.json'
$activeInstallPath = Join-Path $updatesRoot 'active-install.json'
$workRoot = Join-Path $updatesRoot ('install-' + [Guid]::NewGuid().ToString('N'))
$stageRoot = Join-Path $workRoot 'stage'
$rollbackRoot = Join-Path $updatesRoot ('rollback-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$allowedTop = @('assets','scripts')
$allowedFiles = @('party-import-engine.js','academic-public-engine.js','academic-public-exams.js','academic-public-files.js','academic-public-report.js','academic-public-import.js','academic-public-analysis.js','academic-public-service.js','academic-public-module.js','academic-public.css','chaoxing-attendance-module.js','web-server.js','workbench-database.js','app.js','student-leave-engine.js','student-leave-module.js','student-leave.css','student-link-integrity.js','index.html','login.html','license-client.js','update-client.js','update-launcher.js','update-config.json','demo-data.js','achievement-enhancements.js','award-statistics-module.js','other-violation-module.js','dorm-roster-module.js','dorm-spatial-module.js','dorm-spatial-module.css','custom-roster-module.js','counselor-growth-module.js','custom-fields-module.js','intelligence-enhancements.js','searchable-filter-selects.js','searchable-filter-selects.css','学生组织管理.html','license-config.json')
$createdFiles = New-Object System.Collections.Generic.List[string]
$script:CurrentUpdatePercent = 15
$script:InstallFailed = $false
$previousManagedBytes = if (Test-Path -LiteralPath $managedManifestPath) { [IO.File]::ReadAllBytes($managedManifestPath) } else { $null }
$previousLastInstallBytes = if (Test-Path -LiteralPath $lastInstallPath) { [IO.File]::ReadAllBytes($lastInstallPath) } else { $null }

function Write-UpdateProgress([string]$Phase,[int]$Percent,[string]$Message,[string]$ErrorMessage = '') {
  New-Item -ItemType Directory -Force -Path $updatesRoot | Out-Null
  $temporary = $progressPath + '.' + $PID + '.tmp'
  @{ phase=$Phase; percent=[Math]::Max(0,[Math]::Min(100,$Percent)); message=$Message; version=$ExpectedVersion; error=$ErrorMessage; updatedAt=(Get-Date).ToUniversalTime().ToString('o') } |
    ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding UTF8
  Move-Item -LiteralPath $temporary -Destination $progressPath -Force
  if ($Phase -ne 'error') { $script:CurrentUpdatePercent = $Percent }
}

function Test-AllowedUpdatePath([string]$Relative) {
  $clean = $Relative.Replace('\','/').TrimStart('/')
  if (-not $clean -or $clean -match '(^|/)\.\.(/|$)' -or [IO.Path]::IsPathRooted($clean)) { return $false }
  if ($allowedFiles -contains $clean) { return $true }
  $first = $clean.Split('/')[0]
  return $allowedTop -contains $first
}

function Get-FileSha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
  finally { $algorithm.Dispose(); $stream.Dispose() }
}

New-Item -ItemType Directory -Force -Path $stageRoot,$rollbackRoot | Out-Null
try {
  Write-UpdateProgress 'verifying' 18 '正在复核升级包完整性…'
  if ((Get-FileSha256 $Package) -ne $ExpectedSha256.ToLowerInvariant()) { throw '更新包 SHA-256 校验失败。' }
  # 先在旧服务仍可响应时完成解压和版本检查，减少网页无法读取进度的时间。
  Write-UpdateProgress 'extracting' 28 '正在预先解压升级包…'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($Package)
  $entryNames = New-Object System.Collections.Generic.HashSet[string]([StringComparer]::OrdinalIgnoreCase)
  try {
    foreach ($entry in $zip.Entries) {
      if ([string]::IsNullOrWhiteSpace($entry.Name)) { continue }
      $relative = $entry.FullName.Replace('\','/').TrimStart('/')
      if (-not (Test-AllowedUpdatePath $relative)) { throw ('更新包包含不允许替换的文件：' + $relative) }
      if (-not $entryNames.Add($relative)) { throw ('更新包包含重复文件路径：' + $relative) }
      $target = Join-Path $stageRoot $relative
      $targetFull = [IO.Path]::GetFullPath($target)
      if (-not $targetFull.StartsWith(([IO.Path]::GetFullPath($stageRoot) + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase)) { throw '更新包路径越界。' }
      New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($targetFull)) | Out-Null
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $targetFull, $true)
    }
  } finally { $zip.Dispose() }
  if (-not (Test-Path -LiteralPath (Join-Path $stageRoot 'web-server.js')) -or -not (Test-Path -LiteralPath (Join-Path $stageRoot 'app.js'))) { throw '更新包不完整，缺少核心程序文件。' }
  $packageAppVersion = [regex]::Match((Get-Content -LiteralPath (Join-Path $stageRoot 'app.js') -Raw -Encoding UTF8),'SYS_VER\s*=\s*"([^"]+)"')
  $packageServerVersion = [regex]::Match((Get-Content -LiteralPath (Join-Path $stageRoot 'web-server.js') -Raw -Encoding UTF8),'APP_VERSION\s*=\s*"([^"]+)"')
  if (-not $packageAppVersion.Success -or -not $packageServerVersion.Success -or $packageAppVersion.Groups[1].Value -ne $ExpectedVersion -or $packageServerVersion.Groups[1].Value -ne $ExpectedVersion) { throw '升级包内部版本号与发行清单不一致。' }

  # 只结束发起本次更新的精确进程，不按名称误杀其他 Node 服务。
  Write-UpdateProgress 'waiting' 44 '升级包准备完成，正在安全退出旧版本服务…'
  if (Get-Process -Id $ParentProcessId -ErrorAction SilentlyContinue) { Stop-Process -Id $ParentProcessId -Force -ErrorAction SilentlyContinue }
  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-Process -Id $ParentProcessId -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 100 }
  if (Get-Process -Id $ParentProcessId -ErrorAction SilentlyContinue) { throw '主程序未能在规定时间内退出，已取消更新。' }

  $stageFiles = @(Get-ChildItem -LiteralPath $stageRoot -Recurse -File)
  $newRelativeFiles = @($stageFiles | ForEach-Object { $_.FullName.Substring($stageRoot.Length).TrimStart('\','/').Replace('\','/') })
  $previousManaged = @()
  if (Test-Path -LiteralPath $managedManifestPath) {
    try { $previousManaged = @((Get-Content -LiteralPath $managedManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json) | Where-Object { $_ -is [string] -and (Test-AllowedUpdatePath $_) }) } catch { $previousManaged = @() }
  }
  # 早期升级包曾记录 runtime/ 文件；它们不能在在线升级中删除，
  # 因为当前服务正使用其中的 node.exe。运行时仅由完整安装包维护。
  $obsoleteFiles = @($previousManaged | Where-Object { $newRelativeFiles -notcontains $_ -and -not $_.StartsWith('runtime/',[StringComparison]::OrdinalIgnoreCase) })
  Write-UpdateProgress 'protecting' 52 '正在保护当前程序文件…'
  $stageFiles | ForEach-Object {
    $relative = $_.FullName.Substring($stageRoot.Length).TrimStart('\','/')
    $target = Join-Path $Root $relative
    $backup = Join-Path $rollbackRoot $relative
    New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($backup)) | Out-Null
    if (Test-Path -LiteralPath $target) { Copy-Item -LiteralPath $target -Destination $backup -Force }
  }
  $journalTemporary = $activeInstallPath + '.' + $PID + '.tmp'
  $previousManagedBase64 = if ($null -ne $previousManagedBytes) { [Convert]::ToBase64String($previousManagedBytes) } else { '' }
  $previousLastInstallBase64 = if ($null -ne $previousLastInstallBytes) { [Convert]::ToBase64String($previousLastInstallBytes) } else { '' }
  @{ version=$ExpectedVersion; installerProcessId=$PID; rollbackRoot=$rollbackRoot; stageRoot=$stageRoot; previousManaged=$previousManaged; newRelativeFiles=$newRelativeFiles; previousManagedBase64=$previousManagedBase64; previousLastInstallBase64=$previousLastInstallBase64; startedAt=(Get-Date).ToUniversalTime().ToString('o') } |
    ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $journalTemporary -Encoding UTF8
  Move-Item -LiteralPath $journalTemporary -Destination $activeInstallPath -Force
  $obsoleteFiles | ForEach-Object {
    $target = Join-Path $Root $_
    if (Test-Path -LiteralPath $target -PathType Leaf) {
      $backup = Join-Path $rollbackRoot $_
      New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($backup)) | Out-Null
      Copy-Item -LiteralPath $target -Destination $backup -Force
      Remove-Item -LiteralPath $target -Force
    }
  }
  Write-UpdateProgress 'installing' 65 '正在安装新版本…'
  $installedCount = 0
  $stageFiles | ForEach-Object {
    $relative = $_.FullName.Substring($stageRoot.Length).TrimStart('\','/')
    $target = Join-Path $Root $relative
    New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($target)) | Out-Null
    if (-not (Test-Path -LiteralPath $target)) { $createdFiles.Add($target) }
    # 先复制到目标目录中的临时文件并复核哈希，再原子替换正式文件。
    # 进程被中断时，旧文件不会只剩半截内容。
    $temporaryTarget = $target + '.update-' + $PID + '.tmp'
    Copy-Item -LiteralPath $_.FullName -Destination $temporaryTarget -Force
    $sourceHash = Get-FileSha256 $_.FullName
    $temporaryHash = Get-FileSha256 $temporaryTarget
    if ($sourceHash -ne $temporaryHash) { Remove-Item -LiteralPath $temporaryTarget -Force -ErrorAction SilentlyContinue; throw ('写入校验失败：' + $relative) }
    Move-Item -LiteralPath $temporaryTarget -Destination $target -Force
    $installedCount++
    $installPercent = 65 + [Math]::Floor(23 * $installedCount / [Math]::Max(1,$stageFiles.Count))
    Write-UpdateProgress 'installing' $installPercent ('正在安装新版本：' + $installedCount + '/' + $stageFiles.Count)
  }

  Write-UpdateProgress 'verifying-install' 89 '正在核验已安装的程序文件…'
  $stageFiles | ForEach-Object {
    $relative = $_.FullName.Substring($stageRoot.Length).TrimStart('\','/')
    $target = Join-Path $Root $relative
    if (-not (Test-Path -LiteralPath $target -PathType Leaf) -or (Get-FileSha256 $_.FullName) -ne (Get-FileSha256 $target)) { throw ('安装后文件校验失败：' + $relative) }
  }

  $record = @{ version=$ExpectedVersion; installedAt=(Get-Date).ToUniversalTime().ToString('o'); packageSha256=$ExpectedSha256; rollback=$rollbackRoot } | ConvertTo-Json
  Set-Content -LiteralPath $lastInstallPath -Value $record -Encoding UTF8
  [IO.File]::WriteAllText($managedManifestPath,($newRelativeFiles | ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
  Remove-Item -LiteralPath (Join-Path $updatesRoot 'last-install-error.json') -Force -ErrorAction SilentlyContinue
  Write-UpdateProgress 'restarting' 92 '程序文件安装完成，正在重启系统…'
  & (Join-Path $Root 'scripts\start-workbench.ps1') -NoBrowser
  Remove-Item -LiteralPath $activeInstallPath -Force -ErrorAction SilentlyContinue
  $downloadsRoot = [IO.Path]::GetFullPath((Join-Path $updatesRoot 'downloads'))
  if ($Package.StartsWith($downloadsRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $Package -Force -ErrorAction SilentlyContinue }
  @(Get-ChildItem -LiteralPath $updatesRoot -Directory -Filter 'rollback-*' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -Skip 2) | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
  Write-UpdateProgress 'completed' 100 ('已成功升级至 ' + $ExpectedVersion + '。')
} catch {
  $script:InstallFailed = $true
  $originalError = $_.Exception.Message
  $rollbackErrors = New-Object System.Collections.Generic.List[string]
  # 若替换中发生异常，尽力恢复已备份的程序文件；data/ 与 backups/ 从未进入替换范围。
  $createdFiles | ForEach-Object {
    try { if (Test-Path -LiteralPath $_ -PathType Leaf) { Remove-Item -LiteralPath $_ -Force } } catch { $rollbackErrors.Add($_.Exception.Message) }
  }
  if (Test-Path -LiteralPath $rollbackRoot) {
    Get-ChildItem -LiteralPath $rollbackRoot -Recurse -File | ForEach-Object {
      try {
        $relative = $_.FullName.Substring($rollbackRoot.Length).TrimStart('\','/')
        $target = Join-Path $Root $relative
        New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($target)) | Out-Null
        Copy-Item -LiteralPath $_.FullName -Destination $target -Force
      } catch { $rollbackErrors.Add($_.Exception.Message) }
    }
  }
  try { if ($null -ne $previousManagedBytes) { [IO.File]::WriteAllBytes($managedManifestPath,$previousManagedBytes) } else { Remove-Item -LiteralPath $managedManifestPath -Force -ErrorAction SilentlyContinue } } catch { $rollbackErrors.Add($_.Exception.Message) }
  try { if ($null -ne $previousLastInstallBytes) { [IO.File]::WriteAllBytes($lastInstallPath,$previousLastInstallBytes) } else { Remove-Item -LiteralPath $lastInstallPath -Force -ErrorAction SilentlyContinue } } catch { $rollbackErrors.Add($_.Exception.Message) }
  $diagnosticError = if ($rollbackErrors.Count) { $originalError + '；回滚异常：' + ($rollbackErrors -join '；') } else { $originalError }
  $failure = @{ failedAt=(Get-Date).ToUniversalTime().ToString('o'); version=$ExpectedVersion; error=$diagnosticError } | ConvertTo-Json
  New-Item -ItemType Directory -Force -Path $updatesRoot | Out-Null
  Set-Content -LiteralPath (Join-Path $updatesRoot 'last-install-error.json') -Value $failure -Encoding UTF8
  try { Write-UpdateProgress 'error' ([Math]::Min(99,$script:CurrentUpdatePercent)) '升级失败，已尝试恢复原版本。' $diagnosticError } catch {}
  Remove-Item -LiteralPath $activeInstallPath -Force -ErrorAction SilentlyContinue
  try { & (Join-Path $Root 'scripts\start-workbench.ps1') -NoBrowser } catch {}
} finally {
  if (Test-Path -LiteralPath $workRoot) { Remove-Item -LiteralPath $workRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
if ($script:InstallFailed) { exit 1 }
