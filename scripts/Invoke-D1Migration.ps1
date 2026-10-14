param([Parameter(ValueFromRemainingArguments = $true)][string[]]$MigrationArgs)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $root
try {
    $artifactDir = Join-Path $root '.artifacts/M7-07'
    New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
    & npx esbuild scripts/d1-migration-cli.ts --bundle --platform=node --format=esm --external:miniflare --outfile=.artifacts/M7-07/migrate.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Migration tool build failed' }
    & node .artifacts/M7-07/migrate.mjs @MigrationArgs
    if ($LASTEXITCODE -ne 0) { throw 'Migration command failed; inspect private report' }
} finally { Pop-Location }
