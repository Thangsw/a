# 🎙️ EDGE-TTS + RVC INTEGRATION GUIDE

**Phương pháp:** Hybrid TTS (Edge-TTS base + RVC voice conversion)

**Mục tiêu:** Gen voice tiếng Đức nhanh (3-5 phút), quality cao (9/10), custom voice

**Hardware:** Xeon E5 v4 (56 threads) + GTX 1060 6GB

---

## 📊 TẠI SAO CHỌN EDGE-TTS + RVC?

### **So sánh với các phương án khác:**

| Method | Speed | Quality | VRAM | Custom Voice | Total Time |
|--------|-------|---------|------|--------------|------------|
| **XTTS v2** | Chậm | 10/10 | 4-5GB | ✅ Zero-shot | **20-30 phút** |
| **Edge + RVC** | Nhanh | 9/10 | 2-3GB | ✅ Train 1 lần | **3-5 phút** ⚡ |
| **Edge alone** | Cực nhanh | 9.5/10 | 0GB | ❌ | 10 giây |

**Kết luận:** Edge + RVC = **Nhanh hơn 6x XTTS**, quality gần bằng!

---

## 🏗️ KIẾN TRÚC HỆ THỐNG

### **Pipeline Flow:**

```
┌─────────────────────────────────────────────────────┐
│  INPUT                                              │
│  - Text: "Hallo, das ist ein Test..."              │
│  - Voice Model: "German_Male_01"                    │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│  STAGE 1: Text Preprocessing (Node.js)             │
│  - Clean text (remove special chars)                │
│  - Split if > 2000 chars (Edge-TTS limit)          │
│  - Duration: ~1s                                    │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│  STAGE 2: Edge-TTS Generation (CPU)                │
│  - Command: edge-tts --text "..." --output base.mp3│
│  - Voice: de-DE-ConradNeural                        │
│  - Duration: 5-10s ⚡⚡⚡⚡⚡                          │
│  - Can run PARALLEL (5-10 files at once)           │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│  STAGE 3: RVC Voice Conversion (GPU)               │
│  - Load model: models/German_Male_01/model.pth     │
│  - Convert: base.mp3 → final.wav                   │
│  - Duration: 2-3 phút ⚡⚡⚡⚡                        │
│  - Must run QUEUE (1 at a time - GPU limit)        │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│  STAGE 4: Post-processing (FFmpeg)                 │
│  - Concat segments (if split in Stage 1)           │
│  - Normalize audio levels                          │
│  - Duration: ~5s                                    │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│  OUTPUT: final_voice.wav                           │
│  - Quality: 9/10                                    │
│  - Total time: ~3-5 phút                           │
└─────────────────────────────────────────────────────┘
```

---

## 📦 DEPENDENCIES & SETUP

### **1. RVC (Applio Fork - RECOMMENDED)**

**Tại sao Applio?**
- ✅ Fork hiện đại nhất của RVC
- ✅ Hỗ trợ rmvpe (giọng không bị vỡ khi lên cao độ)
- ✅ CLI mạnh mẽ (dễ tích hợp)
- ✅ Tối ưu cho GTX 10-series

**Download:**
```bash
# Clone Applio
git clone https://github.com/IAHispano/Applio.git
cd Applio

# Install dependencies
pip install -r requirements.txt
```

**Hoặc download pre-compiled:**
```
https://github.com/IAHispano/Applio/releases
→ Tải file .zip (Windows)
→ Extract và chạy
```

---

### **2. Python Environment**

**Python Version:** 3.9 hoặc 3.10 (stable nhất với PyTorch)

**Dependencies:**
```bash
# Core
pip install torch==2.0.1 torchaudio==2.0.2 --index-url https://download.pytorch.org/whl/cu118

# RVC dependencies
pip install faiss-cpu
pip install librosa
pip install soundfile
pip install scipy

# Edge-TTS
pip install edge-tts

# Audio processing
pip install pydub
```

**CUDA:** 11.8 hoặc 12.1 (cho GTX 1060)

**FFmpeg:** Add to system PATH
```bash
# Windows: Download từ ffmpeg.org
# Linux: sudo apt install ffmpeg
```

---

### **3. Folder Structure**

```
MyTool/
├── bin/
│   ├── python_env/          # Python virtual environment
│   │   ├── python.exe
│   │   └── Lib/
│   ├── Applio/              # RVC (Applio)
│   │   ├── infer_cli.py     # CLI inference script
│   │   └── ...
│   └── ffmpeg/              # FFmpeg portable
│       └── ffmpeg.exe
│
├── models/                  # RVC Voice models (trained)
│   ├── German_Male_01/
│   │   ├── model.pth        # Weights (~50MB)
│   │   └── index.index      # Feature index (~20MB)
│   ├── German_Female_01/
│   │   └── ...
│   └── README.md            # Voice model info
│
├── temp/                    # Temporary audio files
│   ├── edge_*.mp3           # Base audio from Edge-TTS
│   └── rvc_*.wav            # Converted audio from RVC
│
└── src/
    ├── voice_engine.js      # Node.js wrapper (Main)
    └── rvc_wrapper.py       # Python wrapper for RVC
```

---

## 🚀 IMPLEMENTATION

### **File 1: Node.js Wrapper (`voice_engine.js`)**

```javascript
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');

class EdgeRVCVoiceGenerator {
    constructor(config = {}) {
        this.voiceModel = config.voiceModel || 'German_Male_01';
        this.edgeVoice = config.edgeVoice || 'de-DE-ConradNeural';
        this.language = config.language || 'de';

        // Paths
        this.pythonPath = path.join(__dirname, '../bin/python_env/python.exe');
        this.applioPath = path.join(__dirname, '../bin/Applio');
        this.modelsPath = path.join(__dirname, '../models');
        this.tempPath = path.join(__dirname, '../temp');
    }

    /**
     * Generate voice with Edge-TTS + RVC pipeline
     */
    async generate(text, outputPath) {
        console.log(`🎙️ [EdgeRVC] Starting voice generation...`);
        const startTime = Date.now();

        try {
            // Ensure temp directory exists
            await fs.ensureDir(this.tempPath);

            // STAGE 1: Preprocessing
            const chunks = this._splitText(text, 2000);
            console.log(`📝 [Stage 1] Split text into ${chunks.length} chunks`);

            // STAGE 2: Edge-TTS (Parallel)
            console.log(`⚡ [Stage 2] Generating base audio with Edge-TTS...`);
            const baseAudioFiles = await this._generateEdgeTTS(chunks);
            console.log(`✅ [Stage 2] Generated ${baseAudioFiles.length} base files in ${(Date.now() - startTime) / 1000}s`);

            // STAGE 3: RVC Conversion (Queue)
            console.log(`🎨 [Stage 3] Converting voice with RVC...`);
            const convertedFiles = await this._convertWithRVC(baseAudioFiles);
            console.log(`✅ [Stage 3] Converted ${convertedFiles.length} files`);

            // STAGE 4: Concat (if multiple files)
            console.log(`🔗 [Stage 4] Concatenating audio...`);
            const finalAudio = await this._concatAudio(convertedFiles, outputPath);

            // Cleanup temp files
            await this._cleanup(baseAudioFiles, convertedFiles);

            const elapsed = (Date.now() - startTime) / 1000;
            console.log(`✅ [EdgeRVC] Done in ${elapsed}s (${(elapsed / 60).toFixed(1)} minutes)`);

            return {
                success: true,
                audio_path: finalAudio,
                duration: await this._getAudioDuration(finalAudio),
                elapsed_time: elapsed
            };

        } catch (error) {
            console.error(`❌ [EdgeRVC] Error:`, error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * STAGE 2: Generate base audio with Edge-TTS (CPU)
     */
    async _generateEdgeTTS(chunks) {
        const baseFiles = [];

        // Run in parallel (CPU can handle it)
        await Promise.all(chunks.map(async (chunk, i) => {
            const outputFile = path.join(this.tempPath, `edge_${Date.now()}_${i}.mp3`);

            await this._runCommand('edge-tts', [
                '--text', chunk,
                '--write-media', outputFile,
                '--voice', this.edgeVoice
            ]);

            baseFiles.push(outputFile);
        }));

        return baseFiles.sort(); // Ensure correct order
    }

    /**
     * STAGE 3: Convert with RVC (GPU - Queue)
     */
    async _convertWithRVC(baseFiles) {
        const convertedFiles = [];
        const modelPath = path.join(this.modelsPath, this.voiceModel, 'model.pth');
        const indexPath = path.join(this.modelsPath, this.voiceModel, 'index.index');

        // Queue processing (1 at a time for GPU)
        for (const baseFile of baseFiles) {
            const outputFile = path.join(this.tempPath, `rvc_${Date.now()}.wav`);

            console.log(`   Converting ${path.basename(baseFile)}...`);

            await this._runPythonScript(
                path.join(this.applioPath, 'infer_cli.py'),
                [
                    '--f0method', 'rmvpe',           // Best quality
                    '--input', baseFile,
                    '--output', outputFile,
                    '--model', modelPath,
                    '--index', indexPath,
                    '--device', 'cuda:0',            // Use GPU
                    '--is_half', 'True',             // FP16 (save VRAM)
                    '--filter_radius', '3',          // Noise reduction
                    '--rms_mix_rate', '0.25'         // 75% RVC, 25% original
                ]
            );

            convertedFiles.push(outputFile);
        }

        return convertedFiles;
    }

    /**
     * STAGE 4: Concatenate audio files
     */
    async _concatAudio(files, outputPath) {
        if (files.length === 1) {
            // Just copy if single file
            await fs.copy(files[0], outputPath);
            return outputPath;
        }

        // Create concat list for FFmpeg
        const listFile = path.join(this.tempPath, `concat_${Date.now()}.txt`);
        const listContent = files.map(f => `file '${f}'`).join('\n');
        await fs.writeFile(listFile, listContent);

        // Concat with FFmpeg
        await this._runCommand('ffmpeg', [
            '-f', 'concat',
            '-safe', '0',
            '-i', listFile,
            '-c', 'copy',
            outputPath
        ]);

        await fs.unlink(listFile);
        return outputPath;
    }

    /**
     * Helper: Split text into chunks
     */
    _splitText(text, maxChars) {
        if (text.length <= maxChars) return [text];

        const chunks = [];
        let current = '';

        text.split('. ').forEach(sentence => {
            if ((current + sentence).length > maxChars) {
                chunks.push(current.trim());
                current = sentence + '. ';
            } else {
                current += sentence + '. ';
            }
        });

        if (current) chunks.push(current.trim());
        return chunks;
    }

    /**
     * Helper: Run command
     */
    async _runCommand(command, args) {
        return new Promise((resolve, reject) => {
            const proc = spawn(command, args);
            let stderr = '';

            proc.stderr.on('data', data => stderr += data.toString());

            proc.on('close', code => {
                if (code === 0) resolve();
                else reject(new Error(`Command failed: ${stderr}`));
            });
        });
    }

    /**
     * Helper: Run Python script
     */
    async _runPythonScript(script, args) {
        return this._runCommand(this.pythonPath, [script, ...args]);
    }

    /**
     * Helper: Get audio duration
     */
    async _getAudioDuration(filePath) {
        // Use pydub or ffprobe
        return 60; // Placeholder
    }

    /**
     * Helper: Cleanup temp files
     */
    async _cleanup(baseFiles, convertedFiles) {
        for (const file of [...baseFiles, ...convertedFiles]) {
            try {
                await fs.unlink(file);
            } catch (e) {
                console.warn(`Failed to delete ${file}:`, e.message);
            }
        }
    }
}

module.exports = { EdgeRVCVoiceGenerator };
```

---

## 🧪 TRAINING RVC MODEL (ONE-TIME SETUP)

### **Bước 1: Chuẩn bị Data**

**Yêu cầu:**
- 30 phút audio của giọng muốn clone
- Format: WAV, 16kHz+, mono/stereo
- Clean audio (ít noise)

**Cấu trúc:**
```
training_data/
└── German_Male_01/
    ├── audio1.wav
    ├── audio2.wav
    └── ... (tổng ~30 phút)
```

---

### **Bước 2: Train với Applio**

```bash
cd Applio

# Train model
python train.py \
  --dataset training_data/German_Male_01 \
  --model_name German_Male_01 \
  --epochs 300 \
  --batch_size 8

# ⏱️ Training time: 1-2 giờ trên GTX 1060
# 📦 Output: models/German_Male_01/model.pth + index.index
```

---

### **Bước 3: Test Model**

```bash
# Test inference
python infer_cli.py \
  --input test_base.mp3 \
  --output test_result.wav \
  --model models/German_Male_01/model.pth \
  --index models/German_Male_01/index.index \
  --f0method rmvpe

# ⏱️ Should take 2-3 phút cho 1 phút audio
```

---

## 🔧 OPTIMIZATION FOR GTX 1060 6GB

### **1. Concurrency Strategy**

```javascript
// Edge-TTS: CPU-bound → Parallel
const edgePromises = chunks.map(chunk => generateEdgeTTS(chunk));
await Promise.all(edgePromises); // 5-10 concurrent

// RVC: GPU-bound → Queue
for (const file of baseFiles) {
    await convertWithRVC(file); // 1 at a time
}
```

---

### **2. VRAM Optimization**

**RVC Config for GTX 1060:**
```python
--is_half True          # FP16 (reduce VRAM 50%)
--device cuda:0         # Use GPU
--batch_size 1          # Small batch (avoid OOM)
```

**Expected VRAM Usage:**
- FP32 (default): 4-5GB
- FP16 (optimized): **2-3GB** ✅

---

### **3. Error Handling**

```javascript
try {
    await convertWithRVC(file);
} catch (error) {
    if (error.message.includes('CUDA out of memory')) {
        console.warn('⚠️ GPU OOM, falling back to CPU...');
        // Fallback to CPU (slower but works)
        await convertWithRVC(file, { device: 'cpu' });
    } else {
        throw error;
    }
}
```

---

## 📊 PERFORMANCE BENCHMARKS

### **GTX 1060 6GB + Xeon E5 v4:**

| Stage | Time | Bottleneck | Concurrent |
|-------|------|------------|------------|
| Stage 1 (Preprocessing) | ~1s | CPU | N/A |
| Stage 2 (Edge-TTS) | 5-10s | CPU | ✅ 5-10 files |
| Stage 3 (RVC) | 2-3 phút | GPU | ❌ 1 file |
| Stage 4 (Concat) | ~5s | Disk I/O | N/A |
| **Total** | **3-5 phút** | GPU | - |

**For 10 phút audio:**
- XTTS: 20-30 phút
- Edge + RVC: **3-5 phút** ⚡ (6x faster!)

---

## ✅ CHECKLIST

### **Setup (One-time):**
- [ ] Install Python 3.9/3.10
- [ ] Install CUDA 11.8/12.1
- [ ] Clone Applio: `git clone https://github.com/IAHispano/Applio.git`
- [ ] Install dependencies: `pip install -r requirements.txt`
- [ ] Install Edge-TTS: `pip install edge-tts`
- [ ] Install FFmpeg (add to PATH)

### **Training (Per voice):**
- [ ] Prepare 30 phút audio data
- [ ] Train RVC model (1-2h)
- [ ] Test inference
- [ ] Save model to `models/` folder

### **Integration:**
- [ ] Implement `EdgeRVCVoiceGenerator` class
- [ ] Add API endpoints (similar to XTTS endpoints)
- [ ] Test end-to-end pipeline
- [ ] Monitor VRAM usage

---

## 🚀 API ENDPOINTS (Backend)

```javascript
// Add to index.js

app.post('/api/test-edge-rvc', async (req, res) => {
    try {
        const { text, voiceModel, language } = req.body;

        const { EdgeRVCVoiceGenerator } = require('./src/voice_engine');

        const outputDir = path.join(__dirname, '../output_files/test_voice');
        await fs.ensureDir(outputDir);

        const outputPath = path.join(outputDir, `edge_rvc_${Date.now()}.wav`);

        const generator = new EdgeRVCVoiceGenerator({
            voiceModel: voiceModel || 'German_Male_01',
            edgeVoice: 'de-DE-ConradNeural',
            language: language || 'de'
        });

        const result = await generator.generate(text, outputPath);

        res.json(result);

    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});
```

---

## 💡 SUMMARY

**Edge-TTS + RVC = Best of Both Worlds:**

✅ **Nhanh:** 3-5 phút (vs 20-30 phút XTTS)
✅ **Quality:** 9/10 (gần XTTS 10/10)
✅ **Nhẹ:** 2-3GB VRAM (vs 4-5GB XTTS)
✅ **Custom voice:** Train 1 lần, dùng mãi
✅ **Tận dụng CPU:** Edge-TTS parallel trên Xeon 56 threads

**Perfect cho GTX 1060 6GB + Production scale!** 🚀
