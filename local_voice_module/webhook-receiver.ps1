# ============================================================
# WEBHOOK RECEIVER - Nhận notification từ GenAI khi gen voice xong
# ============================================================
# Tạo HTTP server để nhận webhook POST từ GenAI API
# Usage: .\webhook-receiver.ps1 -Port 8080

param(
    [int]$Port = 8080,
    [string]$DownloadPath = ".\downloads",
    [switch]$AutoDownload = $true,
    [string]$TelegramBotToken = $env:TELEGRAM_BOT_TOKEN,
    [string]$TelegramChatId = $env:TELEGRAM_CHAT_ID
)

# Ensure download directory exists
New-Item -ItemType Directory -Force -Path $DownloadPath | Out-Null

function Show-Notification {
    param(
        [string]$Title,
        [string]$Message
    )

    Add-Type -AssemblyName System.Windows.Forms
    $notification = New-Object System.Windows.Forms.NotifyIcon
    $notification.Icon = [System.Drawing.SystemIcons]::Information
    $notification.BalloonTipTitle = $Title
    $notification.BalloonTipText = $Message
    $notification.Visible = $True
    $notification.ShowBalloonTip(10000)

    [System.Media.SystemSounds]::Exclamation.Play()
    [console]::beep(1000, 300)
    [console]::beep(1200, 300)

    Start-Sleep -Seconds 10
    $notification.Dispose()
}

function Send-TelegramMessage {
    param(
        [string]$Message
    )

    if ($TelegramBotToken -and $TelegramChatId) {
        try {
            $url = "https://api.telegram.org/bot$TelegramBotToken/sendMessage"
            $body = @{
                chat_id = $TelegramChatId
                text = $Message
                parse_mode = "Markdown"
            } | ConvertTo-Json

            Invoke-RestMethod -Uri $url -Method Post -Body $body -ContentType "application/json" | Out-Null
            Write-Host "✅ Telegram notification sent!" -ForegroundColor Green
        } catch {
            Write-Host "⚠️  Telegram failed: $_" -ForegroundColor Yellow
        }
    }
}

function Download-VoiceFile {
    param(
        [string]$Url,
        [string]$TaskId
    )

    try {
        $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
        $filename = "${TaskId}_${timestamp}.mp3"
        $filepath = Join-Path $DownloadPath $filename

        Write-Host "📥 Downloading: $Url" -ForegroundColor Cyan
        Write-Host "📁 Saving to: $filepath" -ForegroundColor Gray

        # Download with progress
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $Url -OutFile $filepath

        $fileSize = (Get-Item $filepath).Length / 1MB
        Write-Host "✅ Downloaded: $([Math]::Round($fileSize, 2)) MB" -ForegroundColor Green

        return $filepath
    } catch {
        Write-Host "❌ Download failed: $_" -ForegroundColor Red
        return $null
    }
}

function Handle-WebhookRequest {
    param(
        [System.Net.HttpListenerContext]$Context
    )

    $request = $Context.Request
    $response = $Context.Response

    try {
        # Read request body
        $reader = New-Object System.IO.StreamReader($request.InputStream)
        $body = $reader.ReadToEnd()
        $reader.Close()

        Write-Host ""
        Write-Host "=" * 60 -ForegroundColor Cyan
        Write-Host "📬 WEBHOOK RECEIVED" -ForegroundColor Cyan
        Write-Host "=" * 60 -ForegroundColor Cyan
        Write-Host "🕐 Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
        Write-Host "📍 From: $($request.RemoteEndPoint.Address)" -ForegroundColor Gray
        Write-Host ""

        # Parse JSON
        $data = $body | ConvertFrom-Json

        Write-Host "📦 Webhook Data:" -ForegroundColor Yellow
        Write-Host ($data | ConvertTo-Json -Depth 5) -ForegroundColor White
        Write-Host ""

        # Extract info (adjust based on actual GenAI webhook format)
        $taskId = $data.task_id
        $status = $data.status
        $fileUrl = $data.file_url ?? $data.download_url ?? $data.audio_url
        $duration = $data.duration
        $processTime = $data.process_time

        # Log details
        Write-Host "📋 Task Details:" -ForegroundColor Green
        Write-Host "   Task ID: $taskId"
        Write-Host "   Status: $status"
        Write-Host "   File URL: $fileUrl"
        if ($duration) { Write-Host "   Duration: ${duration}s" }
        if ($processTime) { Write-Host "   Process Time: ${processTime}s" }
        Write-Host ""

        # Auto-download if enabled
        $downloadedFile = $null
        if ($AutoDownload -and $fileUrl) {
            $downloadedFile = Download-VoiceFile -Url $fileUrl -TaskId $taskId
        }

        # Send notifications
        $notificationMessage = @"
🎙️ **Voice Generation Complete!**

📁 Task ID: ``$taskId``
✅ Status: $status
$(if ($duration) { "⏱️ Duration: ${duration}s" })
$(if ($processTime) { "⚙️ Process Time: ${processTime}s" })
$(if ($downloadedFile) { "💾 Downloaded: ``$downloadedFile``" })

🔗 Download: $fileUrl
"@

        # Windows notification
        Show-Notification -Title "🎙️ Voice Generation Complete!" `
            -Message "Task: $taskId`nStatus: $status"

        # Telegram notification
        Send-TelegramMessage -Message $notificationMessage

        # Send success response
        $responseBody = @{
            success = $true
            message = "Webhook received successfully"
            downloaded = ($null -ne $downloadedFile)
            download_path = $downloadedFile
        } | ConvertTo-Json

        $buffer = [System.Text.Encoding]::UTF8.GetBytes($responseBody)
        $response.ContentType = "application/json"
        $response.ContentLength64 = $buffer.Length
        $response.StatusCode = 200
        $response.OutputStream.Write($buffer, 0, $buffer.Length)
        $response.Close()

        Write-Host "✅ Webhook processed successfully!" -ForegroundColor Green
        Write-Host "=" * 60 -ForegroundColor Cyan
        Write-Host ""

    } catch {
        Write-Host "❌ Error processing webhook: $_" -ForegroundColor Red

        # Send error response
        $errorBody = @{
            success = $false
            error = $_.Exception.Message
        } | ConvertTo-Json

        $buffer = [System.Text.Encoding]::UTF8.GetBytes($errorBody)
        $response.ContentType = "application/json"
        $response.StatusCode = 500
        $response.OutputStream.Write($buffer, 0, $buffer.Length)
        $response.Close()
    }
}

# Main execution
Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host "🔔 WEBHOOK RECEIVER FOR GENAI VOICE GENERATION" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host ""
Write-Host "⚙️  Configuration:" -ForegroundColor Yellow
Write-Host "   Port: $Port"
Write-Host "   Download Path: $DownloadPath"
Write-Host "   Auto-Download: $AutoDownload"
Write-Host "   Telegram: $(if ($TelegramChatId) { 'Enabled' } else { 'Disabled' })"
Write-Host ""
Write-Host "📍 Webhook URL: http://localhost:$Port/webhook" -ForegroundColor Green
Write-Host ""
Write-Host "💡 Configure this URL in GenAI dashboard:" -ForegroundColor Yellow
Write-Host "   - If local: Use ngrok to expose: ngrok http $Port" -ForegroundColor Gray
Write-Host "   - Then use: https://your-ngrok-id.ngrok.io/webhook" -ForegroundColor Gray
Write-Host ""
Write-Host "🎯 Waiting for webhooks..." -ForegroundColor Cyan
Write-Host "   Press Ctrl+C to stop" -ForegroundColor Gray
Write-Host ""

# Create HTTP listener
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://+:$Port/")

try {
    $listener.Start()
    Write-Host "✅ Server started on port $Port" -ForegroundColor Green
    Write-Host ""

    # Listen for requests
    while ($listener.IsListening) {
        $context = $listener.GetContext()

        # Handle webhook in background
        $runspace = [runspacefactory]::CreateRunspace()
        $runspace.Open()
        $runspace.SessionStateProxy.SetVariable('Context', $context)
        $runspace.SessionStateProxy.SetVariable('AutoDownload', $AutoDownload)
        $runspace.SessionStateProxy.SetVariable('DownloadPath', $DownloadPath)
        $runspace.SessionStateProxy.SetVariable('TelegramBotToken', $TelegramBotToken)
        $runspace.SessionStateProxy.SetVariable('TelegramChatId', $TelegramChatId)

        # Handle request
        Handle-WebhookRequest -Context $context
    }
} catch {
    Write-Host "❌ Server error: $_" -ForegroundColor Red
} finally {
    $listener.Stop()
    $listener.Close()
    Write-Host ""
    Write-Host "🛑 Server stopped" -ForegroundColor Yellow
}
