# pbi-delivery · lib/dax-query.ps1
# Runs one DAX query against Power BI Desktop's local Analysis Services and prints the rows as JSON.
# Uses the ADOMD client that ships with Desktop (no install). Called by reconcile.js.
#   powershell -NoProfile -ExecutionPolicy Bypass -File dax-query.ps1 -Port <n> -QueryFile <file.dax>
# Output: {"ok":true,"columns":[...],"rows":[[...],...]}  or  {"ok":false,"error":"..."}
param([Parameter(Mandatory = $true)][int]$Port, [Parameter(Mandatory = $true)][string]$QueryFile)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
function Out-Json($o) { [Console]::Out.Write(($o | ConvertTo-Json -Depth 6 -Compress)) }
try {
  $p = Get-Process PBIDesktop -ErrorAction Stop | Select-Object -First 1
  $bin = Split-Path $p.Path
  $dll = @('Microsoft.PowerBI.AdomdClient.dll', 'Microsoft.AnalysisServices.AdomdClient.dll') |
    ForEach-Object { Join-Path $bin $_ } | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $dll) { throw "ADOMD client not found in $bin" }
  Add-Type -Path $dll
  $c = New-Object Microsoft.AnalysisServices.AdomdClient.AdomdConnection("Data Source=localhost:$Port")
  $c.Open()
  try {
    $cmd = $c.CreateCommand()
    $cmd.CommandText = [IO.File]::ReadAllText($QueryFile, [Text.Encoding]::UTF8)
    $cmd.CommandTimeout = 300
    $r = $cmd.ExecuteReader()
    $cols = @(0..($r.FieldCount - 1) | ForEach-Object { $r.GetName($_) })
    $rows = New-Object System.Collections.ArrayList
    while ($r.Read()) {
      $row = @(0..($r.FieldCount - 1) | ForEach-Object {
        $v = $r.GetValue($_)
        if ($v -is [DBNull] -or $null -eq $v) { $null }
        elseif ($v -is [DateTime]) { $v.ToString('yyyy-MM-ddTHH:mm:ss') }
        elseif ($v -is [decimal] -or $v -is [double] -or $v -is [single] -or $v -is [int64] -or $v -is [int32]) { [double]$v }
        else { [string]$v }
      })
      [void]$rows.Add($row)
    }
    $r.Close()
    Out-Json @{ ok = $true; columns = $cols; rows = @($rows) }
  } finally { $c.Close() }
} catch {
  Out-Json @{ ok = $false; error = $_.Exception.Message }
}
