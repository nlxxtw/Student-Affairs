param([string]$OutputDirectory=(Join-Path $PSScriptRoot '.qa-import-template-validation'))
$ErrorActionPreference='Stop'
$OutputDirectory=(Resolve-Path -LiteralPath $OutputDirectory).Path
$report=Get-Content -LiteralPath (Join-Path $OutputDirectory 'report.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$excel=New-Object -ComObject Excel.Application
$excel.Visible=$false
$excel.DisplayAlerts=$false
$results=@()
try {
  foreach($file in $report.files){
    Write-Output ("Checking " + $file.label)
    $book=$null
    try {
      $book=$excel.Workbooks.Open((Join-Path $OutputDirectory ($file.label+'.xlsx')),0,$true)
      $sheet=$book.Worksheets.Item(1)
      foreach($rule in $file.validations){
        $address=($rule.sqref -split ' ')[0] -split ':' | Select-Object -First 1
        $cell=$sheet.Range($address)
        if($cell.Validation.Type -ne 3 -or $cell.Validation.AlertStyle -ne 1 -or -not $cell.Validation.ShowError -or -not $cell.Validation.InCellDropdown){throw "Invalid Excel validation: $($file.label) $($rule.label)"}
        $cell.Value2='__INVALID_FIXED_OPTION__'
        if($cell.Validation.Value){throw "Excel accepted invalid choice: $($file.label) $($rule.label)"}
        $cell.Value2=[string]$rule.values[0]
        if(-not $cell.Validation.Value){throw "Excel rejected allowed choice: $($file.label) $($rule.label)"}
        if($rule.label -eq '民族'){
          foreach($ethnic in @('穿青人族','其他','外国血统中国籍人士')){
            $cell.Value2=$ethnic
            if(-not $cell.Validation.Value){throw "Excel rejected added ethnicity: $($file.label) $ethnic"}
          }
        }
        $results+=[pscustomobject]@{template=$file.label;field=$rule.label;validAccepted=$true;invalidRejected=$true;alertStyle='Stop'}
      }
      if($file.label -eq 'student'){$book.SaveCopyAs((Join-Path $OutputDirectory 'excel-student.xlsx'))}
    } finally { if($book){$book.Close($false);[void][Runtime.InteropServices.Marshal]::ReleaseComObject($book)} }
  }
  $book=$null
  try {
    $template=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\assets\academic-analysis-field-template.xlsx')).Path
    $book=$excel.Workbooks.Open($template,0,$true)
    $cell=$book.Worksheets.Item(1).Range('E2')
    if($cell.Validation.Type -ne 3 -or $cell.Validation.AlertStyle -ne 1 -or -not $cell.Validation.ShowError -or -not $cell.Validation.InCellDropdown){throw 'Invalid static template gender validation'}
    $cell.Value2='未知'
    if($cell.Validation.Value){throw 'Static template accepted invalid gender'}
    $cell.Value2='男'
    if(-not $cell.Validation.Value){throw 'Static template rejected valid gender'}
    $results+=[pscustomobject]@{template='academicAnalysisStatic';field='性别';validAccepted=$true;invalidRejected=$true;alertStyle='Stop'}
  } finally {if($book){$book.Close($false);[void][Runtime.InteropServices.Marshal]::ReleaseComObject($book)}}
  $results | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'excel-report.json') -Encoding UTF8
  Write-Output "Excel engine validation passed: $($results.Count) dropdown columns in $($report.files.Count+1) templates"
} finally {$excel.Quit();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)}
