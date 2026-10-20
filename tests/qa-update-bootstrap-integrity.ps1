$ErrorActionPreference = 'Stop'
$taskRoot = Join-Path ([IO.Path]::GetTempPath()) ('shuzhi-bootstrap-integrity-' + [Guid]::NewGuid().ToString('N'))
$bootstrap = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/update-bootstrap.ps1'
try {
  $scripts = Join-Path $taskRoot 'payload/scripts'
  New-Item -ItemType Directory -Force -Path $scripts | Out-Null
  $marker = Join-Path $taskRoot 'executed.txt'
  Set-Content -LiteralPath (Join-Path $scripts 'install-workbench-update.ps1') -Value ('param($Root,$Package,$ExpectedSha256,$ExpectedVersion,$ParentProcessId)' + "`n" + 'Set-Content -LiteralPath (Join-Path $Root ''executed.txt'') -Value ''executed''') -Encoding UTF8
  $zip = Join-Path $taskRoot 'tampered.zip'
  Compress-Archive -LiteralPath $scripts -DestinationPath $zip
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $bootstrap -Root $taskRoot -Package $zip -ExpectedSha256 ('0' * 64) -ExpectedVersion V9.9.9 -ParentProcessId 999999 2>&1 | Out-Null
  $result = $LASTEXITCODE
  $ErrorActionPreference = $previous
  if (Test-Path -LiteralPath $marker) { throw '未经完整性验证的包内脚本被执行。' }
  if ($result -eq 0) { throw '篡改升级包未被拒绝。' }
  Write-Output 'bootstrap integrity: passed (reject before package code execution)'
} finally {
  $absolute = [IO.Path]::GetFullPath($taskRoot)
  if (-not $absolute.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test cleanup path' }
  Remove-Item -LiteralPath $absolute -Recurse -Force
}
$global:LASTEXITCODE = 0
