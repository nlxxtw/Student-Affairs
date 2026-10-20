param([string]$Username = 'admin')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $root 'admin-secrets.json'
if (Test-Path -LiteralPath $target) { throw 'admin-secrets.json already exists. Refusing to overwrite it.' }
$first = Read-Host 'Enter admin password (at least 12 characters)' -AsSecureString
$second = Read-Host 'Enter the admin password again' -AsSecureString
$firstPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($first)
$secondPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($second)
try {
  $firstText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($firstPtr)
  $secondText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secondPtr)
  if ($firstText -cne $secondText) { throw 'The two passwords do not match.' }
  $env:SZ_LICENSE_ADMIN_PASSWORD = $firstText
  Push-Location $root
  try {
    & node '.\prepare-admin-secrets.cjs' $Username
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create the admin security configuration.' }
  }
  finally { Pop-Location }
} finally {
  Remove-Item Env:SZ_LICENSE_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  if ($firstPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($firstPtr) }
  if ($secondPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secondPtr) }
}
