# ============================================================
# SOLUTION 3: Process Monitor + Desktop Alert (SIMPLE)
# ============================================================
# Monitor Node.js process và show notification khi process kết thúc
# Usage: .\monitor-process.ps1 -ProcessId 12345

param(
    [int]$ProcessId = 0,
    [string]$ProcessName = "node"
)

function Show-BalloonTip {
    param(
        [string]$Title,
        [string]$Message,
        [string]$Icon = "Info"  # Info, Warning, Error
    )

    Add-Type -AssemblyName System.Windows.Forms

    $balloon = New-Object System.Windows.Forms.NotifyIcon
    $balloon.Icon = [System.Drawing.SystemIcons]::Information
    $balloon.BalloonTipIcon = $Icon
    $balloon.BalloonTipTitle = $Title
    $balloon.BalloonTipText = $Message
    $balloon.Visible = $true

    $balloon.ShowBalloonTip(15000)

    # Play sound based on icon
    switch ($Icon) {
        "Info" { [System.Media.SystemSounds]::Asterisk.Play() }
        "Warning" { [System.Media.SystemSounds]::Exclamation.Play() }
        "Error" { [System.Media.SystemSounds]::Hand.Play() }
    }

    Start-Sleep -Seconds 15
    $balloon.Dispose()
}

function Get-VoiceGenerationProcess {
    # Find node process running voice generation
    $processes = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue

    if ($processes) {
        Write-Host "📋 Found $($processes.Count) Node.js process(es):" -ForegroundColor Cyan
        $processes | ForEach-Object {
            Write-Host "   [$($_.Id)] $($_.ProcessName) - CPU: $($_.CPU)s, Memory: $([Math]::Round($_.WorkingSet64/1MB, 2))MB"
        }

        if ($processes.Count -eq 1) {
            return $processes[0]
        } else {
            Write-Host ""
            $selectedId = Read-Host "Enter Process ID to monitor"
            return Get-Process -Id $selectedId -ErrorAction SilentlyContinue
        }
    } else {
        Write-Host "❌ No Node.js processes found!" -ForegroundColor Red
        return $null
    }
}

function Monitor-Process {
    param(
        [System.Diagnostics.Process]$Process
    )

    $startTime = Get-Date
    $processId = $Process.Id
    $processName = $Process.ProcessName

    Write-Host ""
    Write-Host "👀 Monitoring process: [$processId] $processName" -ForegroundColor Green
    Write-Host "⏳ Started: $($startTime.ToString('HH:mm:ss'))" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Press Ctrl+C to stop monitoring..." -ForegroundColor Yellow
    Write-Host ""

    # Monitor CPU and memory
    while (-not $Process.HasExited) {
        try {
            $Process.Refresh()

            $elapsed = (Get-Date) - $startTime
            $cpu = [Math]::Round($Process.CPU, 1)
            $memory = [Math]::Round($Process.WorkingSet64/1MB, 0)

            # Show stats
            Write-Host "`r⏱️  Running: $("{0:hh\:mm\:ss}" -f $elapsed) | CPU: $cpu`s | RAM: ${memory}MB   " -NoNewline

            Start-Sleep -Seconds 2
        } catch {
            break
        }
    }

    # Process completed
    $totalTime = ((Get-Date) - $startTime).TotalSeconds

    Write-Host ""
    Write-Host ""
    Write-Host "✅ PROCESS COMPLETED!" -ForegroundColor Green
    Write-Host "⏱️  Total time: $([Math]::Round($totalTime, 0)) seconds" -ForegroundColor Cyan

    # Check exit code
    $exitCode = $Process.ExitCode
    if ($exitCode -eq 0) {
        Show-BalloonTip -Title "🎙️ Voice Generation Complete!" `
            -Message "Process completed successfully`nDuration: $([Math]::Round($totalTime/60, 1)) minutes" `
            -Icon "Info"

        # Success beeps
        [console]::beep(1000, 200)
        [console]::beep(1200, 200)
        [console]::beep(1500, 300)
    } else {
        Show-BalloonTip -Title "❌ Voice Generation Failed" `
            -Message "Process exited with code: $exitCode" `
            -Icon "Error"

        # Error beep
        [console]::beep(500, 500)
    }
}

# Main execution
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "🎙️  VOICE GENERATION PROCESS MONITOR" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""

if ($ProcessId -gt 0) {
    # Monitor specific process ID
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($process) {
        Monitor-Process -Process $process
    } else {
        Write-Host "❌ Process $ProcessId not found!" -ForegroundColor Red
    }
} else {
    # Find and select process
    $process = Get-VoiceGenerationProcess
    if ($process) {
        Monitor-Process -Process $process
    }
}

Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
