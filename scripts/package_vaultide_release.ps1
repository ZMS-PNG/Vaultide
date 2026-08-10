$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $repoRoot 'output\vaultide-release'
$pluginRoot = Join-Path $releaseRoot 'obsidian-plugin'
$docsRoot = Join-Path $releaseRoot 'docs'
$brandRoot = Join-Path $releaseRoot 'brand'

New-Item -ItemType Directory -Force -Path $releaseRoot, $pluginRoot, $docsRoot, $brandRoot | Out-Null

$pluginSource = Join-Path $repoRoot 'packages\obsidian-plugin'
$pluginManifest = Get-Content -LiteralPath (Join-Path $pluginSource 'manifest.json') -Raw -Encoding UTF8 |
    ConvertFrom-Json
foreach ($name in @('main.js', 'manifest.json', 'styles.css')) {
    $source = Join-Path $pluginSource $name
    if (-not (Test-Path -LiteralPath $source)) {
        throw "Missing built plugin artifact: $source"
    }
    Copy-Item -LiteralPath $source -Destination (Join-Path $pluginRoot $name) -Force
}

$pluginZip = Join-Path $releaseRoot "Vaultide-Obsidian-Connector-$($pluginManifest.version).zip"
Compress-Archive -Path (Join-Path $pluginRoot '*') -DestinationPath $pluginZip -Force

Copy-Item -LiteralPath (Join-Path $repoRoot 'LICENSE') -Destination $releaseRoot -Force
Copy-Item -LiteralPath (Join-Path $repoRoot 'product\vaultide-product.json') -Destination $releaseRoot -Force
Copy-Item -LiteralPath (Join-Path $repoRoot 'docs\vaultide\README.md') -Destination $docsRoot -Force
Copy-Item -LiteralPath (Join-Path $repoRoot 'docs\vaultide\QUICKSTART.md') -Destination $docsRoot -Force
Copy-Item -LiteralPath (Join-Path $repoRoot 'docs\vaultide\BRAND.md') -Destination $docsRoot -Force

Get-ChildItem -LiteralPath (Join-Path $repoRoot 'public\brand') -File |
    Where-Object { $_.Name -notlike '*-chroma.png' } |
    Copy-Item -Destination $brandRoot -Force

$manualRoot = Join-Path $repoRoot 'output\manual'
Get-ChildItem -LiteralPath $manualRoot -File -Filter 'Vaultide-*' |
    Where-Object { $_.Extension -in @('.png', '.pdf', '.pptx') } |
    Copy-Item -Destination $releaseRoot -Force

Write-Output $releaseRoot
