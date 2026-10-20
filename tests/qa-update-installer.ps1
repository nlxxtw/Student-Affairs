$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$installer = Join-Path $projectRoot 'scripts\install-workbench-update.ps1'
$bootstrap = Join-Path $projectRoot 'scripts\update-bootstrap.ps1'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('shuzhi-installer-qa-' + [Guid]::NewGuid().ToString('N'))
$packageRoot = Join-Path $testRoot '_package'
$packagePath = Join-Path $testRoot 'update.zip'
$failingPackagePath = Join-Path $testRoot 'startup-failure-update.zip'
$dummyParent = $null
$launcherHost = $null
$newModuleFiles = @('student-leave-engine.js','student-leave-module.js','student-leave.css','student-link-integrity.js','party-import-engine.js','academic-public-engine.js','academic-public-exams.js','academic-public-files.js','academic-public-report.js','academic-public-import.js','academic-public-analysis.js','academic-public-service.js','academic-public-module.js','academic-public.css','chaoxing-attendance-module.js','workbench-database.js')

function Assert-True([bool]$Condition,[string]$Message) { if (-not $Condition) { throw $Message } }

try {
  New-Item -ItemType Directory -Force -Path $testRoot,$packageRoot,(Join-Path $testRoot 'data\updates'),(Join-Path $testRoot 'scripts'),(Join-Path $testRoot 'assets'),(Join-Path $testRoot 'runtime'),(Join-Path $packageRoot 'scripts') | Out-Null
  Set-Content -LiteralPath (Join-Path $testRoot 'web-server.js') -Value 'old-server' -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $testRoot 'app.js') -Value 'old-app' -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $testRoot 'data\sentinel.txt') -Value 'user-data-must-survive' -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $testRoot 'scripts\start-workbench.ps1') -Value '$null = 1' -Encoding ASCII
  Copy-Item -LiteralPath $bootstrap -Destination (Join-Path $testRoot 'scripts\update-bootstrap.ps1') -Force
  Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\start-update-bootstrap.ps1') -Destination (Join-Path $testRoot 'scripts\start-update-bootstrap.ps1') -Force
  Set-Content -LiteralPath (Join-Path $testRoot 'assets\obsolete.js') -Value 'obsolete' -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $testRoot 'runtime\node.exe') -Value 'runtime-must-survive-online-update' -Encoding ASCII
  [IO.File]::WriteAllText((Join-Path $testRoot 'data\updates\installed-program-files.json'),'["assets/obsolete.js","runtime/node.exe"]',(New-Object Text.UTF8Encoding($false)))
  1..3 | ForEach-Object { $dir=Join-Path $testRoot ('data\updates\rollback-old-' + $_); New-Item -ItemType Directory -Force -Path $dir | Out-Null; Set-Content -LiteralPath (Join-Path $dir 'old.txt') -Value 'old' -Encoding ASCII; (Get-Item $dir).LastWriteTime=(Get-Date).AddMinutes(-10-$_) }
  Set-Content -LiteralPath (Join-Path $packageRoot 'web-server.js') -Value 'const APP_VERSION = "V9.9.9"; // new-server' -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $packageRoot 'app.js') -Value 'let SYS_VER="V9.9.9"; // new-app' -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $packageRoot 'scripts\start-workbench.ps1') -Value '$null = 1' -Encoding ASCII
  Copy-Item -LiteralPath $installer -Destination (Join-Path $packageRoot 'scripts\install-workbench-update.ps1') -Force
  $packageItems = @((Join-Path $packageRoot 'web-server.js'),(Join-Path $packageRoot 'app.js'),(Join-Path $packageRoot 'scripts'))
  foreach ($moduleFile in $newModuleFiles) {
    $modulePath = Join-Path $packageRoot $moduleFile
    Set-Content -LiteralPath $modulePath -Value ('// verified new module ' + $moduleFile) -Encoding UTF8
    $packageItems += $modulePath
  }
  Compress-Archive -LiteralPath $packageItems -DestinationPath $packagePath -CompressionLevel Optimal
  $hash = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $dummyParent = Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoLogo','-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 30' -WindowStyle Hidden -PassThru
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $bootstrap -Root $testRoot -Package $packagePath -ExpectedSha256 $hash -ExpectedVersion V9.9.9 -ParentProcessId $dummyParent.Id
  if ($LASTEXITCODE -ne 0) { throw '隔离安装程序返回失败。' }
  foreach ($moduleFile in $newModuleFiles) {
    Assert-True (Test-Path -LiteralPath (Join-Path $testRoot $moduleFile)) ('新增模块未安装：' + $moduleFile)
    Assert-True ((Get-FileHash -LiteralPath (Join-Path $testRoot $moduleFile)).Hash -eq (Get-FileHash -LiteralPath (Join-Path $packageRoot $moduleFile)).Hash) ('新增模块安装内容不一致：' + $moduleFile)
  }
  $dummyParent.Refresh()
  Assert-True $dummyParent.HasExited '更新程序没有在预解压完成后结束指定的旧服务进程。'
  $progress = Get-Content -LiteralPath (Join-Path $testRoot 'data\updates\install-progress.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  Assert-True ((Get-Content -LiteralPath (Join-Path $testRoot 'web-server.js') -Raw -Encoding UTF8) -match 'new-server') '程序文件没有完成替换。'
  Assert-True ((Get-Content -LiteralPath (Join-Path $testRoot 'data\sentinel.txt') -Raw -Encoding UTF8).Trim() -eq 'user-data-must-survive') '更新过程修改了用户数据。'
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $testRoot 'assets\obsolete.js'))) '上一版本已废弃的程序文件没有清理。'
  Assert-True ((Get-Content -LiteralPath (Join-Path $testRoot 'runtime\node.exe') -Raw -Encoding ASCII).Trim() -eq 'runtime-must-survive-online-update') '在线升级错误替换或删除了正在使用的运行时。'
  Assert-True (@(Get-ChildItem -LiteralPath (Join-Path $testRoot 'data\updates') -Directory -Filter 'rollback-*').Count -le 2) '本机回滚目录没有执行保留数量清理。'
  Assert-True ($progress.phase -eq 'completed' -and [int]$progress.percent -eq 100) '安装进度没有到达 100%。'
  Assert-True (Test-Path -LiteralPath (Join-Path $testRoot 'data\updates\last-install.json')) '缺少安装完成记录。'
  Write-Output 'qa-update-installer: direct bootstrap passed'

  # 从 Node 启动真实 PowerShell 引导程序，并由引导程序结束其父 Node 进程。
  # 这覆盖了正式网页服务曾经卡在 15% 的同一条进程链路。
  Remove-Item -LiteralPath (Join-Path $testRoot 'data\updates\install-progress.json') -Force -ErrorAction SilentlyContinue
  $launcherConfigPath = Join-Path $testRoot 'launcher-config.json'
  @{ projectRoot=$projectRoot; installRoot=$testRoot; packageFile=$packagePath; sha256=$hash; version='V9.9.9' } |
    ConvertTo-Json | Set-Content -LiteralPath $launcherConfigPath -Encoding UTF8
  $node = Join-Path $projectRoot 'runtime\node.exe'
  $launcherFixture = Join-Path $projectRoot 'tests\fixtures\update-launch-host.cjs'
  $launcherHost = Start-Process -FilePath $node -ArgumentList ('"' + $launcherFixture + '"'),('"' + $launcherConfigPath + '"') -WindowStyle Hidden -PassThru
  Write-Output ('qa-update-installer: launcher host pid=' + $launcherHost.Id + ', test pid=' + $PID)
  $launcherDeadline = (Get-Date).AddSeconds(35)
  $launcherProgress = $null
  do {
    Start-Sleep -Milliseconds 200
    if (Test-Path -LiteralPath (Join-Path $testRoot 'data\updates\install-progress.json')) {
      try { $launcherProgress = Get-Content -LiteralPath (Join-Path $testRoot 'data\updates\install-progress.json') -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $launcherProgress = $null }
    }
  } while (($null -eq $launcherProgress -or $launcherProgress.phase -ne 'completed') -and (Get-Date) -lt $launcherDeadline)
  $launcherHost.Refresh()
  Assert-True $launcherHost.HasExited 'Node 启动的更新器没有结束指定的父进程。'
  $launcherDiagnostic = if ($launcherProgress) { ($launcherProgress | ConvertTo-Json -Compress) } else { 'no-progress' }
  if (Test-Path -LiteralPath (Join-Path $testRoot 'data\updates\launcher-host-error.txt')) { $launcherDiagnostic += '; host=' + (Get-Content -LiteralPath (Join-Path $testRoot 'data\updates\launcher-host-error.txt') -Raw) }
  if (Test-Path -LiteralPath (Join-Path $testRoot 'data\updates\launcher-e2e.log')) { $launcherDiagnostic += '; log=' + ((Get-Content -LiteralPath (Join-Path $testRoot 'data\updates\launcher-e2e.log') -Tail 20) -join ' | ') }
  Assert-True ($launcherProgress -and $launcherProgress.phase -eq 'completed' -and [int]$launcherProgress.percent -eq 100) ('Node 启动更新器后未完成安装：' + $launcherDiagnostic)
  Write-Output 'qa-update-installer: node launcher lifecycle passed'
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $testRoot 'data\updates\launcher-host-error.txt'))) 'Node 更新启动器报告异常。'
  Assert-True (Test-Path -LiteralPath (Join-Path $testRoot 'data\updates\launcher-e2e.log')) 'Node 更新启动器没有生成诊断日志。'
  $managedBeforeStartupFailure = [IO.File]::ReadAllBytes((Join-Path $testRoot 'data\updates\installed-program-files.json'))
  $lastInstallBeforeStartupFailure = [IO.File]::ReadAllBytes((Join-Path $testRoot 'data\updates\last-install.json'))

  # 模拟替换多个文件期间进程被强制结束；下次启动前必须恢复旧文件并删除新增文件。
  $interruptedRollback = Join-Path $testRoot 'data\updates\rollback-interrupted'
  $interruptedStage = Join-Path $testRoot 'data\updates\install-interrupted\stage'
  New-Item -ItemType Directory -Force -Path $interruptedRollback,$interruptedStage | Out-Null
  Copy-Item -LiteralPath (Join-Path $testRoot 'web-server.js') -Destination (Join-Path $interruptedRollback 'web-server.js') -Force
  Set-Content -LiteralPath (Join-Path $testRoot 'web-server.js') -Value 'partial-new-server' -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $testRoot 'update-launcher.js') -Value 'partial-new-file' -Encoding UTF8
  $managedForRecovery = Get-Content -LiteralPath (Join-Path $testRoot 'data\updates\installed-program-files.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  @{ version='V9.9.10'; installerProcessId=999999; rollbackRoot=$interruptedRollback; stageRoot=$interruptedStage; previousManaged=@($managedForRecovery); newRelativeFiles=@('web-server.js','update-launcher.js'); previousManagedBase64=[Convert]::ToBase64String($managedBeforeStartupFailure); previousLastInstallBase64=[Convert]::ToBase64String($lastInstallBeforeStartupFailure) } |
    ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $testRoot 'data\updates\active-install.json') -Encoding UTF8
  & (Join-Path $projectRoot 'scripts\recover-interrupted-update.ps1') -Root $testRoot
  Assert-True ((Get-Content -LiteralPath (Join-Path $testRoot 'web-server.js') -Raw -Encoding UTF8) -match 'new-server') '中断恢复没有还原被替换的旧文件。'
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $testRoot 'update-launcher.js'))) '中断恢复没有删除半途新增的程序文件。'
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $testRoot 'data\updates\active-install.json'))) '中断恢复完成后仍残留活动事务日志。'
  $interruptedProgress = Get-Content -LiteralPath (Join-Path $testRoot 'data\updates\install-progress.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  Assert-True ($interruptedProgress.phase -eq 'error') '中断恢复没有留下可见诊断状态。'

  # 新文件已经替换、但启动新版本失败时，程序文件和安装记录都必须恢复。
  Set-Content -LiteralPath (Join-Path $packageRoot 'web-server.js') -Value 'const APP_VERSION = "V9.9.10"; // failed-server' -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $packageRoot 'app.js') -Value 'let SYS_VER="V9.9.10"; // failed-app' -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $packageRoot 'scripts\start-workbench.ps1') -Value "throw 'simulated startup failure'" -Encoding UTF8
  Compress-Archive -LiteralPath (Join-Path $packageRoot 'web-server.js'),(Join-Path $packageRoot 'app.js'),(Join-Path $packageRoot 'scripts') -DestinationPath $failingPackagePath -CompressionLevel Optimal
  $failingHash = (Get-FileHash -LiteralPath $failingPackagePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $null = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $bootstrap -Root $testRoot -Package $failingPackagePath -ExpectedSha256 $failingHash -ExpectedVersion V9.9.10 -ParentProcessId 999999 2>&1
    $startupFailureExitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousErrorAction }
  Assert-True ($startupFailureExitCode -ne 0) '新版本启动失败的升级包未被判定为失败。'
  Assert-True ((Get-Content -LiteralPath (Join-Path $testRoot 'web-server.js') -Raw -Encoding UTF8) -match 'new-server') '启动失败后程序文件没有恢复到原版本。'
  foreach ($moduleFile in $newModuleFiles) {
    Assert-True (Test-Path -LiteralPath (Join-Path $testRoot $moduleFile)) ('启动失败回滚未恢复新增模块：' + $moduleFile)
  }
  Assert-True ([Convert]::ToBase64String($managedBeforeStartupFailure) -eq [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $testRoot 'data\updates\installed-program-files.json')))) '启动失败后程序文件清单没有恢复。'
  Assert-True ([Convert]::ToBase64String($lastInstallBeforeStartupFailure) -eq [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $testRoot 'data\updates\last-install.json')))) '启动失败后安装完成记录没有恢复。'
  Assert-True (Test-Path -LiteralPath (Join-Path $testRoot 'data\updates\last-install-error.json')) '启动失败后缺少故障记录。'
  $startupFailureProgress = Get-Content -LiteralPath (Join-Path $testRoot 'data\updates\install-progress.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  Assert-True ([string]$startupFailureProgress.error -match 'simulated startup failure') '引导程序覆盖了安装器提供的根因诊断。'

  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $null = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $bootstrap -Root $testRoot -Package $packagePath -ExpectedSha256 $hash -ExpectedVersion V9.9.8 -ParentProcessId 999999 2>&1
    $failureExitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousErrorAction }
  Assert-True ($failureExitCode -ne 0) '内部版本不一致的升级包未被拒绝。'
  $failedProgress = Get-Content -LiteralPath (Join-Path $testRoot 'data\updates\install-progress.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  Assert-True ($failedProgress.phase -eq 'error' -and [int]$failedProgress.percent -lt 100) '升级失败仍错误显示为 100%。'
  Write-Output 'qa-update-installer: passed (Node launcher lifecycle, package bootstrap, staged shutdown, atomic replace, installed-file verification, interrupted-process recovery, data boundary, obsolete cleanup, retention, startup rollback, version guard, failure progress)'
} finally {
  if ($dummyParent -and -not $dummyParent.HasExited) { Stop-Process -Id $dummyParent.Id -Force -ErrorAction SilentlyContinue }
  if ($launcherHost -and -not $launcherHost.HasExited) { Stop-Process -Id $launcherHost.Id -Force -ErrorAction SilentlyContinue }
  $resolved = [IO.Path]::GetFullPath($testRoot)
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if ($env:KEEP_UPDATE_QA -eq '1') { Write-Output ('qa-update-installer: preserved ' + $resolved) }
  elseif ($resolved.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolved)) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
$global:LASTEXITCODE = 0
