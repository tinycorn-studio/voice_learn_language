#requires -Version 5.1
<#
Record an incomplete task as blocked without falsely marking DONE.
Example: .\scripts\Mark-Blocked.ps1 -TaskId M0-02 -Reason 'Awaiting Google OAuth authorization' -Next 'Authorize in Script Editor'
#>
param(
    [Parameter(Mandatory = $true)][string]$TaskId,
    [Parameter(Mandatory = $true)][string]$Reason,
    [Parameter(Mandatory = $true)][string]$Next
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$file = Join-Path $root 'PROGRESS.md'
$p = Get-Content $file -Raw -Encoding UTF8
if ($p -notmatch ('(?m)^- \[ \] ' + [regex]::Escape($TaskId) + '(?=\s+\u2014)')) { throw "Task not pending: $TaskId" }
try { $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById('SE Asia Standard Time') }
catch { $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById('Asia/Bangkok') }
$now = [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $tz).ToString('yyyy-MM-dd HH:mm') + ' +07:00'
$reasonSafe = $Reason.Replace('|','/').Replace("`n", ' ')
$nextSafe = $Next.Replace('|','/').Replace("`n", ' ')
$inProgressBlocked = "> $([char]0x0110)ang th$([char]0x1EF1)c hi$([char]0x1EC7)n: $TaskId (BLOCKED)"
$p = [regex]::Replace($p, '(?m)^> Updated:.*$', "> Updated: $now", 1)
$p = [regex]::Replace($p, '(?m)^> \u0110ang th\u1EF1c hi\u1EC7n:.*$', $inProgressBlocked, 1)
$p = [regex]::Replace($p, '(?m)^> Next action:.*$', "> Next action: $nextSafe", 1)
$p = $p.Replace('## Current blockers / risks', "| $now | $TaskId | BLOCKED | $reasonSafe | $nextSafe |`n`n## Current blockers / risks")
[System.IO.File]::WriteAllText($file, $p, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Recorded blocker for $TaskId. Task remains unchecked." -ForegroundColor Yellow
