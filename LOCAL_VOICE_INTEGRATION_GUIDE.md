# 🎙️ HƯỚNG DẪN TÍCH HỢP LOCAL VOICE MODULE

**Mục tiêu:** Tích hợp 2 TTS engines (Edge-TTS + XTTS v2) vào hệ thống để gen voice tiếng Đức

**Thời gian ước tính:** 2-4 giờ (backend) + 1 giờ (testing)

---

## 📋 TÓM TẮT NHANH

### **2 TTS Engines:**

| Engine | Speed | Quality | VRAM | Voice Clone | Dùng khi |
|--------|-------|---------|------|-------------|----------|
| **Edge-TTS** | 5-10s ⚡⚡⚡⚡⚡ | 9.5/10 | 0 GB | ❌ | Production, nhiều video |
| **XTTS v2** | 20-30 phút ⚡⚡ | 10/10 | 4-5 GB | ✅ 6s audio | Custom voice, branding |

### **Files cần làm:**
1. ✅ **Frontend:** `test-local-voice.html` (ĐÃ TẠO)
2. 🔧 **Backend:** Thêm 2 API endpoints vào `index.js`
3. ✅ **Module:** `local_voice_module/` (ĐÃ CÓ SẴN)

---

## 🚀 BƯỚC 1: CÀI ĐẶT DEPENDENCIES

### **Python Dependencies (Backend Server):**

```bash
cd local_voice_module/scripts

# Minimum (Edge-TTS + Whisper)
pip install edge-tts faster-whisper pydub

# Optional: XTTS v2 (nếu muốn voice cloning)
pip install TTS==0.21.0
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu118
```

**Verify:**
```bash
# Test Edge-TTS
python edge_tts.py \
  --text "Hallo, das ist ein Test" \
  --voice de-DE-ConradNeural \
  --output test.mp3

# Should output: test.mp3 (~10 giây)
```

---

## 🔧 BƯỚC 2: THÊM API ENDPOINTS (Backend)

### **File:** `index.js`

Thêm vào sau dòng 502 (sau `app.post('/api/tts-config')`):

```javascript
// ===== API: Test Edge-TTS (Local Voice) =====
app.post('/api/test-edge-tts', async (req, res) => {
    try {
        const { text, voice, language } = req.body;

        if (!text) {
            return res.json({ success: false, error: 'Missing text' });
        }

        const { LocalVoiceGenerator } = require('./local_voice_module/localVoiceGenerator');

        // Create output directory
        const outputDir = path.join(__dirname, '../output_files/test_voice');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const timestamp = Date.now();
        const audioPath = path.join(outputDir, `edge_${timestamp}.mp3`);

        // Initialize Edge-TTS generator
        const voiceGen = new LocalVoiceGenerator({
            ttsEngine: 'edge-tts',
            language: language || 'de',
            voiceId: voice || 'de-DE-ConradNeural'
        });

        console.log(`🎙️ [Edge-TTS] Generating audio...`);
        const startTime = Date.now();

        // Generate audio
        const result = await voiceGen.generateAudio(text, audioPath);

        const elapsed = (Date.now() - startTime) / 1000;
        console.log(`✅ [Edge-TTS] Generated in ${elapsed}s`);

        if (result.success) {
            res.json({
                success: true,
                audio_path: result.audio_path,
                duration: result.duration,
                elapsed_time: elapsed
            });
        } else {
            res.json({ success: false, error: result.error || 'Generation failed' });
        }

    } catch (error) {
        console.error('Edge-TTS Error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ===== API: Test XTTS v2 (Voice Cloning) =====
app.post('/api/test-xtts', upload.single('reference'), async (req, res) => {
    try {
        const { text, language } = req.body;
        const referenceFile = req.file;

        if (!text) {
            return res.json({ success: false, error: 'Missing text' });
        }

        if (!referenceFile) {
            return res.json({ success: false, error: 'Missing reference audio file' });
        }

        const { LocalVoiceGenerator } = require('./local_voice_module/localVoiceGenerator');

        // Create output directory
        const outputDir = path.join(__dirname, '../output_files/test_voice');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const timestamp = Date.now();
        const audioPath = path.join(outputDir, `xtts_${timestamp}.wav`);

        // Move reference file to temp location
        const referencePath = path.join(outputDir, `ref_${timestamp}${path.extname(referenceFile.originalname)}`);
        fs.renameSync(referenceFile.path, referencePath);

        // Initialize XTTS generator
        const voiceGen = new LocalVoiceGenerator({
            ttsEngine: 'xtts',
            language: language || 'de',
            voiceId: referencePath  // Reference audio path
        });

        console.log(`🎙️ [XTTS] Generating audio with voice cloning...`);
        console.log(`   Reference: ${referencePath}`);
        const startTime = Date.now();

        // Generate audio
        const result = await voiceGen.generateAudio(text, audioPath);

        const elapsed = (Date.now() - startTime) / 1000;
        console.log(`✅ [XTTS] Generated in ${elapsed}s (${(elapsed/60).toFixed(1)} minutes)`);

        // Cleanup reference file
        try {
            fs.unlinkSync(referencePath);
        } catch (e) {
            console.warn('Failed to cleanup reference file:', e.message);
        }

        if (result.success) {
            res.json({
                success: true,
                audio_path: result.audio_path,
                duration: result.duration,
                elapsed_time: elapsed
            });
        } else {
            res.json({ success: false, error: result.error || 'Generation failed' });
        }

    } catch (error) {
        console.error('XTTS Error:', error);
        res.json({ success: false, error: error.message });
    }
});
```

**Vị trí chèn code:** Sau dòng 502 trong `index.js`

---

## 🎨 BƯỚC 3: FRONTEND (ĐÃ CÓ SẴN)

File **`test-local-voice.html`** đã được tạo sẵn với:

✅ Giao diện so sánh Edge-TTS vs XTTS v2
✅ Input chung cho cả 2 engines
✅ Config riêng cho từng engine
✅ Hiển thị kết quả, thời gian, audio player
✅ Upload reference audio cho XTTS

**Truy cập:** `http://localhost:3006/test-local-voice.html`

---

## 🧪 BƯỚC 4: TESTING

### **Test 1: Edge-TTS (Nhanh - 10 giây)**

1. Mở `http://localhost:3006/test-local-voice.html`
2. Nhập text tiếng Đức vào ô "Nội dung test"
3. Chọn giọng Edge: `de-DE-ConradNeural`
4. Click **"⚡ Test Edge-TTS"**
5. **Kỳ vọng:** Audio được gen trong ~5-10 giây

**Debug nếu lỗi:**
```bash
# Test trực tiếp Python script
cd local_voice_module/scripts
python edge_tts.py \
  --text "Hallo Test" \
  --voice de-DE-ConradNeural \
  --output test.mp3

# Nếu lỗi "edge-tts not found":
pip install edge-tts
```

---

### **Test 2: XTTS v2 (Chậm - 20-30 phút, Cần GPU)**

⚠️ **Prerequisites:**
- GPU: 4-5GB VRAM (GTX 1060 minimum)
- Python libs: TTS, torch, torchaudio

**Steps:**

1. **Chuẩn bị reference audio** (6-10s tiếng Đức):
   - Record giọng mình nói tiếng Đức
   - Hoặc extract từ video/podcast
   - Format: WAV/MP3, mono/stereo

2. Mở `http://localhost:3006/test-local-voice.html`
3. Nhập text tiếng Đức
4. Upload reference audio (bên phải - XTTS card)
5. Click **"🎨 Test XTTS v2"**
6. **Kỳ vọng:** Audio được gen trong ~20-30 phút

**Debug nếu lỗi:**
```bash
# Test trực tiếp Python script
cd local_voice_module/scripts
python xtts_tts.py \
  --text "Hallo Test" \
  --reference /path/to/voice_sample.wav \
  --output test.wav \
  --language de

# Nếu lỗi CUDA OOM (Out of Memory):
# → Card của bạn không đủ VRAM → Dùng Edge-TTS thay thế

# Nếu lỗi "TTS not found":
pip install TTS==0.21.0
```

---

## 📊 KẾT QUẢ KỲ VỌNG

### **Edge-TTS:**
```
⏱️ Thời gian: 5-10s
📊 Duration: ~30s (tùy text length)
📁 File: edge_1234567890.mp3
Quality: 9.5/10 ⭐
```

### **XTTS v2:**
```
⏱️ Thời gian: 20-30 phút
📊 Duration: ~30s
📁 File: xtts_1234567890.wav
Quality: 10/10 ⭐⭐ (giống giọng reference!)
```

---

## 🎯 WORKFLOW THỰC TẾ

### **Scenario 1: Production (Nhiều video, cần nhanh)**

```javascript
// Dùng Edge-TTS
const voiceGen = new LocalVoiceGenerator({
    ttsEngine: 'edge-tts',
    language: 'de',
    voiceId: 'de-DE-ConradNeural'
});

const result = await voiceGen.generateAudio(scriptText, 'output.mp3');
// ⏱️ 5-10 giây → Xong!
```

---

### **Scenario 2: Custom Voice (Branding, video quan trọng)**

```javascript
// Dùng XTTS v2 với reference audio
const voiceGen = new LocalVoiceGenerator({
    ttsEngine: 'xtts',
    language: 'de',
    voiceId: '/path/to/my_german_voice.wav'  // 6-10s audio mẫu
});

const result = await voiceGen.generateAudio(scriptText, 'output.wav');
// ⏱️ 20-30 phút → Quality 10/10!
```

---

### **Scenario 3: Hybrid (Best of both worlds)**

```javascript
// Prototype/test với Edge-TTS (nhanh)
const edgeGen = new LocalVoiceGenerator({
    ttsEngine: 'edge-tts',
    voiceId: 'de-DE-ConradNeural'
});
await edgeGen.generateAudio(scriptText, 'draft.mp3');

// Final production với XTTS (quality)
const xttsGen = new LocalVoiceGenerator({
    ttsEngine: 'xtts',
    voiceId: '/path/to/brand_voice.wav'
});
await xttsGen.generateAudio(scriptText, 'final.wav');
```

---

## 🔧 TROUBLESHOOTING

### **Lỗi 1: "Python script not found"**
```bash
# Kiểm tra Python path
which python
# hoặc
which python3

# Update spawn command trong localVoiceGenerator.js nếu cần
spawn('python3', [...])  # Thay vì 'python'
```

---

### **Lỗi 2: "edge-tts module not found"**
```bash
pip install edge-tts pydub
# Hoặc dùng pip3
pip3 install edge-tts pydub
```

---

### **Lỗi 3: XTTS CUDA Out of Memory**
```
RuntimeError: CUDA out of memory
```

**Giải pháp:**
1. Đóng các app khác đang dùng GPU
2. Giảm batch size (modify `xtts_tts.py`)
3. **Hoặc dùng Edge-TTS thay thế** (0 GB VRAM)

---

### **Lỗi 4: XTTS chậm quá (>1 giờ)**
```bash
# Kiểm tra đang dùng GPU hay CPU
python -c "import torch; print(torch.cuda.is_available())"

# Nếu False → Đang dùng CPU (rất chậm!)
# → Install CUDA + PyTorch GPU version
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu118
```

---

## 📦 DEPLOYMENT CHECKLIST

### **Development Server:**
- [ ] Install Python dependencies: `pip install edge-tts faster-whisper pydub`
- [ ] Optional XTTS: `pip install TTS torch torchaudio`
- [ ] Add API endpoints vào `index.js`
- [ ] Test Edge-TTS: `http://localhost:3006/test-local-voice.html`
- [ ] Test XTTS (nếu có GPU)

### **Production Server:**
- [ ] Verify Python 3.8+ installed
- [ ] Install dependencies trong virtual env
- [ ] Test Edge-TTS trước (không cần GPU)
- [ ] Nếu có GPU: Setup CUDA, test XTTS
- [ ] Monitor VRAM usage (GTX 1060: max 5-6GB)

---

## 🎓 GIẢI THÍCH KỸ THUẬT

### **Tại sao Edge-TTS nhanh?**
- Cloud-based: Microsoft server xử lý
- Không tốn GPU local
- Optimized infrastructure

### **Tại sao XTTS chậm?**
- Local processing: GPU phải xử lý toàn bộ
- Voice cloning: Analyze reference audio → Tạo embedding → Gen audio
- Neural network inference: Compute-intensive

### **Zero-shot Voice Cloning (XTTS):**
```
Input:
  - Text: "Hallo, das ist ein Test..."
  - Reference: voice_sample.wav (10s)

Process:
  1. Analyze reference → Extract speaker embedding (30s)
  2. Load XTTS model → GPU memory (2-3s)
  3. Generate audio với embedding (15-20 phút cho 10 phút audio)

Output:
  - Cloned voice audio (giống 90% reference!)
```

---

## 💡 KHUYẾN NGHỊ

### **Cho GTX 1060 6GB + Tiếng Đức:**

1. ✅ **BẮT ĐẦU VỚI EDGE-TTS**
   - Nhanh, dễ setup, quality tốt (9.5/10)
   - Test workflow trước

2. ✅ **SAU ĐÓ TEST XTTS (optional)**
   - Nếu cần custom voice
   - Có GPU 4-5GB VRAM
   - Chấp nhận 20-30 phút/video

3. ✅ **PRODUCTION: Hybrid approach**
   - Draft/prototype: Edge-TTS (10s)
   - Final/important: XTTS (20 phút)

---

## 📝 CODE REFERENCES

### **Files quan trọng:**
```
local_voice_module/
├── localVoiceGenerator.js    # Main module (ĐÃ CÓ)
├── scripts/
│   ├── edge_tts.py           # Edge-TTS (ĐÃ CÓ)
│   ├── xtts_tts.py           # XTTS v2 (ĐÃ CÓ)
│   └── whisper_srt.py        # SRT generation (ĐÃ CÓ)
└── README.md                 # Full documentation

index.js                       # Backend API (CẦN THÊM 2 endpoints)
test-local-voice.html          # Test UI (ĐÃ TẠO)
```

---

## ✅ SUMMARY

**Để tích hợp Local Voice Module:**

1. **Install dependencies** (5 phút)
2. **Thêm 2 API endpoints** vào `index.js` (30 phút)
3. **Test Edge-TTS** (5 phút)
4. **Optional: Test XTTS** (nếu có GPU, 30 phút)

**Total time:** 1-2 giờ (không tính XTTS generation time)

**Kết quả:** Hệ thống có thể gen voice tiếng Đức với 2 options:
- ⚡ Edge-TTS: 10 giây, quality 9.5/10
- 🎨 XTTS: 20 phút, quality 10/10, custom voice

---

## 🚀 NEXT STEPS

1. Copy code từ section "BƯỚC 2" vào `index.js`
2. Restart server: `node index.js`
3. Mở `http://localhost:3006/test-local-voice.html`
4. Test Edge-TTS → Xem có gen được audio không
5. (Optional) Test XTTS nếu có GPU

**Questions?** Ping me! 🎙️
