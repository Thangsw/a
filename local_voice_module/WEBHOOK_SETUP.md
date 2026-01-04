# 🔔 WEBHOOK SETUP - Nhận thông báo từ GenAI khi voice xong

**Hướng dẫn setup webhook receiver để GenAI báo khi gen voice xong**

---

## 🎯 CÁCH HOẠT ĐỘNG

```
[GenAI API] Gen voice...
     ↓
[Voice xong] → POST webhook
     ↓
[Your PowerShell Server] Port 8080
     ↓
✅ Notification (Windows + Telegram)
📥 Auto-download file MP3
```

---

## 🚀 SETUP NHANH (3 BƯỚC)

### **Bước 1: Start Webhook Server**

```powershell
cd local_voice_module

# Start server port 8080
.\webhook-receiver.ps1 -Port 8080

# Output:
# 🔔 WEBHOOK RECEIVER FOR GENAI VOICE GENERATION
# ⚙️  Configuration:
#    Port: 8080
#    Download Path: .\downloads
#    Auto-Download: True
#
# 📍 Webhook URL: http://localhost:8080/webhook
# ✅ Server started on port 8080
# 🎯 Waiting for webhooks...
```

### **Bước 2: Expose với Ngrok (Nếu GenAI server ở ngoài)**

```bash
# Download ngrok: https://ngrok.com/download
# Run ngrok
ngrok http 8080

# Output:
# Forwarding: https://abc123.ngrok.io → http://localhost:8080
```

**→ Webhook URL:** `https://abc123.ngrok.io/webhook`

### **Bước 3: Configure trong GenAI Dashboard**

```
1. Đăng nhập GenAI dashboard (genaipro.vn)
2. Vào Settings → Webhooks
3. Add webhook URL: https://abc123.ngrok.io/webhook
4. Method: POST
5. Events: voice_generation_complete
6. Save
```

**→ Xong! GenAI sẽ POST webhook khi voice xong.**

---

## 📦 KHI NHẬN WEBHOOK

### **GenAI sẽ POST JSON:**

```json
{
  "task_id": "00000000-0000-0000-0000-000000000000",
  "status": "completed",
  "file_url": "https://genaipro.vn/files/voice_abc123.mp3",
  "duration": 612.5,
  "process_time": 923
}
```

### **PowerShell server sẽ:**

1. ✅ Parse JSON data
2. 📋 Log chi tiết (task_id, status, file_url)
3. 📥 **Auto-download** file MP3 → `downloads/`
4. 🔔 **Windows notification** (balloon tip + beep)
5. 📱 **Telegram message** (nếu configured)
6. ✅ Response 200 OK cho GenAI

### **Console Output:**

```
============================================================
📬 WEBHOOK RECEIVED
============================================================
🕐 Time: 2026-01-04 15:30:45
📍 From: 123.45.67.89

📦 Webhook Data:
{
  "task_id": "project123",
  "status": "completed",
  "file_url": "https://genaipro.vn/files/voice_abc.mp3",
  "duration": 612.5,
  "process_time": 923
}

📋 Task Details:
   Task ID: project123
   Status: completed
   File URL: https://genaipro.vn/files/voice_abc.mp3
   Duration: 612.5s
   Process Time: 923s

📥 Downloading: https://genaipro.vn/files/voice_abc.mp3
📁 Saving to: downloads\project123_20260104_153045.mp3
✅ Downloaded: 7.82 MB

✅ Telegram notification sent!
✅ Webhook processed successfully!
============================================================
```

**→ File tự động download vào `downloads/project123_20260104_153045.mp3`**

---

## 🔧 CONFIGURATION OPTIONS

### **Custom download path:**
```powershell
.\webhook-receiver.ps1 -Port 8080 -DownloadPath "D:\VoiceFiles"
```

### **Disable auto-download:**
```powershell
.\webhook-receiver.ps1 -Port 8080 -AutoDownload:$false

# → Chỉ notification, không download
```

### **Enable Telegram notifications:**
```powershell
# Setup Telegram bot (1 lần)
$env:TELEGRAM_BOT_TOKEN = "123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
$env:TELEGRAM_CHAT_ID = "987654321"

# Run server
.\webhook-receiver.ps1 -Port 8080

# → Nhận Telegram message khi có webhook!
```

### **Custom port:**
```powershell
.\webhook-receiver.ps1 -Port 5000

# → Server chạy port 5000
# → Webhook URL: http://localhost:5000/webhook
```

---

## 📱 TELEGRAM NOTIFICATION

### **Setup Telegram Bot:**

**1. Tạo bot với @BotFather:**
```
1. Mở Telegram, search: @BotFather
2. Gửi: /newbot
3. Bot name: Voice Generation Notifier
4. Username: your_voice_gen_bot
5. Nhận: Bot Token (123456789:ABC...)
```

**2. Lấy Chat ID:**
```
1. Start chat với bot của bạn (click link từ BotFather)
2. Gửi: /start
3. Truy cập: https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
4. Copy "chat":{"id":987654321}
```

**3. Set environment variables:**
```powershell
$env:TELEGRAM_BOT_TOKEN = "123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
$env:TELEGRAM_CHAT_ID = "987654321"

# Lưu vĩnh viễn (optional):
[System.Environment]::SetEnvironmentVariable("TELEGRAM_BOT_TOKEN", "123...", "User")
[System.Environment]::SetEnvironmentVariable("TELEGRAM_CHAT_ID", "987...", "User")
```

**4. Test:**
```powershell
.\webhook-receiver.ps1

# Trigger webhook từ GenAI
# → Nhận message trong Telegram!
```

### **Telegram Message Format:**

```
🎙️ Voice Generation Complete!

📁 Task ID: project123
✅ Status: completed
⏱️ Duration: 612.5s
⚙️ Process Time: 923s
💾 Downloaded: downloads\project123_20260104_153045.mp3

🔗 Download: https://genaipro.vn/files/voice_abc.mp3
```

---

## 🌐 NGROK SETUP (Expose Local Server)

### **Tại sao cần ngrok?**
- GenAI server ở ngoài internet
- Không thể POST tới `http://localhost:8080`
- Cần public URL: `https://abc123.ngrok.io`

### **Setup ngrok:**

**1. Download & Install:**
```
https://ngrok.com/download
```

**2. Run ngrok:**
```bash
ngrok http 8080

# Output:
# Session Status: online
# Forwarding: https://abc123-456-def.ngrok.io → http://localhost:8080
```

**3. Copy public URL:**
```
Webhook URL: https://abc123-456-def.ngrok.io/webhook
```

**4. Configure in GenAI:**
```
Settings → Webhooks → Add
URL: https://abc123-456-def.ngrok.io/webhook
```

**5. Test:**
```powershell
# Terminal 1: PowerShell server
.\webhook-receiver.ps1

# Terminal 2: ngrok
ngrok http 8080

# → Trigger voice gen in GenAI
# → Webhook POST → ngrok → localhost:8080 → PowerShell
# → Notification!
```

---

## 🧪 TESTING WEBHOOK

### **Test local với curl:**

```bash
# POST test webhook
curl -X POST http://localhost:8080/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "test123",
    "status": "completed",
    "file_url": "https://example.com/test.mp3",
    "duration": 100,
    "process_time": 50
  }'

# → Server nhận webhook
# → Notification hiện
# → File download (nếu URL valid)
```

### **Test với PowerShell:**

```powershell
# POST test webhook
$body = @{
    task_id = "test123"
    status = "completed"
    file_url = "https://example.com/test.mp3"
    duration = 100
    process_time = 50
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:8080/webhook" `
    -Method Post `
    -Body $body `
    -ContentType "application/json"
```

---

## 🔐 SECURITY (Production)

### **1. Add authentication:**

Modify `webhook-receiver.ps1`:

```powershell
# Add at top
$WebhookSecret = "your_secret_key_here"

# In Handle-WebhookRequest function:
$authHeader = $request.Headers["X-Webhook-Secret"]
if ($authHeader -ne $WebhookSecret) {
    Write-Host "❌ Unauthorized webhook attempt!" -ForegroundColor Red
    $response.StatusCode = 401
    $response.Close()
    return
}
```

Configure in GenAI:
```
Headers:
  X-Webhook-Secret: your_secret_key_here
```

### **2. IP whitelist:**

```powershell
# Only accept from GenAI servers
$allowedIPs = @("123.45.67.89", "123.45.67.90")
$remoteIP = $request.RemoteEndPoint.Address.ToString()

if ($remoteIP -notin $allowedIPs) {
    Write-Host "❌ Blocked IP: $remoteIP" -ForegroundColor Red
    $response.StatusCode = 403
    $response.Close()
    return
}
```

### **3. HTTPS (with ngrok):**

```bash
# Ngrok already uses HTTPS!
ngrok http 8080

# → https://abc123.ngrok.io (secure)
```

---

## 📊 MONITORING & LOGS

### **Log all webhooks:**

```powershell
# Add logging
$logFile = "webhook_log.txt"

# In Handle-WebhookRequest:
$logEntry = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') | $taskId | $status | $fileUrl"
Add-Content -Path $logFile -Value $logEntry
```

### **View logs:**

```powershell
# Tail logs real-time
Get-Content webhook_log.txt -Wait -Tail 20
```

---

## 🐛 TROUBLESHOOTING

### **Server không start:**
```
Error: Access denied

Fix:
# Run PowerShell as Administrator
# Or use different port (> 1024)
.\webhook-receiver.ps1 -Port 8080
```

### **Webhook không nhận được:**
```
1. Check server đang chạy
2. Check ngrok forwarding đúng port
3. Test với curl local
4. Check GenAI webhook config
5. Check firewall không block port 8080
```

### **Auto-download fail:**
```
# Check URL accessible
Invoke-WebRequest -Uri "https://genaipro.vn/files/voice.mp3"

# Check write permission
Test-Path -Path ".\downloads" -PathType Container
```

### **Telegram không gửi:**
```
# Verify token & chat ID
$token = $env:TELEGRAM_BOT_TOKEN
$chatId = $env:TELEGRAM_CHAT_ID

# Test manual send
Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/sendMessage" `
    -Method Post `
    -Body (@{chat_id=$chatId; text="Test"} | ConvertTo-Json) `
    -ContentType "application/json"
```

---

## ✅ WORKFLOW HOÀN CHỈNH

### **Development:**

```powershell
# 1. Start webhook server
.\webhook-receiver.ps1

# 2. Test local
curl -X POST http://localhost:8080/webhook -d '{"task_id":"test",...}'

# 3. Verify notification works
```

### **Production:**

```powershell
# Terminal 1: PowerShell webhook server
$env:TELEGRAM_BOT_TOKEN = "your_token"
$env:TELEGRAM_CHAT_ID = "your_chat_id"
.\webhook-receiver.ps1 -Port 8080 -DownloadPath "D:\VoiceFiles"

# Terminal 2: ngrok expose
ngrok http 8080

# 3. Configure GenAI webhook
#    URL: https://your-ngrok-id.ngrok.io/webhook

# 4. Trigger voice generation in GenAI

# 5. Receive notifications:
#    - Windows toast (desktop)
#    - Telegram message (phone)
#    - Auto-download to D:\VoiceFiles
```

---

## 🎯 SUMMARY

**Webhook Receiver Features:**
- ✅ HTTP server nhận webhook từ GenAI
- ✅ Auto-parse JSON payload
- ✅ Auto-download voice files
- ✅ Windows notifications
- ✅ Telegram notifications
- ✅ Detailed logging
- ✅ Error handling

**Setup Time:** 5 phút
- 2 phút: Start server + ngrok
- 3 phút: Configure GenAI webhook

**→ Không bao giờ bỏ lỡ khi voice xong!** 🔔
**→ File tự động download về máy!** 📥
**→ Nhận notification ở điện thoại!** 📱
