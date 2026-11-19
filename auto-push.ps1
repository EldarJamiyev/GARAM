param (
    [int]$IntervalSeconds = 30
)

$RepoPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -Path $RepoPath

Write-Host "Auto-push daemon active for: $RepoPath"
Write-Host "Checking every $IntervalSeconds seconds... (Press Ctrl+C to stop)"

while ($true) {
    try {
        $status = git status --porcelain
        if ($status) {
            $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
            Write-Host "[$timestamp] Changes detected. Committing and pushing..."
            git add -A
            git commit -m "Auto-sync: $timestamp"
            git push origin main
            Write-Host "[$timestamp] Successfully pushed to origin/main."
        }
    }
    catch {
        Write-Warning "Auto-sync encountered an error: $_"
    }
    Start-Sleep -Seconds $IntervalSeconds
}
