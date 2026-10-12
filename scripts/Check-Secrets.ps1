#requires -Version 5.1
<#
.SYNOPSIS
Scan tracked and staged Git files for accidental secrets or forbidden credential files.
#>
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root

$forbiddenFiles = @(
    '(^|/)\.env$',
    '(^|/)\.env\.(?!example$)',
    '(^|/)\.dev\.vars$',
    '(^|/)\.dev\.vars\.(?!example$)',
    '(^|/)\.clasp\.json$',
    '(^|/)\.clasprc\.json$',
    '\.(pem|key|p12)$'
)

$tracked = git ls-files
foreach ($file in $tracked) {
    foreach ($pattern in $forbiddenFiles) {
        if ($file -match $pattern) {
            throw "Forbidden credential file tracked in Git: $file"
        }
    }
}

$secretPatterns = @(
    'AIza[0-9A-Za-z\-_]{35}',
    '\b[0-9]{8,10}:[A-Za-z0-9_-]{35}\b',
    'sk-[A-Za-z0-9]{20,}',
    'xox[baprs]-[A-Za-z0-9-]+'
)

foreach ($file in $tracked) {
    if (-not (Test-Path $file -PathType Leaf)) { continue }
    $content = Get-Content $file -Raw -Encoding UTF8
    if ([string]::IsNullOrEmpty($content)) { continue }
    foreach ($sp in $secretPatterns) {
        if ([regex]::IsMatch($content, $sp)) {
            throw "Potential secret matching pattern '$sp' found in tracked file: $file"
        }
    }
}

Write-Host 'Secret scan passed: 0 forbidden files and 0 secret patterns in tracked Git files.' -ForegroundColor Green
