# ShramSafal Git Sync Script
# Usage: .\scripts\sync.ps1 "your commit message"
# Example: .\scripts\sync.ps1 "fix: voice parsing guards for spray dose"

param(
    [Parameter(Position=0)]
    [string]$msg = "wip: work in progress"
)

# Colors for output
function Write-Success { param($text) Write-Host $text -ForegroundColor Green }
function Write-Info { param($text) Write-Host $text -ForegroundColor Cyan }
function Write-Warning { param($text) Write-Host $text -ForegroundColor Yellow }
function Write-Err { param($text) Write-Host $text -ForegroundColor Red }

Write-Info "========================================="
Write-Info "ShramSafal Git Sync"
Write-Info "========================================="

# Check if we're in a git repo
if (-not (Test-Path ".git")) {
    Write-Err "Error: Not in a git repository!"
    exit 1
}

# Check for changes
$status = git status --porcelain
if (-not $status) {
    Write-Warning "No changes to commit."
    exit 0
}

Write-Info "`nStaging all changes..."
git add -A

Write-Info "`nChanges to be committed:"
git status --short

Write-Info "`nCommitting with message: '$msg'"
git commit -m $msg

if ($LASTEXITCODE -ne 0) {
    Write-Err "Commit failed!"
    exit 1
}

Write-Info "`nPushing to remote..."
git push

if ($LASTEXITCODE -ne 0) {
    Write-Warning "Push failed - remote may not be configured yet."
    Write-Info "Run: git remote add origin https://github.com/YOUR_USERNAME/ShramSafal.git"
    Write-Info "Then: git push -u origin main"
    exit 1
}

Write-Success "`n========================================="
Write-Success "Sync complete!"
Write-Success "========================================="
