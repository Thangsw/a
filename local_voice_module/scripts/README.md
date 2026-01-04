# Python Scripts for Local Voice Generation

This directory contains Python scripts for TTS and SRT generation.

## Installation

```bash
pip install -r requirements.txt
```

## Scripts

### 1. `edge_tts.py` - Microsoft Edge TTS (RECOMMENDED)

Generate high-quality speech audio using Microsoft's free cloud TTS.

**Usage:**
```bash
python edge_tts.py \
  --text "Your text here" \
  --output audio.mp3 \
  --voice de-DE-ConradNeural \
  --rate +0% \
  --pitch +0Hz
```

**Available German Voices:**
- `de-DE-ConradNeural` (Male, deep, authoritative)
- `de-DE-KatjaNeural` (Female, warm, clear)
- `de-DE-AmalaNeural` (Female, young, energetic)

**See all voices:**
```bash
python -m edge_tts --list-voices | grep de-DE
```

---

### 2. `whisper_srt.py` - Faster-Whisper SRT Generator

Generate SRT subtitles from audio using optimized Whisper model.

**Usage:**
```bash
python whisper_srt.py \
  --audio input.mp3 \
  --output subtitles.srt \
  --model medium \
  --language de
```

**Available Models:**
- `tiny` - Fastest, 75MB VRAM, 85% accuracy
- `base` - Fast, 140MB VRAM, 88% accuracy
- `small` - Balanced, 480MB VRAM, 92% accuracy
- `medium` - **Recommended**, 1.5GB VRAM, 95% accuracy
- `large-v2` - Best, 3GB VRAM, 98% accuracy

**Performance on GTX 1060 6GB:**
- `medium` model: ~4-8x faster than realtime
- 30s audio → ~3-5s processing time

---

## Testing

Test individual scripts:

```bash
# Test Edge TTS
python edge_tts.py \
  --text "Dies ist ein Test" \
  --output test_audio.mp3 \
  --voice de-DE-ConradNeural

# Test Whisper SRT
python whisper_srt.py \
  --audio test_audio.mp3 \
  --output test.srt \
  --model medium \
  --language de
```

Or use the Node.js test suite:
```bash
node test_local_voice.js
```

---

## Troubleshooting

**CUDA not found:**
- Scripts will automatically fallback to CPU
- CPU performance is still good (2-4x realtime for Whisper)

**Edge TTS connection errors:**
- Check internet connection
- Verify no firewall blocking

**Whisper model download slow:**
- Models are downloaded automatically on first run
- Stored in `~/.cache/huggingface/`
