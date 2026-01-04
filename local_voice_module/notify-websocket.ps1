# ============================================================
# SOLUTION 2: WebSocket Real-time Progress (ADVANCED)
# ============================================================
# Kết nối WebSocket để nhận real-time updates
# Usage: .\notify-websocket.ps1 -ApiKey "your_api_key" -TaskId "project123"

param(
    [string]$ApiKey = $env:GENAIPRO_API_KEY,
    [string]$TaskId = "",
    [string]$WebSocketUrl = "wss://genaipro.vn/ws"
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName PresentationFramework

function Show-ProgressNotification {
    param(
        [int]$Percentage,
        [string]$TaskId
    )

    # Update console progress bar
    $barLength = 50
    $filled = [Math]::Floor($Percentage * $barLength / 100)
    $empty = $barLength - $filled

    $bar = "[" + ("█" * $filled) + ("░" * $empty) + "]"
    Write-Host "`r$bar $Percentage% - Task: $TaskId" -NoNewline
}

function Show-CompletionNotification {
    param(
        [string]$TaskId,
        [int]$Duration
    )

    # Windows Toast Notification
    $notification = New-Object System.Windows.Forms.NotifyIcon
    $notification.Icon = [System.Drawing.SystemIcons]::Information
    $notification.BalloonTipTitle = "🎉 Voice Generation Complete!"
    $notification.BalloonTipText = "Task: $TaskId`nCompleted in $Duration seconds"
    $notification.Visible = $True
    $notification.ShowBalloonTip(10000)

    # Sound alert
    [System.Media.SystemSounds]::Exclamation.Play()
    [console]::beep(1000, 300)
    [console]::beep(1200, 300)
    [console]::beep(1500, 500)

    Write-Host ""
    Write-Host "✅ VOICE GENERATION COMPLETE!" -ForegroundColor Green
    Write-Host "📁 Task ID: $TaskId" -ForegroundColor Cyan
    Write-Host "⏱️  Duration: $Duration seconds" -ForegroundColor Cyan

    Start-Sleep -Seconds 10
    $notification.Dispose()
}

function Connect-WebSocket {
    param(
        [string]$Url,
        [string]$Token
    )

    Write-Host "🔌 Connecting to WebSocket..." -ForegroundColor Yellow
    Write-Host "📍 URL: $Url" -ForegroundColor Gray

    # Create WebSocket client
    $ws = New-Object System.Net.WebSockets.ClientWebSocket
    $uri = New-Object System.Uri("${Url}?token=${Token}")

    try {
        # Connect
        $cancellationToken = New-Object System.Threading.CancellationToken
        $connectTask = $ws.ConnectAsync($uri, $cancellationToken)
        $connectTask.Wait()

        if ($ws.State -eq 'Open') {
            Write-Host "✅ WebSocket connected!" -ForegroundColor Green
            Write-Host ""
            return $ws
        } else {
            Write-Host "❌ Failed to connect: $($ws.State)" -ForegroundColor Red
            return $null
        }
    } catch {
        Write-Host "❌ Connection error: $_" -ForegroundColor Red
        return $null
    }
}

function Receive-WebSocketMessage {
    param(
        [System.Net.WebSockets.ClientWebSocket]$WebSocket
    )

    $buffer = New-Object Byte[] 4096
    $cancellationToken = New-Object System.Threading.CancellationToken
    $segment = New-Object System.ArraySegment[Byte] -ArgumentList @(,$buffer)

    try {
        $receiveTask = $WebSocket.ReceiveAsync($segment, $cancellationToken)
        $receiveTask.Wait()

        $result = $receiveTask.Result
        $message = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)

        return $message
    } catch {
        Write-Host "❌ Receive error: $_" -ForegroundColor Red
        return $null
    }
}

function Monitor-WebSocketUpdates {
    param(
        [System.Net.WebSockets.ClientWebSocket]$WebSocket,
        [string]$TargetTaskId
    )

    $startTime = Get-Date
    $lastPercentage = 0

    Write-Host "👀 Monitoring task: $TargetTaskId" -ForegroundColor Cyan
    Write-Host "⏳ Waiting for updates..." -ForegroundColor Gray
    Write-Host ""

    while ($WebSocket.State -eq 'Open') {
        $message = Receive-WebSocketMessage -WebSocket $WebSocket

        if ($message) {
            # Parse JSON message
            $data = $message | ConvertFrom-Json

            # Check if it's our task
            if ($data.payload.task_id -eq $TargetTaskId) {
                $percentage = $data.payload.process_percentage

                # Show progress
                if ($percentage -ne $lastPercentage) {
                    Show-ProgressNotification -Percentage $percentage -TaskId $TargetTaskId
                    $lastPercentage = $percentage
                }

                # Check if complete
                if ($percentage -ge 100) {
                    $elapsed = ((Get-Date) - $startTime).TotalSeconds
                    Show-CompletionNotification -TaskId $TargetTaskId -Duration ([Math]::Round($elapsed))
                    break
                }
            }
        }

        Start-Sleep -Milliseconds 100
    }
}

# Main execution
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "🎙️  VOICE GENERATION WEBSOCKET MONITOR" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""

# Validate API key
if (-not $ApiKey) {
    Write-Host "❌ No API key provided!" -ForegroundColor Red
    Write-Host "Set environment variable: `$env:GENAIPRO_API_KEY = 'your_key'" -ForegroundColor Yellow
    exit 1
}

# Connect to WebSocket
$ws = Connect-WebSocket -Url $WebSocketUrl -Token $ApiKey

if ($ws) {
    # Monitor updates
    if ($TaskId) {
        Monitor-WebSocketUpdates -WebSocket $ws -TargetTaskId $TaskId
    } else {
        Write-Host "⚠️  No task ID specified, monitoring all tasks..." -ForegroundColor Yellow
        # Monitor all tasks
        while ($ws.State -eq 'Open') {
            $message = Receive-WebSocketMessage -WebSocket $ws
            if ($message) {
                Write-Host $message -ForegroundColor Gray
            }
        }
    }

    # Close connection
    $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "Done", [System.Threading.CancellationToken]::None).Wait()
    $ws.Dispose()
}

Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
