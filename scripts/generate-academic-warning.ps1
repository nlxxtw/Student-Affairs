param(
  [Parameter(Mandatory = $true)][string]$TemplatePath,
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [ValidateSet("word", "pdf", "editor-html")][string]$Format = "word",
  [switch]$Batch,
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
$InputPath = [System.IO.Path]::GetFullPath($InputPath)
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
if ([string]::IsNullOrWhiteSpace($OwnershipPath)) { $OwnershipPath = Join-Path ([System.IO.Path]::GetDirectoryName($OutputPath)) "word-ownership.json" }
$OwnershipPath = [System.IO.Path]::GetFullPath($OwnershipPath)

function ValueOf($Object, [string]$Name) {
  if ($null -eq $Object) { return "" }
  $Property = $Object.PSObject.Properties[$Name]
  if ($null -eq $Property -or $null -eq $Property.Value) { return "" }
  return [string]$Property.Value
}

function CellRange($Table, [int]$Index) {
  $Range = $Table.Range.Cells.Item($Index).Range.Duplicate
  # Word exposes the final paragraph/cell marker as one range position. Keeping
  # that position untouched preserves the original paragraph formatting.
  $Range.End = $Range.End - 1
  return $Range
}

function SetCell($Table, [int]$Index, $Value) {
  $Range = CellRange $Table $Index
  $Range.Text = [string]$Value
}

function GridCellRange($Table, [int]$Row, [int]$Column) {
  $Range = $Table.Cell($Row, $Column).Range.Duplicate
  $Range.End = $Range.End - 1
  return $Range
}

function SetGridCell($Table, [int]$Row, [int]$Column, $Value) {
  $Range = GridCellRange $Table $Row $Column
  $Range.Text = [string]$Value
}

function GridCellParagraphRange($Table, [int]$Row, [int]$Column, [int]$ParagraphIndex) {
  $Range = $Table.Cell($Row, $Column).Range.Paragraphs.Item($ParagraphIndex).Range.Duplicate
  $Range.End = $Range.End - 1
  return $Range
}

function CellParagraphRange($Table, [int]$CellIndex, [int]$ParagraphIndex) {
  $Range = $Table.Range.Cells.Item($CellIndex).Range.Paragraphs.Item($ParagraphIndex).Range.Duplicate
  $Range.End = $Range.End - 1
  return $Range
}

function SetCellParagraph($Table, [int]$CellIndex, [int]$ParagraphIndex, $Value) {
  $Text = [string]$Value
  if ([string]::IsNullOrWhiteSpace($Text)) { return }
  $Range = CellParagraphRange $Table $CellIndex $ParagraphIndex
  $Range.Text = $Text
}

function AppendInlineToCellParagraph($Table, [int]$CellIndex, [int]$ParagraphIndex, $Value) {
  $Text = [string]$Value
  if ([string]::IsNullOrWhiteSpace($Text)) { return }
  $Range = CellParagraphRange $Table $CellIndex $ParagraphIndex
  $Range.Collapse(0)
  $Range.InsertAfter(" " + $Text)
}

function FillAfterLastColon($Range, $Value) {
  $TextValue = [string]$Value
  if ([string]::IsNullOrWhiteSpace($TextValue)) { return }
  $Target = $Range.Duplicate
  $Text = $Target.Text
  $Colon = [char]0xFF1A
  $At = $Text.LastIndexOf($Colon)
  if ($At -lt 0) { $At = $Text.LastIndexOf(':') }
  if ($At -ge 0) { $Target.Text = $Text.Substring(0, $At + 1) + " " + $TextValue }
}

function FillSignatureDate($Range, $Signature, $DateValue) {
  $SignatureText = [string]$Signature
  $DateText = [string]$DateValue
  if ([string]::IsNullOrWhiteSpace($SignatureText) -and [string]::IsNullOrWhiteSpace($DateText)) { return }
  $Target = $Range.Duplicate
  $Text = $Target.Text
  $Colon = [char]0xFF1A
  $At = $Text.LastIndexOf($Colon)
  if ($At -lt 0) { $At = $Text.LastIndexOf(':') }
  if ($At -lt 0) { return }
  $Formatted = FormatDate $DateText
  $Tail = " " + $SignatureText
  if (-not [string]::IsNullOrWhiteSpace($Formatted)) { $Tail += "        " + $Formatted }
  $Target.Text = $Text.Substring(0, $At + 1) + $Tail
}

function SetParagraph($Document, [int]$Index, $Value) {
  $Text = [string]$Value
  if ([string]::IsNullOrWhiteSpace($Text)) { return }
  $Range = $Document.Paragraphs.Item($Index).Range.Duplicate
  $Range.End = $Range.End - 1
  $Range.Text = $Text
}

function FormatDate($Value) {
  $Text = [string]$Value
  if ($Text -match '^(\d{4})-(\d{1,2})-(\d{1,2})$') {
    return $Matches[1] + [char]0x5E74 + [int]$Matches[2] + [char]0x6708 + [int]$Matches[3] + [char]0x65E5
  }
  return $Text
}

function JoinValues([object[]]$Values) {
  return (($Values | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join ([char]0xFF1B))
}

function SetWarningCheckbox($Range, $Notice) {
  $Range = $Range.Duplicate
  $Text = $Range.Text
  $EmptyBox = [char]0x25A1
  $CheckedBox = [char]0x2611
  $First = $Text.IndexOf($EmptyBox)
  $Second = if ($First -ge 0) { $Text.IndexOf($EmptyBox, $First + 1) } else { -1 }
  $Choice = ValueOf $Notice "warningChoice"
  if ($Choice -ne "red" -and $Choice -ne "retire") { return }
  $Target = if ($Choice -eq "retire") { $Second } else { $First }
  if ($Target -ge 0) {
    $Mark = $Range.Duplicate
    $Mark.Start = $Mark.Start + $Target
    $Mark.End = $Mark.Start + 1
    $Mark.Text = [string]$CheckedBox
  }
}

function FillDocument($Document, $Item) {
  $Student = $Item.student
  $Forms = $Item.forms
  $Notice = $Forms.notice
  $Parent = $Forms.parent
  $Talk = $Forms.talk
  $Support = $Forms.support
  $Cancel = $Forms.cancel

  # These two paragraph positions are part of the hash-locked original template.
  SetParagraph $Document 94 (FormatDate (ValueOf $Parent "noticeDate"))
  $ParentSignatureRange = $Document.Paragraphs.Item(129).Range.Duplicate
  $ParentSignatureRange.End = $ParentSignatureRange.End - 1
  FillSignatureDate $ParentSignatureRange (ValueOf $Parent "parentSignature") (ValueOf $Parent "receiptDate")

  $T1 = $Document.Tables.Item(1)
  SetCell $T1 2 (ValueOf $Student "name")
  SetCell $T1 4 (ValueOf $Student "sid")
  SetCell $T1 6 (ValueOf $Student "gender")
  SetCell $T1 8 (ValueOf $Student "college")
  SetCell $T1 10 (ValueOf $Student "major")
  SetCell $T1 12 (ValueOf $Student "className")

  $Courses = @($Item.courses)
  $CourseCapacity = 6
  $ExtraCourseRows = [Math]::Max(0, $Courses.Count - $CourseCapacity)
  if ($ExtraCourseRows -gt 0) {
    # Detach the vertically merged detail column first, insert complete copies
    # of the last course row, then merge the detail column again through CET
    # and computer-exam rows. This keeps all four grid columns aligned and
    # extends "学生预警详细情况" together with every added course row.
    $T1.Cell(3, 1).Split(9, 1)
    $TemplateCourseRow = $T1.Rows.Item(9).Range
    $Document.Application.Selection.SetRange($TemplateCourseRow.Start, $TemplateCourseRow.End)
    $Document.Application.Selection.InsertRowsBelow($ExtraCourseRows)
    $T1.Cell(3, 1).Merge($T1.Cell(11 + $ExtraCourseRows, 1))
  }
  $RenderedCourseRows = [Math]::Max($CourseCapacity, $Courses.Count)
  for ($Slot = 0; $Slot -lt $RenderedCourseRows; $Slot++) {
    $CourseRow = 4 + $Slot
    $Course = if ($Slot -lt $Courses.Count) { $Courses[$Slot] } else { $null }
    SetGridCell $T1 $CourseRow 2 (ValueOf $Course "name")
    SetGridCell $T1 $CourseRow 3 (ValueOf $Course "term")
    SetGridCell $T1 $CourseRow 4 (ValueOf $Course "result")
    try { $T1.Cell($CourseRow, 2).Range.Rows.AllowBreakAcrossPages = 0 } catch {}
  }
  $CetRow = 10 + $ExtraCourseRows
  $ComputerRow = 11 + $ExtraCourseRows
  $OpinionRow = 12 + $ExtraCourseRows
  $StudentSignatureRow = 13 + $ExtraCourseRows
  SetGridCell $T1 $CetRow 3 (ValueOf $Notice "cetDegree")
  SetGridCell $T1 $ComputerRow 3 (ValueOf $Notice "computerExam")
  $OpinionRange = GridCellRange $T1 $OpinionRow 2
  SetWarningCheckbox $OpinionRange $Notice
  $OpinionSupplement = [string](ValueOf $Notice "collegeOpinion")
  if (-not [string]::IsNullOrWhiteSpace($OpinionSupplement)) {
    $OpinionParagraph = GridCellParagraphRange $T1 $OpinionRow 2 3
    $OpinionParagraph.Collapse(0)
    $OpinionParagraph.InsertAfter(" " + $OpinionSupplement)
  }
  FillSignatureDate (GridCellParagraphRange $T1 $OpinionRow 2 4) (ValueOf $Notice "leaderSignature") (ValueOf $Notice "collegeDate")
  FillSignatureDate (GridCellParagraphRange $T1 $StudentSignatureRow 2 2) (ValueOf $Notice "studentSignature") (ValueOf $Notice "studentDate")

  $T2 = $Document.Tables.Item(2)
  SetCell $T2 7 (ValueOf $Parent "counselorName")
  SetCell $T2 8 (ValueOf $Parent "officePhone")
  SetCell $T2 9 (ValueOf $Parent "mobilePhone")
  SetCell $T2 10 (ValueOf $Parent "email")

  $T3 = $Document.Tables.Item(3)
  SetCell $T3 2 (ValueOf $Parent "parentName")
  SetCell $T3 4 (ValueOf $Student "name")
  SetCell $T3 6 (ValueOf $Parent "parentFixedPhone")
  SetCell $T3 8 (ValueOf $Student "major")
  SetCell $T3 10 (ValueOf $Parent "parentMobile")
  SetCell $T3 12 (ValueOf $Parent "parentEmail")
  SetCellParagraph $T3 13 2 (ValueOf $Parent "parentSuggestions")

  $T4 = $Document.Tables.Item(4)
  SetCell $T4 2 (ValueOf $Student "name")
  SetCell $T4 4 (ValueOf $Talk "parentName")
  SetCell $T4 6 (ValueOf $Student "college")
  SetCell $T4 8 (ValueOf $Student "major")
  SetCell $T4 10 (ValueOf $Talk "parentContact")
  SetCell $T4 12 (ValueOf $Talk "studentContact")
  SetCell $T4 14 (ValueOf $Talk "talkObject")
  SetCell $T4 16 (ValueOf $Talk "parentTalkMethod")
  SetCell $T4 18 (ValueOf $Talk "warningLevel")
  SetCell $T4 20 (ValueOf $Talk "warningReason")
  SetCell $T4 22 (ValueOf $Talk "studentTalk")
  SetCell $T4 23 (ValueOf $Talk "parentTalk")
  SetCell $T4 25 (ValueOf $Talk "teacherSignature")
  SetCell $T4 27 (ValueOf $Talk "studentSignature")
  SetCell $T4 28 (FormatDate (ValueOf $Talk "talkDate"))

  $T5 = $Document.Tables.Item(5)
  SetCell $T5 2 (ValueOf $Student "name")
  SetCell $T5 4 (ValueOf $Student "sid")
  SetCell $T5 6 (ValueOf $Student "gender")
  SetCell $T5 8 (ValueOf $Student "college")
  SetCell $T5 10 (ValueOf $Student "major")
  SetCell $T5 12 (ValueOf $Student "className")
  SetCell $T5 14 (ValueOf $Support "guidanceTeacher")
  SetCell $T5 16 (ValueOf $Support "academicRank")
  AppendInlineToCellParagraph $T5 17 1 (FormatDate (ValueOf $Support "plannedCompletion"))
  SetCell $T5 19 (ValueOf $Support "problemDescription")
  SetCellParagraph $T5 21 2 (ValueOf $Support "supportContent")
  FillAfterLastColon (CellParagraphRange $T5 21 6) (ValueOf $Support "teacherSignature")
  FillAfterLastColon (CellParagraphRange $T5 21 7) (ValueOf $Support "studentSignature")
  SetCellParagraph $T5 23 2 (ValueOf $Support "completionStatus")
  FillSignatureDate (CellParagraphRange $T5 23 5) (ValueOf $Support "collegeAuditSignature") (ValueOf $Support "auditDate")

  $T6 = $Document.Tables.Item(6)
  SetCell $T6 2 (ValueOf $Student "name")
  SetCell $T6 4 (ValueOf $Student "sid")
  SetCell $T6 6 (ValueOf $Student "className")
  SetCell $T6 8 (ValueOf $Student "major")
  SetCell $T6 10 (ValueOf $Student "college")
  SetCell $T6 12 (ValueOf $Cancel "poorStatus")
  SetCellParagraph $T6 13 2 (ValueOf $Cancel "performanceDescription")
  FillSignatureDate (CellParagraphRange $T6 15 4) (ValueOf $Cancel "collegeAuditSignature") (ValueOf $Cancel "auditDate")
  FillSignatureDate (CellParagraphRange $T6 17 3) (ValueOf $Cancel "studentSignature") (ValueOf $Cancel "studentDate")
}

function SafeBaseName($Item, [int]$Index) {
  $Name = ValueOf $Item "fileBase"
  if ([string]::IsNullOrWhiteSpace($Name)) { $Name = "warning-" + $Index }
  foreach ($Character in [System.IO.Path]::GetInvalidFileNameChars()) { $Name = $Name.Replace([string]$Character, "_") }
  return $Name.Trim().TrimEnd('.')
}

function RenderOne($Word, $Item, [string]$Destination, [string]$RequestedFormat, [string]$WorkDirectory, [int]$Index) {
  $SourceCopy = Join-Path $WorkDirectory ("source-" + $Index + ".doc")
  Copy-Item -LiteralPath $TemplatePath -Destination $SourceCopy -Force
  $Document = $null
  try {
    $Document = $Word.Documents.Open($SourceCopy, $false, $false)
    FillDocument $Document $Item
    if ($RequestedFormat -eq "pdf") {
      $Document.ExportAsFixedFormat($Destination, 17)
    } elseif ($RequestedFormat -eq "editor-html") {
      # Word filtered HTML retains the source document's fonts, tables,
      # borders, page sections and explicit page breaks for the web editor.
      $Document.SaveAs2($Destination, 10)
    } else {
      $Document.SaveAs2($Destination, 0)
    }
  } finally {
    Close-OwnedWordDocument $Document
    Remove-Item -LiteralPath $SourceCopy -Force -ErrorAction SilentlyContinue
  }
}

if (-not (Test-Path -LiteralPath $TemplatePath -PathType Leaf)) { throw "Template file is missing." }
$Payload = Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8 | ConvertFrom-Json
$WorkDirectory = Join-Path ([System.IO.Path]::GetDirectoryName($OutputPath)) ("word-work-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $WorkDirectory | Out-Null
$Word = $null
try {
  $Word = New-OwnedWordApplication $OwnershipPath
  if ($Batch) {
    $FilesDirectory = Join-Path $WorkDirectory "files"
    New-Item -ItemType Directory -Path $FilesDirectory | Out-Null
    $Items = @($Payload.items)
    for ($Index = 0; $Index -lt $Items.Count; $Index++) {
      $Extension = if ($Format -eq "pdf") { ".pdf" } else { ".doc" }
      $Base = SafeBaseName $Items[$Index] ($Index + 1)
      $Destination = Join-Path $FilesDirectory ($Base + $Extension)
      $Suffix = 2
      while (Test-Path -LiteralPath $Destination) {
        $Destination = Join-Path $FilesDirectory ($Base + " (" + $Suffix + ")" + $Extension)
        $Suffix++
      }
      RenderOne $Word $Items[$Index] $Destination $Format $WorkDirectory ($Index + 1)
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (Test-Path -LiteralPath $OutputPath) { Remove-Item -LiteralPath $OutputPath -Force }
    [System.IO.Compression.ZipFile]::CreateFromDirectory($FilesDirectory, $OutputPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
  } else {
    RenderOne $Word $Payload.item $OutputPath $Format $WorkDirectory 1
  }
} finally {
  Close-OwnedWordApplication $Word
  [gc]::Collect()
  [gc]::WaitForPendingFinalizers()
  Remove-Item -LiteralPath $WorkDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
