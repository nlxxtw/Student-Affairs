param(
  [Parameter(Mandatory=$true)][string]$Region,
  [Parameter(Mandatory=$true)][string]$TablestoreInstance,
  [Parameter(Mandatory=$true)][string]$TablestoreEndpoint,
  [Parameter(Mandatory=$true)][string]$ExecutionRoleArn,
  [Parameter(Mandatory=$false)][string]$UpdateOssBucket = ""
)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$SecretPath = Join-Path $ProjectRoot 'deployment-secrets.json'
if (-not (Test-Path -LiteralPath $SecretPath)) { throw '缺少 deployment-secrets.json，请先运行 node prepare-deployment.cjs。' }
if ($TablestoreEndpoint -notmatch '^https://[a-z0-9.-]+\.ots\.aliyuncs\.com/?$') { throw 'Tablestore Endpoint 格式无效，必须使用 HTTPS 实例地址。' }
if ($ExecutionRoleArn -notmatch '^(?:acs:ram::[0-9]+:role/)?[A-Za-z0-9_.-]+$') { throw 'FC 执行角色名称或 ARN 格式无效。' }
$Secrets = Get-Content -LiteralPath $SecretPath -Raw -Encoding UTF8 | ConvertFrom-Json
$env:ALIYUN_REGION = $Region
$env:TABLESTORE_INSTANCE = $TablestoreInstance
$env:TABLESTORE_ENDPOINT = $TablestoreEndpoint.TrimEnd('/')
$env:FC_EXECUTION_ROLE_ARN = if ($ExecutionRoleArn -match '/([^/]+)$') { $Matches[1] } else { $ExecutionRoleArn }
$env:LICENSE_CODE_PEPPER = $Secrets.codePepper
$env:LICENSE_PRIVATE_KEY_B64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$Secrets.privateKey))
$env:UPDATE_OSS_BUCKET = $UpdateOssBucket.Trim()
$env:UPDATE_OSS_REGION = $Region
Push-Location $ProjectRoot
try {
  # Serverless Devs 的默认结果会完整回显环境变量，其中包含授权私钥等敏感值。
  # 成功时仅输出安全摘要；失败时也先脱敏再显示诊断信息。
  $PreviousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $DeployOutput = @(& s deploy -y 2>&1)
    $DeployExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $PreviousErrorAction
  }
  if ($DeployExitCode -ne 0) {
    $SafeOutput = $DeployOutput | ForEach-Object {
      [string]$_ -replace '(LICENSE_(?:CODE_PEPPER|PRIVATE_KEY_B64):\s*).*$', '$1[REDACTED]'
    }
    $SafeOutput | Write-Error
    throw "Serverless Devs 部署失败，退出码 $DeployExitCode。"
  }
  [pscustomobject]@{
    ok = $true
    function = 'shuzhi-xuegong-license-api'
    region = $Region
    updateBucket = if ($UpdateOssBucket) { $UpdateOssBucket } else { $null }
    updateManifest = 'releases/current.json'
  } | ConvertTo-Json -Compress
}
finally { Pop-Location; Remove-Item Env:LICENSE_CODE_PEPPER,Env:LICENSE_PRIVATE_KEY_B64,Env:UPDATE_OSS_BUCKET,Env:UPDATE_OSS_REGION -ErrorAction SilentlyContinue }
