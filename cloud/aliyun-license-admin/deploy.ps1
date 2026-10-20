param(
  [Parameter(Mandatory=$true)][string]$Region,
  [Parameter(Mandatory=$true)][string]$TablestoreInstance,
  [Parameter(Mandatory=$true)][string]$TablestoreEndpoint,
  [Parameter(Mandatory=$true)][string]$ExecutionRoleArn
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$adminSecretPath = Join-Path $root 'admin-secrets.json'
$licenseSecretPath = Join-Path (Split-Path -Parent $root) 'aliyun-license\deployment-secrets.json'
if (-not (Test-Path -LiteralPath $adminSecretPath)) { throw 'admin-secrets.json is missing. Run configure-admin.ps1 first.' }
if (-not (Test-Path -LiteralPath $licenseSecretPath)) { throw 'The original deployment-secrets.json is missing.' }
if ($ExecutionRoleArn -notmatch '^acs:ram::[0-9]+:role/[A-Za-z0-9_-]+$') { throw 'The FC execution role ARN is invalid.' }
Push-Location $root
try {
  & node '.\ensure-code-encryption-key.cjs'
  if ($LASTEXITCODE -ne 0) { throw 'Failed to prepare the license code encryption key.' }
} finally { Pop-Location }
$admin = Get-Content -LiteralPath $adminSecretPath -Raw -Encoding UTF8 | ConvertFrom-Json
$license = Get-Content -LiteralPath $licenseSecretPath -Raw -Encoding UTF8 | ConvertFrom-Json
$env:ALIYUN_REGION = $Region
$env:TABLESTORE_INSTANCE = $TablestoreInstance
$env:TABLESTORE_ENDPOINT = $TablestoreEndpoint.TrimEnd('/')
$env:FC_ADMIN_EXECUTION_ROLE_ARN = $ExecutionRoleArn
$env:LICENSE_CODE_PEPPER = $license.codePepper
$env:ADMIN_USERNAME = $admin.username
$env:ADMIN_PASSWORD_HASH = $admin.passwordHash
$env:ADMIN_SESSION_SECRET = $admin.sessionSecret
$env:LICENSE_CODE_ENCRYPTION_KEY = $admin.codeEncryptionKey
Push-Location $root
try {
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $deployOutput = & s deploy -y 2>&1
    $deployCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  $deployOutput | Where-Object { $_ -notmatch 'LICENSE_CODE_PEPPER|LICENSE_CODE_ENCRYPTION_KEY|ADMIN_PASSWORD_HASH|ADMIN_TOTP_SECRET|ADMIN_SESSION_SECRET|environmentVariables' }
  if ($deployCode -ne 0) { throw "Serverless Devs deployment failed with exit code $deployCode." }
} finally {
  Pop-Location
  Remove-Item Env:LICENSE_CODE_PEPPER,Env:ADMIN_USERNAME,Env:ADMIN_PASSWORD_HASH,Env:ADMIN_SESSION_SECRET,Env:LICENSE_CODE_ENCRYPTION_KEY -ErrorAction SilentlyContinue
}
