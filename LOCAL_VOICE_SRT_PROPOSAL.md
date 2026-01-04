# 🎙️ LOCAL VOICE + SRT GENERATION - TECHNICAL PROPOSAL

**Ngày:** 03/01/2026
**Hardware:** Xeon E5-2680 v4 x2 (56 cores) + GTX 1060 6GB + 98GB RAM
**Mục tiêu:** Gen voice local + Auto SRT generation

---

## 🎯 3 PHƯƠNG ÁN TRIỂN KHAI

### **OPTION 1: LIGHTWEIGHT & FAST (Recommended for Production)**

**TTS Engine: Piper TTS**
- **Tech:** Microsoft's neural TTS (ONNX Runtime)
- **Speed:** ~2-5x realtime trên CPU
- **Quality:** 8/10 (natural, rõ ràng)
- **Languages:** 40+ ngôn ngữ (German, English, Vietnamese...)
- **VRAM:** 0 GB (chỉ CPU)
- **Voices:** 200+ pre-trained voices

**SRT Generation: Faster-Whisper**
- **Tech:** Optimized Whisper (CTranslate2)
- **Speed:** 4-8x faster than OpenAI Whisper
- **Accuracy:** 95%+ word accuracy
- **Model:** medium.en (1.5GB VRAM)
- **Features:** Word-level timestamps, auto-punctuation

**Pros:**
- ✅ Setup đơn giản (pip install)
- ✅ Chạy ổn định, ít crash
- ✅ CPU + GPU balanced
- ✅ Production-ready ngay

**Cons:**
- ❌ Voice quality không bằng XTTS
- ❌ Không có voice cloning
- ❌ Ít customization

**Estimated Performance:**
- Voice gen: ~30s audio/5s processing
- SRT gen: ~30s audio/3s processing
- **Total:** ~8s cho 30s audio

---

### **OPTION 2: HIGH QUALITY (Best Quality)**

**TTS Engine: Coqui XTTS v2**
- **Tech:** Deep learning multi-speaker TTS
- **Speed:** ~0.5x realtime (chậm hơn)
- **Quality:** 10/10 (cực tự nhiên, emotion)
- **Languages:** 17 ngôn ngữ
- **VRAM:** 4-5 GB
- **Features:** Voice cloning từ 6s sample!

**SRT Generation: WhisperX**
- **Tech:** Whisper + forced alignment
- **Speed:** 2-4x faster than vanilla Whisper
- **Accuracy:** 98%+ với word timestamps
- **Model:** medium (1.5GB VRAM)
- **Features:** Speaker diarization, precise timing

**Pros:**
- ✅ Quality cao nhất
- ✅ Voice cloning (clone giọng từ sample)
- ✅ Word-level timestamps chính xác
- ✅ Emotion & intonation tốt

**Cons:**
- ❌ Chậm (30s audio = ~60s processing)
- ❌ Setup phức tạp (nhiều dependencies)
- ❌ VRAM limit (6GB là sát nút)
- ❌ Có thể OOM với long text

**Estimated Performance:**
- Voice gen: ~30s audio/60s processing
- SRT gen: ~30s audio/10s processing
- **Total:** ~70s cho 30s audio

---

### **OPTION 3: HYBRID (Balanced) ⭐ RECOMMENDED**

**TTS Engine: Edge TTS (Microsoft Cloud via Local API)**
- **Tech:** Microsoft Edge's cloud TTS
- **Speed:** ~10x realtime (cực nhanh)
- **Quality:** 9/10 (rất tự nhiên)
- **Languages:** 100+ ngôn ngữ
- **VRAM:** 0 GB (cloud-based)
- **Voices:** 400+ neural voices (miễn phí!)

**SRT Generation: Faster-Whisper**
- **Tech:** Optimized Whisper (CTranslate2)
- **Speed:** 4-8x faster
- **Accuracy:** 95%+
- **Model:** medium (1.5GB VRAM) hoặc large-v2 (3GB VRAM)
- **Features:** Word-level timestamps

**Pros:**
- ✅ Voice quality cực cao (Microsoft Neural)
- ✅ Cực nhanh (cloud TTS)
- ✅ Miễn phí, unlimited
- ✅ 400+ giọng nói chất lượng cao
- ✅ Không tốn VRAM cho TTS

**Cons:**
- ⚠️ Cần internet (nhưng user đang dùng Gemini API rồi nên OK)
- ❌ Không offline hoàn toàn
- ❌ Phụ thuộc Microsoft service

**Estimated Performance:**
- Voice gen: ~30s audio/1-2s processing (cloud)
- SRT gen: ~30s audio/3s processing
- **Total:** ~5s cho 30s audio ⚡

---

## 🔧 IMPLEMENTATION DETAILS

### **Architecture Design**

```
┌─────────────────────────────────────────────────────────┐
│                   SCRIPT GENERATOR                       │
│              (Existing - generates text)                 │
└────────────────────┬────────────────────────────────────┘
                     │ text content
                     ▼
┌─────────────────────────────────────────────────────────┐
│              LOCAL VOICE GENERATOR                       │
│  (NEW MODULE - localVoiceGenerator.js)                  │
│                                                          │
│  STEP 1: Text → Audio                                   │
│    - Input: Script text (1500 words)                    │
│    - Process: TTS engine (Piper/XTTS/Edge)              │
│    - Output: audio.mp3                                  │
│                                                          │
│  STEP 2: Audio → SRT                                    │
│    - Input: audio.mp3                                   │
│    - Process: Faster-Whisper transcription              │
│    - Output: subtitles.srt                              │
│                                                          │
│  STEP 3: Scene Mapping                                  │
│    - Parse SRT timestamps                               │
│    - Group into scenes (using existing srt_parser.js)   │
│    - Map to image prompts                               │
└────────────────────┬────────────────────────────────────┘
                     │ {audio, srt, mapping}
                     ▼
┌─────────────────────────────────────────────────────────┐
│                  VIDEO RENDERER                          │
│         (Existing - editorRoutes.js render)              │
│              Creates final video                         │
└─────────────────────────────────────────────────────────┘
```

---

## 📦 DEPENDENCIES & INSTALLATION

### **Option 1: Piper + Faster-Whisper**

```bash
# Install Python dependencies
pip install piper-tts==1.2.0
pip install faster-whisper==1.0.0

# Download Piper voice models
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx.json

# Download Whisper model (auto-downloaded on first run)
# medium.en = 1.5GB
```

**Disk Space:**
- Piper voice: ~100MB per voice
- Whisper medium: 1.5GB
- **Total:** ~2GB

---

### **Option 3: Edge TTS + Faster-Whisper** ⭐

```bash
# Install Python dependencies
pip install edge-tts==6.1.9
pip install faster-whisper==1.0.0

# No model downloads needed for TTS (cloud-based)
# Whisper model auto-downloads on first run
```

**Disk Space:**
- Whisper medium: 1.5GB
- **Total:** ~1.5GB

---

## 💻 CODE STRUCTURE

### **File: `localVoiceGenerator.js`**

```javascript
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const { log } = require('./colors');

/**
 * Local Voice + SRT Generator Module
 * Generates voice audio and SRT subtitles from text
 */

class LocalVoiceGenerator {
    constructor(config = {}) {
        this.ttsEngine = config.ttsEngine || 'edge-tts'; // 'piper', 'xtts', 'edge-tts'
        this.whisperModel = config.whisperModel || 'medium';
        this.language = config.language || 'de';
        this.voiceId = config.voiceId || 'de-DE-ConradNeural';
    }

    /**
     * STEP 1: Generate audio from text using TTS
     */
    async generateAudio(text, outputPath) {
        log.info(`🎙️ [LocalVoice] Generating audio with ${this.ttsEngine}...`);

        switch (this.ttsEngine) {
            case 'edge-tts':
                return await this._edgeTTS(text, outputPath);
            case 'piper':
                return await this._piperTTS(text, outputPath);
            case 'xtts':
                return await this._xtts(text, outputPath);
            default:
                throw new Error(`Unknown TTS engine: ${this.ttsEngine}`);
        }
    }

    /**
     * STEP 2: Generate SRT from audio using Faster-Whisper
     */
    async generateSRT(audioPath, outputPath) {
        log.info(`📝 [LocalVoice] Generating SRT from audio...`);

        return new Promise((resolve, reject) => {
            const pythonScript = path.join(__dirname, 'scripts', 'whisper_srt.py');

            const process = spawn('python', [
                pythonScript,
                '--audio', audioPath,
                '--output', outputPath,
                '--model', this.whisperModel,
                '--language', this.language
            ]);

            let output = '';
            let errorOutput = '';

            process.stdout.on('data', (data) => {
                output += data.toString();
                log.info(`[Whisper] ${data.toString().trim()}`);
            });

            process.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            process.on('close', (code) => {
                if (code === 0) {
                    log.success(`✅ [LocalVoice] SRT generated: ${outputPath}`);
                    resolve({
                        success: true,
                        srt_path: outputPath,
                        output: output
                    });
                } else {
                    reject(new Error(`Whisper failed: ${errorOutput}`));
                }
            });
        });
    }

    /**
     * STEP 3: Full pipeline - Text to Audio + SRT
     */
    async process(text, projectId, outputDir) {
        const audioPath = path.join(outputDir, `${projectId}_audio.mp3`);
        const srtPath = path.join(outputDir, `${projectId}_subtitles.srt`);

        // Step 1: Generate audio
        const audioResult = await this.generateAudio(text, audioPath);

        // Step 2: Generate SRT
        const srtResult = await this.generateSRT(audioPath, srtPath);

        // Step 3: Parse SRT for scene mapping
        const srtParser = require('./srt_parser');
        const srtContent = await fs.readFile(srtPath, 'utf-8');
        const visualSpecs = srtParser.calculateVisualSpecsFromSRT(
            srtPath,
            audioResult.duration,
            8,  // scene duration
            'N+1'
        );

        return {
            success: true,
            audio_path: audioPath,
            audio_duration: audioResult.duration,
            srt_path: srtPath,
            visual_specs: visualSpecs,
            scene_mapping: visualSpecs.scenes || []
        };
    }

    // ===== TTS ENGINE IMPLEMENTATIONS =====

    async _edgeTTS(text, outputPath) {
        return new Promise((resolve, reject) => {
            const pythonScript = path.join(__dirname, 'scripts', 'edge_tts.py');

            const process = spawn('python', [
                pythonScript,
                '--text', text,
                '--output', outputPath,
                '--voice', this.voiceId,
                '--rate', '+0%',
                '--pitch', '+0Hz'
            ]);

            let duration = 0;

            process.stdout.on('data', (data) => {
                const output = data.toString();
                log.info(`[Edge-TTS] ${output.trim()}`);

                // Parse duration from output
                const match = output.match(/Duration: ([\d.]+)/);
                if (match) duration = parseFloat(match[1]);
            });

            process.on('close', (code) => {
                if (code === 0) {
                    log.success(`✅ [Edge-TTS] Audio generated: ${outputPath}`);
                    resolve({ success: true, audio_path: outputPath, duration });
                } else {
                    reject(new Error('Edge-TTS failed'));
                }
            });
        });
    }

    async _piperTTS(text, outputPath) {
        // Implementation for Piper TTS
        // Similar structure to Edge-TTS
    }

    async _xtts(text, outputPath) {
        // Implementation for Coqui XTTS v2
        // Similar structure to Edge-TTS
    }
}

module.exports = { LocalVoiceGenerator };
```

---

### **File: `scripts/edge_tts.py`**

```python
#!/usr/bin/env python3
"""
Edge TTS Generator
Uses Microsoft Edge's cloud TTS service
"""

import asyncio
import argparse
import edge_tts
from pydub import AudioSegment
import sys

async def generate_tts(text, voice, rate, pitch, output_path):
    """Generate TTS using Edge TTS"""
    try:
        # Create TTS communicator
        communicate = edge_tts.Communicate(
            text=text,
            voice=voice,
            rate=rate,
            pitch=pitch
        )

        # Save audio
        await communicate.save(output_path)

        # Get audio duration
        audio = AudioSegment.from_file(output_path)
        duration = len(audio) / 1000.0  # Convert to seconds

        print(f"Duration: {duration}")
        print(f"SUCCESS: Audio saved to {output_path}")
        return 0

    except Exception as e:
        print(f"ERROR: {str(e)}", file=sys.stderr)
        return 1

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--text', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--voice', default='de-DE-ConradNeural')
    parser.add_argument('--rate', default='+0%')
    parser.add_argument('--pitch', default='+0Hz')
    args = parser.parse_args()

    # Run async function
    exit_code = asyncio.run(generate_tts(
        args.text,
        args.voice,
        args.rate,
        args.pitch,
        args.output
    ))

    sys.exit(exit_code)

if __name__ == '__main__':
    main()
```

---

### **File: `scripts/whisper_srt.py`**

```python
#!/usr/bin/env python3
"""
Faster-Whisper SRT Generator
Generates SRT subtitles from audio
"""

import argparse
import sys
from faster_whisper import WhisperModel

def format_timestamp(seconds):
    """Convert seconds to SRT timestamp format"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

def generate_srt(audio_path, output_path, model_size, language):
    """Generate SRT file from audio"""
    try:
        print(f"Loading Whisper model: {model_size}")

        # Initialize model with GPU
        model = WhisperModel(
            model_size,
            device="cuda",  # Use GPU
            compute_type="float16"  # FP16 for GTX 1060
        )

        print(f"Transcribing audio: {audio_path}")

        # Transcribe with word timestamps
        segments, info = model.transcribe(
            audio_path,
            language=language,
            word_timestamps=True,
            vad_filter=True,  # Voice activity detection
            vad_parameters=dict(min_silence_duration_ms=500)
        )

        print(f"Detected language: {info.language} (probability: {info.language_probability:.2f})")

        # Write SRT file
        with open(output_path, 'w', encoding='utf-8') as f:
            for i, segment in enumerate(segments, start=1):
                start_time = format_timestamp(segment.start)
                end_time = format_timestamp(segment.end)
                text = segment.text.strip()

                f.write(f"{i}\n")
                f.write(f"{start_time} --> {end_time}\n")
                f.write(f"{text}\n\n")

                print(f"[{start_time} --> {end_time}] {text}")

        print(f"SUCCESS: SRT saved to {output_path}")
        return 0

    except Exception as e:
        print(f"ERROR: {str(e)}", file=sys.stderr)
        return 1

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--audio', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--model', default='medium')
    parser.add_argument('--language', default='de')
    args = parser.parse_args()

    exit_code = generate_srt(
        args.audio,
        args.output,
        args.model,
        args.language
    )

    sys.exit(exit_code)

if __name__ == '__main__':
    main()
```

---

## 🔄 INTEGRATION WITH EXISTING PIPELINE

### **Update: `analyze.js`**

```javascript
// Add after scriptAssembler
const { LocalVoiceGenerator } = require('./localVoiceGenerator');

// In runDownstreamPipeline(), after Step 5 (Assembly):
log.info("🎙️ [SHU Step 6] Generating Voice + SRT with Local TTS...");

const voiceGen = new LocalVoiceGenerator({
    ttsEngine: 'edge-tts',
    whisperModel: 'medium',
    language: niche.endsWith('_de') ? 'de' : 'en',
    voiceId: niche.endsWith('_de') ? 'de-DE-ConradNeural' : 'en-US-GuyNeural'
});

const voiceResult = await voiceGen.process(
    finalResult.full_script,
    projectId,
    outputDir
);

finalResult = { ...finalResult, ...voiceResult };
```

---

## 📊 PERFORMANCE COMPARISON

| Engine | Speed | Quality | VRAM | Pros | Cons |
|--------|-------|---------|------|------|------|
| **Edge-TTS** | ⚡⚡⚡⚡⚡ | 9/10 | 0 GB | Free, fast, 400+ voices | Needs internet |
| **Piper** | ⚡⚡⚡⚡ | 8/10 | 0 GB | Offline, stable | Fewer voices |
| **XTTS v2** | ⚡⚡ | 10/10 | 5 GB | Voice cloning, emotion | Slow, complex |

| Whisper Variant | Speed | Accuracy | VRAM |
|-----------------|-------|----------|------|
| **Faster-Whisper medium** | ⚡⚡⚡⚡ | 95% | 1.5 GB |
| **Faster-Whisper large-v2** | ⚡⚡⚡ | 98% | 3 GB |
| **WhisperX medium** | ⚡⚡⚡ | 98% | 2 GB |

---

## 🎯 RECOMMENDATION

**Best cho production:**

✅ **TTS:** Edge-TTS
- Miễn phí, cực nhanh, quality cao
- 400+ neural voices (German: Conrad, Katja, Amala...)
- Không tốn VRAM

✅ **SRT:** Faster-Whisper medium
- Balance giữa speed & accuracy
- Chạy tốt trên GTX 1060 6GB
- Word-level timestamps

**Total processing time cho 1500 từ (~10 phút audio):**
- Voice generation: ~5-10s
- SRT generation: ~15-20s
- **Total: ~30s** ⚡

---

## 📝 NEXT STEPS

1. **Install dependencies:**
   ```bash
   pip install edge-tts faster-whisper pydub
   ```

2. **Create module files:**
   - `localVoiceGenerator.js`
   - `scripts/edge_tts.py`
   - `scripts/whisper_srt.py`

3. **Test standalone:**
   ```bash
   node test_local_voice.js
   ```

4. **Integrate with pipeline:**
   - Update `analyze.js`
   - Add voice gen step after script assembly

5. **Configure voices:**
   - Test German voices: Conrad, Katja, Amala
   - Adjust rate/pitch if needed

---

**Muốn tôi implement luôn không?** 🚀
