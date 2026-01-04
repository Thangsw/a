#!/usr/bin/env python3
"""
XTTS v2 Voice Cloning TTS Generator
Clone ANY voice from just 6 seconds of reference audio!

Features:
- Voice cloning from reference audio (WAV/MP3)
- Multi-speaker support (17 languages including German)
- Emotion & intonation preservation
- High quality output (comparable to professional TTS)

Requirements:
    pip install TTS torch torchaudio

Hardware:
    - GPU: 4-5GB VRAM (GTX 1060 6GB is OK but tight)
    - CPU: Fallback available but slow
"""

import argparse
import sys
import os
import torch
from TTS.api import TTS

def generate_xtts(text, reference_audio, output_path, language='de'):
    """
    Generate TTS using XTTS v2 with voice cloning

    Args:
        text: Text to convert to speech
        reference_audio: Path to reference audio (6+ seconds WAV/MP3)
        output_path: Output audio file path
        language: Language code (de, en, es, fr, etc.)
    """
    try:
        print(f"🎙️ XTTS v2 Voice Cloning Starting...")
        print(f"   Language: {language}")
        print(f"   Reference audio: {reference_audio}")
        print(f"   Text length: {len(text)} characters")

        # Check CUDA availability
        device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"   Device: {device.upper()}")

        if device == "cpu":
            print("⚠️ WARNING: Running on CPU will be VERY slow!")
            print("   Recommended: Use GPU with 4-5GB VRAM")

        # Initialize XTTS v2 model
        print("Loading XTTS v2 model (first run: ~2GB download)...")
        tts = TTS(model_name="tts_models/multilingual/multi-dataset/xtts_v2")
        tts.to(device)

        # Verify reference audio exists
        if not os.path.exists(reference_audio):
            raise FileNotFoundError(f"Reference audio not found: {reference_audio}")

        # Get reference audio info
        ref_size = os.path.getsize(reference_audio) / 1024  # KB
        print(f"   Reference audio size: {ref_size:.1f} KB")

        # Generate audio with voice cloning
        print("Generating audio with cloned voice...")
        print("This may take ~60-120s for 30s of output audio...")

        tts.tts_to_file(
            text=text,
            speaker_wav=reference_audio,  # Reference audio for cloning
            language=language,
            file_path=output_path
        )

        # Get output duration
        try:
            from pydub import AudioSegment
            audio = AudioSegment.from_file(output_path)
            duration = len(audio) / 1000.0
        except ImportError:
            # Estimate duration
            word_count = len(text.split())
            duration = (word_count / 150) * 60
            print(f"⚠️ pydub not installed, estimated duration: {duration:.1f}s")

        output_size = os.path.getsize(output_path) / 1024  # KB

        print(f"Duration: {duration:.2f}")
        print(f"File size: {output_size:.1f} KB")
        print(f"SUCCESS: Voice cloned audio saved to {output_path}")
        return 0

    except Exception as e:
        print(f"ERROR: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return 1

def main():
    parser = argparse.ArgumentParser(
        description='Generate TTS with voice cloning using XTTS v2',
        epilog='''
Examples:
  # Clone voice from reference audio
  python xtts_tts.py --text "Hallo, das ist ein Test" --reference voice_sample.wav --output output.wav --language de

  # Use longer text
  python xtts_tts.py --text "$(cat script.txt)" --reference my_voice.mp3 --output cloned_audio.wav --language de
        '''
    )
    parser.add_argument('--text', required=True, help='Text to convert to speech')
    parser.add_argument('--reference', required=True, help='Reference audio for voice cloning (6+ seconds WAV/MP3)')
    parser.add_argument('--output', required=True, help='Output audio file path (.wav recommended)')
    parser.add_argument('--language', default='de', help='Language code (de/en/es/fr/it/pt/pl/tr/ru/nl/cs/ar/zh-cn/ja/ko/hu)')

    args = parser.parse_args()

    exit_code = generate_xtts(
        args.text,
        args.reference,
        args.output,
        args.language
    )

    sys.exit(exit_code)

if __name__ == '__main__':
    main()
