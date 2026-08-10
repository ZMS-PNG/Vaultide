[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidatePattern('^openmaic_v3_canary_\d{8}_[a-f0-9]{8}$')]
  [string]$CanaryDatabase,
  [ValidateRange(1024, 65535)]
  [int]$Port = 3104,
  [string]$AccessCode,
  [ValidateRange(512, 4096)]
  [int]$NodeHeapMb = 1536,
  [ValidatePattern('^[A-Za-z0-9_-]+$')]
  [string]$WorkflowDataSuffix
)

$ErrorActionPreference = 'Stop'

function Import-EnvironmentFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') { continue }
    $name = $Matches[1]
    $value = $Matches[2]
    if ($value.Length -ge 2 -and (
      ($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))
    )) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    Set-Item -Path "Env:$name" -Value $value
  }
}

function New-CanaryConnectionString([string]$Source, [string]$Database) {
  if (-not $Source) { throw 'No database URL is configured for the isolated standalone launch.' }
  $builder = [System.UriBuilder]::new($Source)
  $builder.Path = "/$Database"
  return $builder.Uri.AbsoluteUri
}

# Next loads env files for a normal `next start`, but the generated standalone
# server does not. Import only local operator configuration, then point every
# database adapter at a separately migrated canary database. This script never
# writes vault files, production rows, or secret values to disk or stdout.
Import-EnvironmentFile (Join-Path $PSScriptRoot '..\.env.production.local')
Import-EnvironmentFile (Join-Path $PSScriptRoot '..\.env.local')
if ($AccessCode) { $env:ACCESS_CODE = $AccessCode }

$sourceUrl = $env:DATABASE_URL_UNPOOLED
if (-not $sourceUrl) { $sourceUrl = $env:POSTGRES_URL_NON_POOLING }
if (-not $sourceUrl) { $sourceUrl = $env:DATABASE_URL }
if (-not $sourceUrl) { $sourceUrl = $env:POSTGRES_URL }
$canaryUrl = New-CanaryConnectionString $sourceUrl $CanaryDatabase

foreach ($name in @('DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL', 'POSTGRES_URL_NON_POOLING')) {
  Set-Item -Path "Env:$name" -Value $canaryUrl
}

# Workflow identifies Vercel from the presence of VERCEL_URL, even when it is
# an empty local placeholder. Clear both platform hints for a true local run.
Remove-Item Env:VERCEL -ErrorAction SilentlyContinue
Remove-Item Env:VERCEL_URL -ErrorAction SilentlyContinue
$env:OPENMAIC_CONTENT_ENGINE_V3 = 'true'
$env:WORKFLOW_TARGET_WORLD = 'local'
$env:WORKFLOW_LOCAL_BASE_URL = "http://127.0.0.1:$Port"
$workflowDataName = ".workflow-data-v3-$CanaryDatabase"
if ($WorkflowDataSuffix) { $workflowDataName = "$workflowDataName-$WorkflowDataSuffix" }
$env:WORKFLOW_LOCAL_DATA_DIR = (Join-Path (Get-Location) $workflowDataName)
$env:PORT = "$Port"
$env:NEXT_TELEMETRY_DISABLED = '1'
$env:NODE_OPTIONS = "--max-old-space-size=$NodeHeapMb"

& pnpm prepare:standalone
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Output "Starting isolated Vaultide V3 standalone on port $Port with an isolated canary database, workflow directory '$workflowDataName', and a $NodeHeapMb MB Node heap limit."
$serverExitCode = 1
try {
  & node .next/standalone/server.js
  $serverExitCode = $LASTEXITCODE
}
finally {
  Write-Output "Isolated standalone exited with code $serverExitCode at $(Get-Date -Format o)."
}
exit $serverExitCode
