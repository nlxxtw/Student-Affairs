param(
  [Parameter(Mandatory=$true)][string]$Version,
  [Parameter(Mandatory=$true)][string]$OssObjectKey,
  [Parameter(Mandatory=$false)][string]$ReleaseNotes = "",
  [Parameter(Mandatory=$false)][string]$OutputDirectory = "",
  [Parameter(Mandatory=$false)][string]$PreviousVersion = "",
  [Parameter(Mandatory=$false)][string]$SocialOutputRoot = "",
  [Parameter(Mandatory=$false)][string]$SocialOrigin = "http://127.0.0.1:18766"
)

$ErrorActionPreference = 'Stop'

function Get-ProgramSha256([string]$FilePath) {
  $fileStream = [IO.File]::OpenRead($FilePath)
  $hashAlgorithm = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($hashAlgorithm.ComputeHash($fileStream)).Replace('-','').ToLowerInvariant() }
  finally { $hashAlgorithm.Dispose(); $fileStream.Dispose() }
}

$root = Split-Path -Parent $PSScriptRoot
if ($Version -notmatch '^V?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$') { throw 'Version 必须使用 V5.1.0 这样的格式。' }
if ($OssObjectKey -notmatch '^releases/[A-Za-z0-9!_.*''()/-]+\.zip$' -or $OssObjectKey.Contains('..')) { throw 'OssObjectKey 必须是 releases/ 下的 ZIP 对象路径。' }
$appVersionMatch = [regex]::Match((Get-Content -LiteralPath (Join-Path $root 'app.js') -Raw -Encoding UTF8),'SYS_VER\s*=\s*"([^"]+)"')
$serverVersionMatch = [regex]::Match((Get-Content -LiteralPath (Join-Path $root 'web-server.js') -Raw -Encoding UTF8),'APP_VERSION\s*=\s*"([^"]+)"')
if (-not $appVersionMatch.Success -or -not $serverVersionMatch.Success) { throw '无法读取 app.js 或 web-server.js 中的系统版本号。' }
if ($appVersionMatch.Groups[1].Value -ne $Version -or $serverVersionMatch.Groups[1].Value -ne $Version) { throw ('拒绝生成版本不一致的升级包：参数=' + $Version + '，前端=' + $appVersionMatch.Groups[1].Value + '，服务端=' + $serverVersionMatch.Groups[1].Value) }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $root 'release-output' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$files = @('party-import-engine.js','academic-public-engine.js','academic-public-exams.js','academic-public-files.js','academic-public-report.js','academic-public-import.js','academic-public-analysis.js','academic-public-service.js','academic-public-module.js','academic-public.css','web-server.js','workbench-database.js','app.js','student-leave-engine.js','student-leave-module.js','student-leave.css','student-link-integrity.js','index.html','login.html','license-client.js','update-client.js','update-launcher.js','update-config.json','demo-data.js','achievement-enhancements.js','chaoxing-attendance-module.js','award-statistics-module.js','other-violation-module.js','dorm-roster-module.js','dorm-spatial-module.js','dorm-spatial-module.css','custom-roster-module.js','counselor-growth-module.js','custom-fields-module.js','intelligence-enhancements.js','searchable-filter-selects.js','searchable-filter-selects.css','学生组织管理.html','license-config.json')
# Node 运行时由安装包首次部署；在线升级只更新业务程序与静态资源。
# 避免替换正在执行的 runtime\node.exe 而触发 Windows 文件占用错误。
$folders = @('assets')
$scriptFiles = @('academic-analysis-engine.py','academic-warning-editor-placeholder.json','generate-academic-warning.ps1','validate-academic-warning-template.ps1','install-workbench-update.ps1','update-bootstrap.ps1','start-update-bootstrap.ps1','recover-interrupted-update.ps1','start-workbench.ps1','stop-workbench.ps1')
$included = New-Object System.Collections.Generic.List[string]
foreach ($file in $files) { $full = Join-Path $root $file; if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "发行文件缺失：$file" }; $included.Add($full) }
foreach ($folder in $folders) { $full = Join-Path $root $folder; if (-not (Test-Path -LiteralPath $full -PathType Container)) { throw "发行目录缺失：$folder" }; Get-ChildItem -LiteralPath $full -Recurse -File | ForEach-Object { $included.Add($_.FullName) } }
foreach ($scriptFile in $scriptFiles) { $full = Join-Path (Join-Path $root 'scripts') $scriptFile; if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "运行脚本缺失：$scriptFile" }; $included.Add($full) }

$safeVersion = $Version.Replace('+','_').Replace('/','_')
$zipPath = Join-Path $OutputDirectory ("数智学工-"+$safeVersion+"-win32-x64.zip")
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::Open($zipPath,[IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($source in $included) {
    $relative = $source.Substring($root.Length).TrimStart('\','/').Replace('\','/')
    if ($relative -match '(^|/)(data|backups)(/|$)' -or $relative -match '(^|/)(deployment-secrets|admin-secrets)\.json$') { throw "禁止将敏感目录或密钥加入更新包：$relative" }
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$source,$relative,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $archive.Dispose() }
$hash = Get-ProgramSha256 $zipPath
$size = (Get-Item -LiteralPath $zipPath).Length
$publishedAt = (Get-Date).ToUniversalTime().ToString('o')
$manifest = [ordered]@{
  schemaVersion = 1
  releases = @([ordered]@{
    version = $Version
    channel = 'stable'
    platform = 'win32-x64'
    objectKey = $OssObjectKey
    sha256 = $hash
    size = $size
    releaseNotes = $ReleaseNotes
    publishedAt = $publishedAt
    mandatory = $false
    minSupportedVersion = ''
  })
}
$manifestPath = Join-Path $OutputDirectory 'current.json'
$manifestJson = $manifest | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText($manifestPath,$manifestJson,(New-Object Text.UTF8Encoding($false)))

# 本地发布目录与 OSS 保持一致：仅保留最新两版。只允许删除 release-output 的直属版本目录。
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $root 'release-output'))
if ($OutputDirectory.StartsWith($releaseRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) {
  $versionDirs = @(Get-ChildItem -LiteralPath $releaseRoot -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^V?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$' })
  $keepDirs = @($versionDirs | Sort-Object @{ Expression = { $match=[regex]::Match($_.Name,'^V?(\d+)\.(\d+)\.(\d+)'); [version]::new([int]$match.Groups[1].Value,[int]$match.Groups[2].Value,[int]$match.Groups[3].Value) }; Descending = $true }, @{ Expression = { $_.LastWriteTimeUtc }; Descending = $true } | Select-Object -First 2 | ForEach-Object FullName)
  foreach ($versionDir in $versionDirs) {
    $candidate = [IO.Path]::GetFullPath($versionDir.FullName)
    if ($keepDirs -contains $candidate) { continue }
    if ([IO.Path]::GetDirectoryName($candidate) -ne $releaseRoot) { throw '本地升级包清理目录校验失败。' }
    Remove-Item -LiteralPath $candidate -Recurse -Force
  }
}
Write-Output ("已生成更新包："+$zipPath)
Write-Output ("已生成 OSS 清单："+$manifestPath)

# 每次生成正式更新包时，同步生成微信公众号推文、小红书笔记与系统更新截图。
if (-not $ReleaseNotes.Trim()) { throw 'ReleaseNotes 不能为空；宣传稿必须来自真实更新日志。' }
if (-not $PreviousVersion) {
  $previousDir = Get-ChildItem -LiteralPath $releaseRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne $Version -and $_.Name -match '^V?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$' } |
    Sort-Object @{ Expression = { $match=[regex]::Match($_.Name,'^V?(\d+)\.(\d+)\.(\d+)'); [version]::new([int]$match.Groups[1].Value,[int]$match.Groups[2].Value,[int]$match.Groups[3].Value) }; Descending = $true } |
    Select-Object -First 1
  $PreviousVersion = if ($previousDir) { $previousDir.Name } else { $Version }
}
if ($PreviousVersion -notmatch '^V?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$') { throw 'PreviousVersion 必须使用 V5.2.8 这样的格式。' }
if (-not $SocialOutputRoot) { $SocialOutputRoot = Join-Path ([Environment]::GetFolderPath('Desktop')) '系统更新' }
$socialScript = Join-Path $PSScriptRoot 'generate-update-social-kit.cjs'
$nodeExecutable = Join-Path $root 'runtime\node.exe'
if (-not (Test-Path -LiteralPath $socialScript -PathType Leaf)) { throw '缺少版本宣传材料生成脚本。' }
if (-not (Test-Path -LiteralPath $nodeExecutable -PathType Leaf)) { throw '缺少 Node.js 运行时，无法生成版本宣传材料。' }
& $nodeExecutable $socialScript '--version' $Version '--from-version' $PreviousVersion '--release-notes' $ReleaseNotes '--package-size' ([string]$size) '--published-at' $publishedAt '--output-root' $SocialOutputRoot '--origin' $SocialOrigin
if ($LASTEXITCODE -ne 0) { throw '版本宣传材料生成失败，已停止本次发行构建。' }
