$root = Split-Path -Parent $PSScriptRoot
$port = 18766
if ($env:XIANGCAI_PORT) {
  $configuredPort = 0
  if (-not [int]::TryParse($env:XIANGCAI_PORT,[ref]$configuredPort) -or $configuredPort -lt 1 -or $configuredPort -gt 65535) { throw 'Invalid XIANGCAI_PORT.' }
  $port = $configuredPort
}
$pidFile = Join-Path $root 'data\server.pid'
$service = Join-Path $root 'web-server.js'
$candidateIds = New-Object System.Collections.Generic.HashSet[int]

if (Test-Path -LiteralPath $pidFile) {
  try { [void]$candidateIds.Add([int](Get-Content -LiteralPath $pidFile -Raw)) } catch {}
}
try {
  # Match every listening address (127.0.0.1 / 0.0.0.0 / ::) for the port; a LAN-mode server bound to 0.0.0.0 is missed when filtering on 127.0.0.1 only.
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop | ForEach-Object { [void]$candidateIds.Add([int]$_.OwningProcess) }
} catch {}

function Test-WorkbenchProcess([int]$processId) {
  try {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction Stop
    if ($process.Name -ne 'node.exe' -or -not $process.CommandLine) { return $false }
    # Our launcher passes the absolute script as Node's first argument. A matching
    # filename or a healthy port does not prove that a stale PID belongs to us.
    $servicePath = [IO.Path]::GetFullPath($service)
    $escapedPath = [regex]::Escape($servicePath)
    $scriptArgument = '"' + $escapedPath + '"'
    if ($servicePath -notmatch '\s') { $scriptArgument = '(?:' + $scriptArgument + '|' + $escapedPath + ')' }
    $commandPattern = '^\s*(?:"[^"]+"|[^"\s]+)\s+' + $scriptArgument + '(?:\s|$)'
    return [regex]::IsMatch($process.CommandLine, $commandPattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)
  } catch { return $false }
}

foreach ($processId in $candidateIds) {
  if (-not (Test-WorkbenchProcess $processId)) { continue }
  try { Stop-Process -Id $processId -ErrorAction Stop }
  catch { throw "Unable to stop workbench process $processId. Run the stop launcher as administrator or end that node.exe in Task Manager. Details: $($_.Exception.Message)" }
  $deadline = (Get-Date).AddSeconds(3)
  while ((Get-Process -Id $processId -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 150 }
  if (Get-Process -Id $processId -ErrorAction SilentlyContinue) {
    try { Stop-Process -Id $processId -Force -ErrorAction Stop }
    catch { throw "Workbench process $processId did not exit. End it as administrator and retry." }
  }
}
Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
