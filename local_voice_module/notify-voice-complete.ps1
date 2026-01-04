# ============================================================
# SOLUTION 1: Windows Toast Notification (ĐƠN GIẢN NHẤT)
# ============================================================
# Hiển thị notification bubble khi gen voice xong
# Usage: .\notify-voice-complete.ps1 -TaskId "project123"

param(
    [string]$TaskId = "voice_generation",
    [string]$ProcessName = "node",  # Tên process đang gen voice
    [int]$CheckInterval = 30  # Check mỗi 30 giây
)

function Show-Notification {
    param(
        [string]$Title,
        [string]$Message,
        [string]$Sound = "Default"
    )

    # Load Windows Forms để show notification
    Add-Type -AssemblyName System.Windows.Forms

    # Create notification
    $notification = New-Object System.Windows.Forms.NotifyIcon
    $notification.Icon = [System.Drawing.SystemIcons]::Information
    $notification.BalloonTipTitle = $Title
    $notification.BalloonTipText = $Message
    $notification.Visible = $True

    # Show notification
    $notification.ShowBalloonTip(10000)  # 10 seconds

    # Play sound
    [System.Media.SystemSounds]::$Sound.Play()

    # Cleanup
    Start-Sleep -Seconds 10
    $notification.Dispose()
}

function Monitor-VoiceGeneration {
    param(
        [string]$LogFile = "local_voice_module\output_files\generation.log",
        [string]$ProjectId
    )

    Write-Host "🎙️ [Monitor] Watching voice generation for: $ProjectId"
    Write-Host "📋 Log file: $LogFile"
    Write-Host "⏱️  Check interval: $CheckInterval seconds"
    Write-Host ""

    $startTime = Get-Date
    $lastProgress = 0

    while ($true) {
        # Check if log file exists
        if (Test-Path $LogFile) {
            # Read last 50 lines of log
            $logContent = Get-Content $LogFile -Tail 50 -ErrorAction SilentlyContinue

            # Check for completion markers
            $completed = $logContent | Select-String -Pattern "SUCCESS|✅|Voice + SRT complete|Pipeline complete"

            if ($completed) {
                $elapsed = (Get-Date) - $startTime
                $duration = "{0:hh\:mm\:ss}" -f $elapsed

                Write-Host "✅ VOICE GENERATION COMPLETE!" -ForegroundColor Green
                Write-Host "⏱️  Duration: $duration" -ForegroundColor Cyan

                # Show Windows notification
                Show-Notification -Title "🎙️ Voice Generation Complete!" `
                    -Message "Project: $ProjectId`nDuration: $duration" `
                    -Sound "Exclamation"

                # Play additional beep
                [console]::beep(800, 500)
                [console]::beep(1000, 500)

                break
            }

            # Check for progress updates
            $progressLine = $logContent | Select-String -Pattern "(\d+)%" | Select-Object -Last 1
            if ($progressLine) {
                $progress = [regex]::Match($progressLine, "(\d+)%").Groups[1].Value
                if ($progress -ne $lastProgress) {
                    Write-Host "📊 Progress: $progress%" -ForegroundColor Yellow
                    $lastProgress = $progress
                }
            }

            # Check for errors
            $errors = $logContent | Select-String -Pattern "ERROR|❌|failed"
            if ($errors) {
                Write-Host "❌ ERROR detected in generation!" -ForegroundColor Red
                Write-Host $errors[-1] -ForegroundColor Red

                Show-Notification -Title "❌ Voice Generation Failed" `
                    -Message "Check logs for details" `
                    -Sound "Hand"

                break
            }
        }

        # Show elapsed time
        $elapsed = (Get-Date) - $startTime
        Write-Host "`r⏳ Elapsed: $("{0:hh\:mm\:ss}" -f $elapsed)" -NoNewline

        # Wait before next check
        Start-Sleep -Seconds $CheckInterval
    }
}

# Main execution
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "🎙️  VOICE GENERATION MONITOR" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""

Monitor-VoiceGeneration -ProjectId $TaskId

Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
