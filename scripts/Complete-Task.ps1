#requires -Version 5.1
<#
.SYNOPSIS
Mark exactly one task Done in PROGRESS.md and append audit evidence to CHANGELOG.md.
.DESCRIPTION
Only use after tests and acceptance criteria really pass. File edits are local; git commit is manual.
.EXAMPLE
.\scripts\Complete-Task.ps1 -TaskId M0-01 -Evidence 'node/npm/git/clasp/wrangler verified' -Next 'M0-02'
#>
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Z]{1,5}[0-9]*-[0-9]{2,3}$')][string]$TaskId,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$Evidence,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$Next
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$progressFile = Join-Path $root 'PROGRESS.md'
$changelogFile = Join-Path $root 'CHANGELOG.md'
$progress = Get-Content $progressFile -Raw -Encoding UTF8
$changelog = Get-Content $changelogFile -Raw -Encoding UTF8

if ($Evidence -match '(?i)(AIza|bot[0-9]{6,}:|xox[baprs]-|sk-[a-zA-Z0-9])') {
    throw 'Evidence looks like it contains a secret. Redact it before continuing.'
}

$escapedId = [regex]::Escape($TaskId)
$pattern = New-Object System.Text.RegularExpressions.Regex "(?m)^- \[ \] $escapedId(?=\s+—)"
$alreadyDone = [regex]::IsMatch($progress, "(?m)^- \[x\] $escapedId(?=\s+—)")
if ($alreadyDone) { throw "Task $TaskId already marked DONE. Do not double-count." }
if (-not $pattern.IsMatch($progress)) { throw "Task $TaskId not found in unchecked task list." }
$progress = $pattern.Replace($progress, "- [x] $TaskId", 1)

try { $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById('SE Asia Standard Time') }
catch { $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById('Asia/Bangkok') }
$now = [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $tz).ToString('yyyy-MM-dd HH:mm') + ' +07:00'
$logEvidence = $Evidence.Replace('|', '/').Replace("`r", ' ').Replace("`n", ' ')
$logNext = $Next.Replace('|', '/').Replace("`r", ' ').Replace("`n", ' ')

$progress = [regex]::Replace($progress, '(?m)^> Updated:.*$', "> Updated: $now", 1)
$progress = [regex]::Replace($progress, '(?m)^> Đang thực hiện:.*$', '> Đang thực hiện: Chưa có (task gần nhất đã đóng)', 1)
$progress = [regex]::Replace($progress, '(?m)^> Next action:.*$', "> Next action: $logNext", 1)
$activityRow = "| $now | $TaskId | DONE | $logEvidence | $logNext |"
$activitySection = '## Current blockers / risks'
if (-not $progress.Contains($activitySection)) { throw 'PROGRESS.md activity section marker missing' }
$progress = $progress.Replace($activitySection, "$activityRow`n`n$activitySection")
$changelog = $changelog.TrimEnd() + "`n- $now — ${TaskId}: $logEvidence. Next: $logNext`n"

# Write both files atomically per file; review git diff and commit both with code.
[System.IO.File]::WriteAllText($progressFile, $progress, (New-Object System.Text.UTF8Encoding($false)))
[System.IO.File]::WriteAllText($changelogFile, $changelog, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Marked $TaskId DONE at $now" -ForegroundColor Green
Write-Host 'Review git diff and commit PROGRESS.md + CHANGELOG.md with your tested code.'
