#!/usr/bin/env python3
"""
Edge TTS Generator
Uses Microsoft Edge's cloud TTS service (FREE)

Supports 400+ neural voices across 100+ languages
German voices: de-DE-ConradNeural, de-DE-KatjaNeural, de-DE-AmalaNeural

Requirements:
    pip install edge-tts pydub
"""

import asyncio
import argparse
import edge_tts
import sys
import os

async def generate_tts(text, voice, rate, pitch, output_path):
    """Generate TTS using Edge TTS"""
    try:
        print(f"🎙️ Edge-TTS Starting...")
        print(f"   Voice: {voice}")
        print(f"   Rate: {rate}, Pitch: {pitch}")
        print(f"   Text length: {len(text)} characters")

        # Create TTS communicator
        communicate = edge_tts.Communicate(
            text=text,
            voice=voice,
            rate=rate,
            pitch=pitch
        )

        # Save audio
        await communicate.save(output_path)

        # Get audio duration using pydub
        try:
            from pydub import AudioSegment
            audio = AudioSegment.from_file(output_path)
            duration = len(audio) / 1000.0  # Convert to seconds
        except ImportError:
            # Fallback: estimate duration (avg speaking rate ~150 words/min)
            word_count = len(text.split())
            duration = (word_count / 150) * 60
            print(f"⚠️ pydub not installed, estimated duration: {duration:.1f}s")

        file_size = os.path.getsize(output_path) / 1024  # KB

        print(f"Duration: {duration:.2f}")
        print(f"File size: {file_size:.1f} KB")
        print(f"SUCCESS: Audio saved to {output_path}")
        return 0

    except Exception as e:
        print(f"ERROR: {str(e)}", file=sys.stderr)
        return 1

def main():
    parser = argparse.ArgumentParser(description='Generate TTS audio using Microsoft Edge')
    parser.add_argument('--text', required=True, help='Text to convert to speech')
    parser.add_argument('--output', required=True, help='Output audio file path (.mp3)')
    parser.add_argument('--voice', default='de-DE-ConradNeural', help='Voice ID (default: de-DE-ConradNeural)')
    parser.add_argument('--rate', default='+0%', help='Speech rate (e.g. +10%, -10%)')
    parser.add_argument('--pitch', default='+0Hz', help='Pitch adjustment (e.g. +5Hz, -5Hz)')
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
