param(
  [Parameter(Mandatory = $true)][string]$TemplatePath,
  [string]$OwnershipPath = ""
)

$ErrorActionPreference = "Stop"

# Every automation request owns a fresh Word process. Existing user instances
# are never quit or terminated by this job.
function New-OwnedWordApplication([string]$MarkerPath) {
  $ExistingWordIds = @(Get-Process -Name WINWORD -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  $Application = $null
  $OwnsApplication = $false
  $OwnershipDocument = $null
  $OwnershipWindow = $null
  try {
    if (-not ('ShuzhiWordSafety.NativeMethods' -as [type])) {
      Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace ShuzhiWordSafety {
  public static class NativeMethods {
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  }
}
"@
    }
    $Application = New-Object -ComObject Word.Application
    $Application.AutomationSecurity = 3
    $Application.Options.UpdateLinksAtOpen = $false
    $Application.Visible = $false
    $Application.DisplayAlerts = 0
    # Word exposes Hwnd on Window, not Application. This blank document is
    # created by this job and contains no untrusted input.
    $OwnershipDocument = $Application.Documents.Add()
    $OwnershipWindow = $OwnershipDocument.ActiveWindow
    [uint32]$WordProcessId = 0
    [void][ShuzhiWordSafety.NativeMethods]::GetWindowThreadProcessId([IntPtr]$OwnershipWindow.Hwnd, [ref]$WordProcessId)
    if ($WordProcessId -eq 0 -or $ExistingWordIds -contains [int]$WordProcessId) {
      throw "Word automation did not create an independent process. Close Word dialogs and retry."
    }
    $WordProcess = Get-Process -Id $WordProcessId -ErrorAction Stop
    if ($WordProcess.ProcessName -ne 'WINWORD') { throw "The Word process ownership check failed." }
    $OwnsApplication = $true
    try { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($OwnershipWindow) } catch {}
    $OwnershipWindow = $null
    Close-OwnedWordDocument $OwnershipDocument
    $OwnershipDocument = $null
    $Ownership = @{ version = 1; ownerPid = $PID; pid = [int]$WordProcessId; startedAt = $WordProcess.StartTime.ToUniversalTime().ToString('o'); owned = $true }
    [System.IO.File]::WriteAllText($MarkerPath, ($Ownership | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))
    # Office automation otherwise defaults to enabling macros. Apply these
    # settings before Documents.Open, even for the shipped trusted template.
    $Application.AutomationSecurity = 3
    $Application.Options.UpdateLinksAtOpen = $false
    $Application.Visible = $false
    $Application.DisplayAlerts = 0
    return $Application
  } catch {
    if ($null -ne $OwnershipWindow) { try { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($OwnershipWindow) } catch {} }
    Close-OwnedWordDocument $OwnershipDocument
    if ($null -ne $Application) {
      if ($OwnsApplication) { try { $Application.Quit() } catch {} }
      try { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($Application) } catch {}
    }
    throw
  }
}

function Close-OwnedWordDocument($Document) {
  if ($null -eq $Document) { return }
  try { $Document.Close(0) } catch {}
  try { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($Document) } catch {}
}

function Close-OwnedWordApplication($Application) {
  if ($null -eq $Application) { return }
  try { $Application.Quit() } catch {}
  try { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($Application) } catch {}
}

$TemplatePath = [System.IO.Path]::GetFullPath($TemplatePath)
if ([string]::IsNullOrWhiteSpace($OwnershipPath)) { $OwnershipPath = Join-Path ([System.IO.Path]::GetDirectoryName($TemplatePath)) "word-ownership.json" }
$OwnershipPath = [System.IO.Path]::GetFullPath($OwnershipPath)
if (-not (Test-Path -LiteralPath $TemplatePath -PathType Leaf)) { throw "Template file is missing." }

$Word = $null
$Document = $null
try {
  $Word = New-OwnedWordApplication $OwnershipPath
  $Document = $Word.Documents.Open($TemplatePath, $false, $true)

  if ($Document.Tables.Count -lt 6) { throw "The template must retain the six data tables used by attachments 1-5." }
  $MinimumCells = @(42, 10, 13, 28, 23, 17)
  $CellCounts = @()
  for ($Index = 1; $Index -le $MinimumCells.Count; $Index++) {
    $Count = $Document.Tables.Item($Index).Range.Cells.Count
    $CellCounts += $Count
    if ($Count -ne $MinimumCells[$Index - 1]) {
      throw ("Data table {0} structure changed (actual cells {1}, required {2})." -f $Index, $Count, $MinimumCells[$Index - 1])
    }
  }
  if ($Document.Paragraphs.Count -lt 129) { throw "The template paragraph structure is incomplete." }
  [pscustomobject]@{ ok = $true; tables = $Document.Tables.Count; paragraphs = $Document.Paragraphs.Count; cells = $CellCounts } | ConvertTo-Json -Compress
} finally {
  Close-OwnedWordDocument $Document
  Close-OwnedWordApplication $Word
  [gc]::Collect()
  [gc]::WaitForPendingFinalizers()
}
