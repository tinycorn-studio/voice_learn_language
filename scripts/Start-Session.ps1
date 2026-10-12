#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $projectRoot

Write-Host '=== VoiceChatLearnLanguage Session ===' -ForegroundColor Cyan
Write-Host "Root: $projectRoot"
Write-Host 'Read AGENTS.md / PROGRESS.md / docs/13_MILESTONES.md before coding.'
Write-Host ''
Get-Content (Join-Path $projectRoot 'PROGRESS.md') -Encoding UTF8 | Select-Object -First 15
Write-Host ''
if (Get-Command git -ErrorAction SilentlyContinue) {
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $inside = git rev-parse --is-inside-work-tree 2>$null
    $gitExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    if ($gitExit -eq 0 -and $inside -eq 'true') {
        Write-Host 'Git status:' -ForegroundColor Yellow
        git status --short
        Write-Host 'Recent commits:' -ForegroundColor Yellow
        git log -3 --oneline
    }
    else {
        Write-Host 'Git repository not initialized yet (expected before M0-01).' -ForegroundColor Yellow
    }
}
else {
    Write-Host 'Git missing. Install it to complete M0-01.' -ForegroundColor Yellow
}
Write-Host ''
Write-Host 'For incomplete tasks: update PROGRESS manually with blocker/next. For completed tasks: run scripts/Complete-Task.ps1 with test evidence.'
