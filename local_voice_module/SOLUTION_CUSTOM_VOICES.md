# 🎙️ GIẢI PHÁP: SỬ DỤNG 1-3 GIỌNG CÓ SẴN

**Tình huống:** Bạn có 1-3 giọng đã record sẵn, muốn dùng chính giọng đó (KHÔNG dùng Edge)

**Mục tiêu:** Tự nhiên nhất, giống người thật, tích hợp vào hệ thống

---

## 🎯 3 GIẢI PHÁP

### **GIẢI PHÁP 1: XTTS v2 - Reference Audio (ĐƠN GIẢN NHẤT)** ⭐

**Setup:**
```bash
# 1. Chuẩn bị 3 giọng (mỗi giọng 10s audio)
mkdir -p local_voice_module/voices

# Voice 1: Giọng nam chính (ví dụ: CEO, host)
# Ghi âm/cắt 10s tiếng Đức, rõ ràng
cp your_voice1.wav local_voice_module/voices/voice_male_main.wav

# Voice 2: Giọng nữ phụ
cp your_voice2.wav local_voice_module/voices/voice_female_alt.wav

# Voice 3: Giọng nam phụ (optional)
cp your_voice3.wav local_voice_module/voices/voice_male_alt.wav
```

**Sử dụng:**
```javascript
// Trong analyze.js
const voiceGen = new LocalVoiceGenerator({
    ttsEngine: 'xtts',
    language: 'de',
    voiceId: path.join(__dirname, 'local_voice_module/voices/voice_male_main.wav')
});

// Hoặc đổi giọng:
// voiceId: path.join(__dirname, 'local_voice_module/voices/voice_female_alt.wav')
```

**Hiệu suất:**
- First run: ~20s load model + ~20 phút gen = **~20-25 phút**
- Cached: ~1s load model + ~15-20 phút gen = **~15-20 phút**
- Quality: **10/10** (tự nhiên nhất, giữ emotion)

**Ưu điểm:**
- ✅ Cực đơn giản: Chỉ cần 3 file WAV
- ✅ Quality tốt nhất: 10/10
- ✅ Đổi giọng dễ: Chỉ đổi path
- ✅ No training needed

**Nhược điểm:**
- ⏱️ Chậm: 15-20 phút/video
- 💻 VRAM: 4-5GB (GTX 1060 tight)

---

### **GIẢI PHÁP 2: Pre-compute Speaker Embeddings (NHANH HƠN)** ⭐⭐

**Ý tưởng:**
- Clone 3 giọng 1 lần → Lưu speaker embeddings
- Lần sau load embedding → Skip clone step
- **Nhanh hơn 30-40%**

**Setup:**
```bash
# 1. Generate speaker embeddings (1 lần duy nhất)
cd local_voice_module/scripts

python generate_embeddings.py \
  --voice voices/voice_male_main.wav \
  --output embeddings/male_main.pth

python generate_embeddings.py \
  --voice voices/voice_female_alt.wav \
  --output embeddings/female_alt.pth

python generate_embeddings.py \
  --voice voices/voice_male_alt.wav \
  --output embeddings/male_alt.pth

# Output: 3 embedding files (~50KB each)
```

**Sử dụng:**
```javascript
const voiceGen = new LocalVoiceGenerator({
    ttsEngine: 'xtts-cached',  // New mode
    language: 'de',
    voiceId: 'male_main'  // Embedding name
});
```

**Hiệu suất:**
- First embedding gen: ~30s/voice (1 lần duy nhất)
- Generation: ~1s load + **~10-12 phút** gen = **10-15 phút** ✨
- Quality: **10/10** (giống Solution 1)

**Ưu điểm:**
- ✅ **Nhanh hơn 30-40%** (10-15 phút thay vì 20 phút)
- ✅ Quality vẫn 10/10
- ✅ Embedding nhỏ (50KB) → Dễ quản lý
- ✅ Đổi giọng cực nhanh

**Nhược điểm:**
- 🔧 Cần script mới để gen embeddings
- 🔧 Cần modify xtts_tts.py

---

### **GIẢI PHÁP 3: Coqui TTS Multi-Speaker (NHANH NHẤT)** ⭐⭐⭐

**Ý tưởng:**
- Fine-tune Coqui TTS model với 3 giọng
- Training 1 lần (~2-4 giờ)
- Inference cực nhanh (~2-5 phút cho 10 phút audio)

**Setup (1 lần):**
```bash
# 1. Chuẩn bị training data
# Mỗi giọng cần: 20-30 phút audio + transcript

# Voice 1: 30 phút audio của giọng 1
voices/voice1/
  ├── audio1.wav  (+ audio1.txt transcript)
  ├── audio2.wav  (+ audio2.txt transcript)
  └── ... 20-30 files

# 2. Fine-tune model
python scripts/train_multispeaker.py \
  --voices voices/ \
  --output models/custom_german_voices.pth \
  --epochs 1000

# Training: ~2-4 giờ trên GTX 1060
```

**Sử dụng:**
```javascript
const voiceGen = new LocalVoiceGenerator({
    ttsEngine: 'coqui-custom',
    language: 'de',
    voiceId: 'speaker_1'  // Chọn 1 trong 3 speakers
});
```

**Hiệu suất:**
- Training: **1 lần 2-4 giờ** (setup)
- Generation: **2-5 phút** cho 10 phút audio ⚡⚡⚡
- Quality: **9/10** (hơi kém XTTS một chút)

**Ưu điểm:**
- ✅ **CỰC NHANH: 2-5 phút** (nhanh gấp 4-6x XTTS!)
- ✅ Quality tốt: 9/10
- ✅ VRAM thấp: 2-3GB
- ✅ Đổi giọng instant

**Nhược điểm:**
- 🔥 Cần training 2-4 giờ (1 lần)
- 📦 Cần 20-30 phút audio/giọng + transcripts
- 🔧 Setup phức tạp hơn

---

## 📊 SO SÁNH 3 GIẢI PHÁP

| Tiêu chí | Sol 1: XTTS Ref | Sol 2: XTTS Cached | Sol 3: Fine-tune |
|----------|-----------------|-------------------|------------------|
| **Setup time** | 5 phút | 10 phút | **2-4 giờ** |
| **Data needed** | 10s audio/voice | 10s audio/voice | **30min audio/voice** |
| **Gen speed** | 15-20 phút | **10-15 phút** | **2-5 phút** ⚡ |
| **Quality** | 10/10 | 10/10 | 9/10 |
| **VRAM** | 4-5GB | 4-5GB | 2-3GB |
| **Complexity** | ⭐ Dễ | ⭐⭐ Trung bình | ⭐⭐⭐ Khó |
| **Best for** | Quick setup | Balanced | Production scale |

---

## 🎯 ĐỀ XUẤT THEO TÌNH HUỐNG

### **Nếu bạn có: 3 file audio 10s**
→ **Dùng GIẢI PHÁP 1** (XTTS Reference Audio)
- Setup 5 phút
- Quality 10/10
- Chấp nhận 15-20 phút/video

### **Nếu bạn muốn: Nhanh hơn một chút**
→ **Dùng GIẢI PHÁP 2** (XTTS Cached Embeddings)
- Setup 10 phút
- Quality 10/10
- Gen 10-15 phút/video (nhanh hơn 30%)

### **Nếu bạn có: 30 phút audio/giọng + transcripts + thời gian setup**
→ **Dùng GIẢI PHÁP 3** (Fine-tune Coqui)
- Training 2-4 giờ (1 lần)
- Quality 9/10
- Gen **2-5 phút/video** (cực nhanh!)
- **Best cho production scale** (nhiều videos/ngày)

---

## 🔧 IMPLEMENTATION CHI TIẾT

### **GIẢI PHÁP 1: XTTS Reference Audio (RECOMMENDED)**

**Step 1: Chuẩn bị voices**
```bash
# Tạo folder voices
mkdir -p local_voice_module/voices

# Copy 3 giọng của bạn
# Yêu cầu: 10s, WAV/MP3, 16kHz+, rõ ràng, tiếng Đức

cp /path/to/your/voice1.wav local_voice_module/voices/speaker1.wav
cp /path/to/your/voice2.wav local_voice_module/voices/speaker2.wav
cp /path/to/your/voice3.wav local_voice_module/voices/speaker3.wav
```

**Step 2: Test từng giọng**
```bash
cd local_voice_module/scripts

# Test giọng 1
python xtts_tts.py \
  --text "Dies ist ein Test mit der ersten Stimme" \
  --reference ../voices/speaker1.wav \
  --output test_speaker1.wav \
  --language de

# Nghe test_speaker1.wav → Verify quality
# Repeat cho speaker2, speaker3
```

**Step 3: Tích hợp vào pipeline**
```javascript
// analyze.js
const voicePath = {
    'speaker1': path.join(__dirname, 'local_voice_module/voices/speaker1.wav'),
    'speaker2': path.join(__dirname, 'local_voice_module/voices/speaker2.wav'),
    'speaker3': path.join(__dirname, 'local_voice_module/voices/speaker3.wav')
};

// Chọn giọng theo project/niche
const selectedVoice = projectConfig.voice || 'speaker1';

const voiceGen = new LocalVoiceGenerator({
    ttsEngine: 'xtts',
    language: 'de',
    voiceId: voicePath[selectedVoice]
});

const result = await voiceGen.process(script, projectId, outputDir);
```

**Step 4: Optimize performance**
```javascript
// Cache XTTS model globally để không load lại mỗi lần
global.xttsModel = global.xttsModel || null;

// Modify xtts_tts.py để reuse model
```

---

### **YÊU CẦU AUDIO SAMPLE (Quan trọng!)**

Để quality tốt nhất, audio sample phải:

✅ **Duration:** 8-12 giây (optimal: 10s)
✅ **Format:** WAV 24kHz mono (hoặc MP3 → convert sang WAV)
✅ **Quality:** Rõ ràng, ít noise (< 10% background noise)
✅ **Content:**
   - 1 người nói duy nhất
   - Đủ đa dạng âm (a, e, i, o, u, ch, sch, st, etc.)
   - Có emotion tự nhiên
✅ **Language:** Tiếng Đức (matching với output)
✅ **Recording:** Microphone tốt > smartphone > video extract

**Example audio mẫu tốt:**
```
"Hallo, mein Name ist Max Schmidt. Ich bin Psychologe und arbeite
seit zehn Jahren in diesem Bereich. Heute möchte ich über ein
wichtiges Thema sprechen."

(~10 seconds, diverse sounds, natural emotion)
```

**Preprocessing audio (optional nhưng recommended):**
```bash
# Convert sang WAV 24kHz mono
ffmpeg -i input.mp3 -ar 24000 -ac 1 -sample_fmt s16 output.wav

# Noise reduction (nếu có noise)
ffmpeg -i noisy.wav -af "highpass=f=200,lowpass=f=3000" clean.wav

# Normalize volume
ffmpeg -i input.wav -af "loudnorm=I=-16:TP=-1.5:LRA=11" normalized.wav
```

---

## ⚡ OPTIMIZE SPEED

### **Trick 1: Model caching**
```python
# Trong xtts_tts.py
# Global model cache
_cached_model = None

def load_model():
    global _cached_model
    if _cached_model is None:
        _cached_model = TTS("xtts_v2").to("cuda")
    return _cached_model

# Lần đầu: 20s load
# Lần sau: 0s (reuse)
```

### **Trick 2: Batch processing**
```javascript
// Nếu có nhiều videos cùng lúc
// Process parallel trên nhiều GPUs hoặc queue
const queue = [video1, video2, video3];
await Promise.all(queue.map(v => generateVoice(v)));
```

### **Trick 3: Pre-generate overnight**
```bash
# Gen voice cho 10 videos vào ban đêm
for script in scripts/*.txt; do
    python xtts_tts.py --reference voice1.wav --text "$(cat $script)" --output ${script%.txt}.wav
done

# Sáng dùng audio có sẵn
```

---

## 🎯 KẾT LUẬN & RECOMMENDATION

**Tình huống của bạn:**
- ✅ Có 1-3 giọng sẵn
- ✅ Muốn tự nhiên nhất
- ✅ Tích hợp vào hệ thống

**→ DÙNG GIẢI PHÁP 1 (XTTS Reference Audio)**

**Lý do:**
1. **Setup cực đơn giản:** 5 phút copy 3 files
2. **Quality tốt nhất:** 10/10, giống người thật
3. **No training:** Không cần data lớn
4. **Flexible:** Đổi giọng chỉ cần đổi path
5. **Trade-off chấp nhận được:** 15-20 phút OK cho quality 10/10

**Sau này nếu scale lớn:**
→ Upgrade lên **Giải pháp 3** (Fine-tune) cho speed 2-5 phút

**Muốn tôi implement Giải pháp 1 ngay không?** 🚀
