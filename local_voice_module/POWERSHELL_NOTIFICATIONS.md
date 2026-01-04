# 🔔 POWERSHELL NOTIFICATIONS - Báo khi gen voice xong

**4 giải pháp notification cho Voice Generation**

---

## 📋 4 GIẢI PHÁP

| Script | Cách hoạt động | Độ phức tạp | Best for |
|--------|----------------|-------------|----------|
| **#1: notify-voice-complete.ps1** | Monitor log file | ⭐ Dễ | Development |
| **#2: notify-websocket.ps1** | WebSocket real-time | ⭐⭐⭐ Khó | Production API |
| **#3: monitor-process.ps1** | Monitor Node.js process | ⭐ Dễ | Local testing |
| **#4: notify-email.ps1** | Email/Telegram alert | ⭐⭐ Trung bình | Remote work |

---

## 🚀 SOLUTION 1: Windows Toast Notification (ĐƠN GIẢN NHẤT) ⭐

**Cách hoạt động:**
- Monitor log file của voice generation
- Detect "SUCCESS" hoặc "complete" markers
- Show Windows notification bubble + beep sound

**Usage:**
```powershell
# Start voice generation trong terminal 1
cd local_voice_module
node test_local_voice.js > output_files/generation.log 2>&1

# Monitor trong terminal 2 (PowerShell)
.\notify-voice-complete.ps1 -TaskId "project123"

# Output:
# 🎙️ [Monitor] Watching voice generation for: project123
# 📋 Log file: local_voice_module\output_files\generation.log
# ⏱️  Check interval: 30 seconds
#
# ⏳ Elapsed: 00:15:30
# ✅ VOICE GENERATION COMPLETE!
# ⏱️  Duration: 00:15:32
#
# [Windows notification popup appears]
# [Beep sounds: 800Hz → 1000Hz]
```

**Features:**
- ✅ Windows toast notification (bubble bottom-right)
- ✅ Sound alert (beep beep)
- ✅ Progress tracking (% nếu có trong log)
- ✅ Error detection
- ✅ Elapsed time counter

**Configuration:**
```powershell
# Custom check interval (mặc định: 30s)
.\notify-voice-complete.ps1 -CheckInterval 60

# Custom log file location
.\notify-voice-complete.ps1 -TaskId "project123" `
    -LogFile "C:\custom\path\generation.log"
```

---

## 🌐 SOLUTION 2: WebSocket Real-time Progress (ADVANCED) ⭐⭐⭐

**Cách hoạt động:**
- Connect tới WebSocket server: `wss://genaipro.vn/ws?token=YOUR_API_KEY`
- Nhận real-time updates: `{ type: "labs_status_updated", payload: { task_id, process_percentage } }`
- Show progress bar real-time
- Notification khi 100%

**Usage:**
```powershell
# Set API key (1 lần)
$env:GENAIPRO_API_KEY = "your_api_key_here"

# Monitor specific task
.\notify-websocket.ps1 -TaskId "00000000-0000-0000-0000-000000000000"

# Output:
# 🔌 Connecting to WebSocket...
# ✅ WebSocket connected!
#
# 👀 Monitoring task: 00000000-0000-0000-0000-000000000000
# ⏳ Waiting for updates...
#
# [████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 35% - Task: 0000...
# [████████████████████████████░░░░░░░░░░░░░░░░░░] 65% - Task: 0000...
# [██████████████████████████████████████████████] 100% - Task: 0000...
#
# ✅ VOICE GENERATION COMPLETE!
# 📁 Task ID: 00000000-0000-0000-0000-000000000000
# ⏱️  Duration: 923 seconds
```

**Features:**
- ✅ **Real-time progress bar** (updates as generation progresses)
- ✅ WebSocket connection với auto-reconnect
- ✅ Multi-task monitoring (monitor tất cả tasks nếu không chỉ định TaskId)
- ✅ Completion notification + beeps
- ✅ JSON message parsing

**Configuration:**
```powershell
# Monitor all tasks (không filter)
.\notify-websocket.ps1

# Custom WebSocket URL
.\notify-websocket.ps1 -WebSocketUrl "wss://your-custom-ws.com/ws"

# Use API key from parameter (không dùng env var)
.\notify-websocket.ps1 -ApiKey "your_key" -TaskId "task_id"
```

**WebSocket Message Format:**
```json
{
  "type": "labs_status_updated",
  "payload": {
    "task_id": "00000000-0000-0000-0000-000000000000",
    "process_percentage": 75
  }
}
```

---

## 💻 SOLUTION 3: Process Monitor (SIMPLE) ⭐

**Cách hoạt động:**
- Monitor Node.js process (by PID hoặc name)
- Track CPU, RAM usage real-time
- Notify khi process kết thúc

**Usage:**
```powershell
# Start voice generation và lấy PID
node test_local_voice.js &
# → PID: 12345

# Monitor process (PowerShell window khác)
.\monitor-process.ps1 -ProcessId 12345

# Hoặc tự động detect
.\monitor-process.ps1

# Output:
# 📋 Found 3 Node.js process(es):
#    [12345] node - CPU: 45.2s, Memory: 512MB
#    [12346] node - CPU: 2.1s, Memory: 128MB
#    [12347] node - CPU: 0.5s, Memory: 64MB
#
# Enter Process ID to monitor: 12345
#
# 👀 Monitoring process: [12345] node
# ⏳ Started: 14:30:45
#
# ⏱️  Running: 00:15:30 | CPU: 245.3s | RAM: 1024MB
#
# [When process completes]
# ✅ PROCESS COMPLETED!
# ⏱️  Total time: 932 seconds
#
# [Windows notification + beeps]
```

**Features:**
- ✅ Real-time CPU & RAM monitoring
- ✅ Auto-detect Node.js processes
- ✅ Exit code checking (0 = success, non-0 = error)
- ✅ Different notifications for success/error
- ✅ Sound alerts

**Best for:**
- Local development
- Testing scripts
- Monitoring single process

---

## 📧 SOLUTION 4: Email/Telegram Notification (PRODUCTION) ⭐⭐

**Cách hoạt động:**
- Monitor log file (giống Solution 1)
- Gửi email hoặc Telegram message khi xong
- **Best for remote work** (không cần ngồi trước máy)

**Setup Telegram (RECOMMENDED):**
```powershell
# 1. Tạo Telegram Bot (talk to @BotFather)
#    /newbot
#    Bot name: Voice Generation Notifier
#    Username: your_voice_bot
#    → Nhận: Bot Token

# 2. Lấy Chat ID
#    - Start chat với bot của bạn
#    - Truy cập: https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
#    → Nhận: Chat ID

# 3. Set environment variables
$env:TELEGRAM_BOT_TOKEN = "123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
$env:TELEGRAM_CHAT_ID = "987654321"

# 4. Run monitor
.\notify-email.ps1 -TaskId "project123"

# → Nhận Telegram message khi xong!
```

**Setup Email (Gmail):**
```powershell
# 1. Enable Gmail App Password
#    - Go to: https://myaccount.google.com/apppasswords
#    - Generate app password

# 2. Set credentials
$env:SMTP_USER = "your@gmail.com"
$env:SMTP_PASS = "your_app_password"

# 3. Run with email notification
.\notify-email.ps1 -TaskId "project123" -NotifyEmail "recipient@email.com"
```

**Telegram Message Example:**
```
🎙️ Voice Generation Complete!

📁 Task ID: project123
⏱️ Duration: 00:15:32
✅ Status: SUCCESS

Generated files:
- Audio: project_audio.mp3
- SRT: project_subtitles.srt
- Scenes: Ready for rendering
```

**Features:**
- ✅ Telegram notification (fast, free)
- ✅ Email notification (Gmail/SMTP)
- ✅ Local Windows notification backup
- ✅ Error notifications
- ✅ Detailed status messages

**Best for:**
- Remote work (nhận notification ở điện thoại)
- Production servers
- Multi-user teams

---

## 🎯 RECOMMENDATION

### **Development (local testing):**
→ **Dùng Solution #1** (notify-voice-complete.ps1)
- Setup 0 giây
- Chỉ cần chạy script
- Notification đủ dùng

### **Production (server/remote):**
→ **Dùng Solution #4** (notify-email.ps1) với Telegram
- Setup 2 phút (tạo bot)
- Nhận notification ở điện thoại
- Không cần ngồi trước máy

### **API Integration:**
→ **Dùng Solution #2** (notify-websocket.ps1)
- Real-time progress tracking
- Best cho dashboard/monitoring

---

## 📖 USAGE EXAMPLES

### **Example 1: Gen voice + Auto notification**
```powershell
# Terminal 1: Start generation với logging
node test_local_voice.js 2>&1 | Tee-Object -FilePath generation.log

# Terminal 2: Monitor & notify
.\notify-voice-complete.ps1 -TaskId "test_project"

# → Windows notification khi xong!
```

### **Example 2: Remote work với Telegram**
```powershell
# Setup Telegram (1 lần)
$env:TELEGRAM_BOT_TOKEN = "your_token"
$env:TELEGRAM_CHAT_ID = "your_chat_id"

# Start generation + monitor
node test_local_voice.js > generation.log 2>&1
.\notify-email.ps1 -TaskId "project123"

# → Đi làm việc khác
# → Nhận Telegram notification khi xong
# → Check lại kết quả
```

### **Example 3: WebSocket real-time tracking**
```powershell
# Set API key
$env:GENAIPRO_API_KEY = "your_api_key"

# Start WebSocket monitor
.\notify-websocket.ps1 -TaskId "task_id_from_api"

# → See real-time progress bar
# → Notification at 100%
```

---

## 🔧 TROUBLESHOOTING

### **"Execution policy" error:**
```powershell
# Fix: Set execution policy
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### **Notification không hiện:**
```powershell
# Check Windows notification settings
# Settings → System → Notifications & actions
# → Enable notifications for PowerShell
```

### **Telegram không nhận message:**
```powershell
# Verify credentials
$token = $env:TELEGRAM_BOT_TOKEN
$chatId = $env:TELEGRAM_CHAT_ID

# Test manual send
Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/sendMessage" `
    -Method Post `
    -Body (@{chat_id=$chatId; text="Test"} | ConvertTo-Json) `
    -ContentType "application/json"
```

---

## ✅ SUMMARY

**4 PowerShell notification solutions:**

1. **notify-voice-complete.ps1** - Windows toast, simple, local
2. **notify-websocket.ps1** - Real-time WebSocket progress
3. **monitor-process.ps1** - Process monitoring, CPU/RAM stats
4. **notify-email.ps1** - Email/Telegram, remote work

**Best for most users: Solution #1 (local) + Solution #4 (remote)**

**→ Không bao giờ bỏ lỡ khi voice generation xong! 🔔**
