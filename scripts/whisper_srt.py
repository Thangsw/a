#!/usr/bin/env python3
"""
Faster-Whisper SRT Generator
Generates SRT subtitles from audio using optimized Whisper model

Uses CTranslate2 for 4-8x faster transcription than vanilla Whisper
Supports GPU acceleration on CUDA-capable devices (GTX 1060)

Requirements:
    pip install faster-whisper
"""

import argparse
import sys
import os
from faster_whisper import WhisperModel

def format_timestamp(seconds):
    """Convert seconds to SRT timestamp format (HH:MM:SS,mmm)"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

def generate_srt(audio_path, output_path, model_size, language):
    """Generate SRT file from audio using Faster-Whisper"""
    try:
        print(f"📝 Faster-Whisper Starting...")
        print(f"   Model: {model_size}")
        print(f"   Language: {language}")
        print(f"   Audio: {audio_path}")

        # Check if CUDA is available
        try:
            import torch
            device = "cuda" if torch.cuda.is_available() else "cpu"
            compute_type = "float16" if device == "cuda" else "int8"
            print(f"   Device: {device.upper()}")
        except ImportError:
            device = "cpu"
            compute_type = "int8"
            print(f"   Device: CPU (torch not available)")

        # Initialize model
        print(f"Loading Whisper model: {model_size}...")
        model = WhisperModel(
            model_size,
            device=device,
            compute_type=compute_type
        )

        print(f"Transcribing audio...")

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
        segment_count = 0
        with open(output_path, 'w', encoding='utf-8') as f:
            for segment in segments:
                segment_count += 1
                start_time = format_timestamp(segment.start)
                end_time = format_timestamp(segment.end)
                text = segment.text.strip()

                # Write SRT format
                f.write(f"{segment_count}\n")
                f.write(f"{start_time} --> {end_time}\n")
                f.write(f"{text}\n\n")

                # Log to stdout
                print(f"[{start_time} --> {end_time}] {text}")

        file_size = os.path.getsize(output_path) / 1024  # KB
        print(f"Total segments: {segment_count}")
        print(f"File size: {file_size:.1f} KB")
        print(f"SUCCESS: SRT saved to {output_path}")
        return 0

    except Exception as e:
        print(f"ERROR: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return 1

def main():
    parser = argparse.ArgumentParser(description='Generate SRT subtitles using Faster-Whisper')
    parser.add_argument('--audio', required=True, help='Input audio file path')
    parser.add_argument('--output', required=True, help='Output SRT file path')
    parser.add_argument('--model', default='medium', help='Whisper model size (tiny/base/small/medium/large-v2)')
    parser.add_argument('--language', default='de', help='Language code (de/en/etc)')
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
