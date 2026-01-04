# ============================================================
# SOLUTION 4: Email/Telegram Notification (PRODUCTION)
# ============================================================
# Gửi email hoặc Telegram message khi gen voice xong
# Usage: .\notify-email.ps1 -TaskId "project123" -NotifyEmail "your@email.com"

param(
    [string]$TaskId = "voice_generation",
    [string]$LogFile = "local_voice_module\output_files\generation.log",
    [string]$NotifyEmail = "",
    [string]$TelegramBotToken = $env:TELEGRAM_BOT_TOKEN,
    [string]$TelegramChatId = $env:TELEGRAM_CHAT_ID,
    [int]$CheckInterval = 30
)

function Send-EmailNotification {
    param(
        [string]$To,
        [string]$Subject,
        [string]$Body
    )

    # Requires SMTP server configuration
    $smtpServer = "smtp.gmail.com"
    $smtpPort = 587
    $smtpUser = $env:SMTP_USER
    $smtpPass = $env:SMTP_PASS

    if (-not $smtpUser -or -not $smtpPass) {
        Write-Host "⚠️  SMTP credentials not configured" -ForegroundColor Yellow
        return $false
    }

    try {
        $smtp = New-Object Net.Mail.SmtpClient($smtpServer, $smtpPort)
        $smtp.EnableSsl = $true
        $smtp.Credentials = New-Object System.Net.NetworkCredential($smtpUser, $smtpPass)

        $message = New-Object Net.Mail.MailMessage
        $message.From = $smtpUser
        $message.To.Add($To)
        $message.Subject = $Subject
        $message.Body = $Body

        $smtp.Send($message)
        Write-Host "✅ Email sent to $To" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "❌ Email failed: $_" -ForegroundColor Red
        return $false
    }
}

function Send-TelegramNotification {
    param(
        [string]$BotToken,
        [string]$ChatId,
        [string]$Message
    )

    if (-not $BotToken -or -not $ChatId) {
        Write-Host "⚠️  Telegram credentials not configured" -ForegroundColor Yellow
        return $false
    }

    try {
        $url = "https://api.telegram.org/bot$BotToken/sendMessage"
        $body = @{
            chat_id = $ChatId
            text = $Message
            parse_mode = "Markdown"
        } | ConvertTo-Json

        $response = Invoke-RestMethod -Uri $url -Method Post -Body $body -ContentType "application/json"

        if ($response.ok) {
            Write-Host "✅ Telegram message sent!" -ForegroundColor Green
            return $true
        } else {
            Write-Host "❌ Telegram failed: $($response.description)" -ForegroundColor Red
            return $false
        }
    } catch {
        Write-Host "❌ Telegram error: $_" -ForegroundColor Red
        return $false
    }
}

function Monitor-AndNotify {
    Write-Host "🎙️ [Monitor] Task: $TaskId" -ForegroundColor Cyan
    Write-Host "📋 Log file: $LogFile" -ForegroundColor Gray
    Write-Host "⏱️  Check interval: $CheckInterval seconds" -ForegroundColor Gray
    Write-Host ""

    $startTime = Get-Date

    while ($true) {
        if (Test-Path $LogFile) {
            $logContent = Get-Content $LogFile -Tail 50 -ErrorAction SilentlyContinue

            # Check completion
            $completed = $logContent | Select-String -Pattern "SUCCESS|✅|complete"

            if ($completed) {
                $elapsed = (Get-Date) - $startTime
                $duration = "{0:hh\:mm\:ss}" -f $elapsed

                Write-Host "✅ VOICE GENERATION COMPLETE!" -ForegroundColor Green
                Write-Host "⏱️  Duration: $duration" -ForegroundColor Cyan

                # Notification message
                $message = @"
🎙️ **Voice Generation Complete!**

📁 Task ID: $TaskId
⏱️ Duration: $duration
✅ Status: SUCCESS

Generated files:
- Audio: project_audio.mp3
- SRT: project_subtitles.srt
- Scenes: Ready for rendering
"@

                # Send notifications
                if ($NotifyEmail) {
                    Send-EmailNotification -To $NotifyEmail `
                        -Subject "🎙️ Voice Generation Complete - $TaskId" `
                        -Body $message
                }

                if ($TelegramBotToken -and $TelegramChatId) {
                    Send-TelegramNotification -BotToken $TelegramBotToken `
                        -ChatId $TelegramChatId `
                        -Message $message
                }

                # Local notification
                Add-Type -AssemblyName System.Windows.Forms
                $notify = New-Object System.Windows.Forms.NotifyIcon
                $notify.Icon = [System.Drawing.SystemIcons]::Information
                $notify.BalloonTipTitle = "🎙️ Voice Generation Complete!"
                $notify.BalloonTipText = "Task: $TaskId`nDuration: $duration"
                $notify.Visible = $true
                $notify.ShowBalloonTip(10000)

                [System.Media.SystemSounds]::Exclamation.Play()

                Start-Sleep -Seconds 10
                $notify.Dispose()

                break
            }

            # Check errors
            $errors = $logContent | Select-String -Pattern "ERROR|❌|failed"
            if ($errors) {
                Write-Host "❌ ERROR detected!" -ForegroundColor Red

                $errorMessage = "❌ Voice Generation Failed`n`nTask: $TaskId`nError: $($errors[-1])"

                if ($TelegramBotToken -and $TelegramChatId) {
                    Send-TelegramNotification -BotToken $TelegramBotToken `
                        -ChatId $TelegramChatId `
                        -Message $errorMessage
                }

                break
            }
        }

        $elapsed = (Get-Date) - $startTime
        Write-Host "`r⏳ Elapsed: $("{0:hh\:mm\:ss}" -f $elapsed)" -NoNewline

        Start-Sleep -Seconds $CheckInterval
    }
}

# Main execution
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "📧  VOICE GENERATION NOTIFICATION SYSTEM" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""

# Show configuration
Write-Host "📋 Configuration:" -ForegroundColor Yellow
Write-Host "   Email: $($NotifyEmail ? $NotifyEmail : 'Not configured')"
Write-Host "   Telegram: $($TelegramChatId ? "Chat $TelegramChatId" : 'Not configured')"
Write-Host ""

Monitor-AndNotify

Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
