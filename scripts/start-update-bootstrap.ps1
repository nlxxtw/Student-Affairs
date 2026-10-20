param(
  [Parameter(Mandatory=$true)][string]$Bootstrap,
  [Parameter(Mandatory=$true)][string]$Root,
  [Parameter(Mandatory=$true)][string]$Package,
  [Parameter(Mandatory=$true)][string]$ExpectedSha256,
  [Parameter(Mandatory=$true)][string]$ExpectedVersion,
  [Parameter(Mandatory=$true)][int]$ParentProcessId,
  [Parameter(Mandatory=$true)][string]$LogPath
)

$ErrorActionPreference = 'Stop'
$Bootstrap = [IO.Path]::GetFullPath($Bootstrap)
$Root = [IO.Path]::GetFullPath($Root)
$Package = [IO.Path]::GetFullPath($Package)
$LogPath = [IO.Path]::GetFullPath($LogPath)
if (-not (Test-Path -LiteralPath $Bootstrap -PathType Leaf)) { throw 'The update bootstrap script does not exist.' }
if (-not (Test-Path -LiteralPath $Package -PathType Leaf)) { throw 'The downloaded update package does not exist.' }
$updatesRoot = Join-Path $Root 'data\updates'
New-Item -ItemType Directory -Force -Path $updatesRoot,([IO.Path]::GetDirectoryName($LogPath)) | Out-Null
$errorLogPath = [IO.Path]::Combine([IO.Path]::GetDirectoryName($LogPath),([IO.Path]::GetFileNameWithoutExtension($LogPath) + '-error.log'))
$arguments = @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"' + $Bootstrap + '"'),'-Root',('"' + $Root + '"'),'-Package',('"' + $Package + '"'),'-ExpectedSha256',$ExpectedSha256,'-ExpectedVersion',$ExpectedVersion,'-ParentProcessId',[string]$ParentProcessId)
$process = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Hidden -RedirectStandardOutput $LogPath -RedirectStandardError $errorLogPath -PassThru
if (-not $process -or $process.Id -le 0) { throw 'Failed to create the independent update process.' }
$recordPath = Join-Path $updatesRoot 'installer-process.json'
$temporary = $recordPath + '.' + $PID + '.tmp'
@{ processId=$process.Id; parentProcessId=$ParentProcessId; version=$ExpectedVersion; startedAt=(Get-Date).ToUniversalTime().ToString('o'); logPath=$LogPath; errorLogPath=$errorLogPath } |
  ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding UTF8
Move-Item -LiteralPath $temporary -Destination $recordPath -Force
