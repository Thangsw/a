#!/usr/bin/env python3
"""
Voice Sample Preparation Tool
Validates and preprocesses audio samples for XTTS v2 voice cloning

Usage:
    python prepare_voice.py --input your_voice.mp3 --output voices/speaker1.wav --validate
"""

import argparse
import os
import sys

def validate_audio(audio_path):
    """Validate audio quality for voice cloning"""
    try:
        from pydub import AudioSegment
        from pydub.silence import detect_nonsilent
    except ImportError:
        print("ERROR: pydub not installed. Run: pip install pydub")
        return False

    print(f"📊 Validating: {audio_path}")

    try:
        audio = AudioSegment.from_file(audio_path)

        # Get audio properties
        duration = len(audio) / 1000.0  # seconds
        channels = audio.channels
        sample_rate = audio.frame_rate

        print(f"   Duration: {duration:.1f}s")
        print(f"   Sample rate: {sample_rate}Hz")
        print(f"   Channels: {channels} ({'mono' if channels == 1 else 'stereo'})")

        # Validation checks
        checks = []

        # 1. Duration check
        if duration < 6:
            checks.append(f"❌ Too short: {duration:.1f}s (need 6-12s)")
        elif duration < 8:
            checks.append(f"⚠️  Short: {duration:.1f}s (optimal: 8-12s)")
        elif duration > 15:
            checks.append(f"⚠️  Long: {duration:.1f}s (will be trimmed to 12s)")
        else:
            checks.append(f"✅ Duration OK: {duration:.1f}s")

        # 2. Sample rate check
        if sample_rate < 16000:
            checks.append(f"❌ Low sample rate: {sample_rate}Hz (need 16kHz+)")
        elif sample_rate < 24000:
            checks.append(f"⚠️  Low sample rate: {sample_rate}Hz (optimal: 24kHz+)")
        else:
            checks.append(f"✅ Sample rate OK: {sample_rate}Hz")

        # 3. Detect speech vs silence ratio
        nonsilent_ranges = detect_nonsilent(
            audio,
            min_silence_len=500,
            silence_thresh=-40
        )

        if nonsilent_ranges:
            speech_duration = sum((end - start) for start, end in nonsilent_ranges) / 1000.0
            speech_ratio = speech_duration / duration

            if speech_ratio < 0.5:
                checks.append(f"❌ Too much silence: {speech_ratio*100:.0f}% speech (need 70%+)")
            elif speech_ratio < 0.7:
                checks.append(f"⚠️  Some silence: {speech_ratio*100:.0f}% speech (optimal: 80%+)")
            else:
                checks.append(f"✅ Speech ratio OK: {speech_ratio*100:.0f}%")

        # Print all checks
        print("\n📋 Validation Results:")
        for check in checks:
            print(f"   {check}")

        # Determine if valid
        has_error = any('❌' in check for check in checks)

        if has_error:
            print("\n❌ VALIDATION FAILED - Audio needs improvement")
            return False
        else:
            print("\n✅ VALIDATION PASSED - Audio is good for voice cloning")
            return True

    except Exception as e:
        print(f"ERROR: {str(e)}")
        return False

def preprocess_audio(input_path, output_path, target_duration=10):
    """
    Preprocess audio for optimal voice cloning
    - Convert to WAV
    - Resample to 24kHz mono
    - Trim/extend to target duration
    - Normalize volume
    """
    try:
        from pydub import AudioSegment
        from pydub.effects import normalize
    except ImportError:
        print("ERROR: pydub not installed. Run: pip install pydub")
        return False

    print(f"🔧 Preprocessing: {input_path}")

    try:
        # Load audio
        audio = AudioSegment.from_file(input_path)
        original_duration = len(audio) / 1000.0

        # Convert to mono
        if audio.channels > 1:
            print("   Converting to mono...")
            audio = audio.set_channels(1)

        # Resample to 24kHz
        if audio.frame_rate != 24000:
            print(f"   Resampling from {audio.frame_rate}Hz to 24000Hz...")
            audio = audio.set_frame_rate(24000)

        # Trim or extend to target duration
        target_ms = target_duration * 1000
        current_ms = len(audio)

        if current_ms > target_ms + 1000:  # More than 1s longer
            print(f"   Trimming from {original_duration:.1f}s to {target_duration}s...")
            audio = audio[:target_ms]
        elif current_ms < target_ms - 1000:  # More than 1s shorter
            print(f"   ⚠️  Short audio ({original_duration:.1f}s), keeping original duration")

        # Normalize volume
        print("   Normalizing volume...")
        audio = normalize(audio)

        # Ensure output directory exists
        os.makedirs(os.path.dirname(output_path) if os.path.dirname(output_path) else '.', exist_ok=True)

        # Export as WAV
        print(f"   Exporting to {output_path}...")
        audio.export(
            output_path,
            format="wav",
            parameters=["-ar", "24000", "-ac", "1"]
        )

        final_size = os.path.getsize(output_path) / 1024  # KB
        print(f"\n✅ Preprocessing complete!")
        print(f"   Output: {output_path}")
        print(f"   Size: {final_size:.1f} KB")
        print(f"   Duration: {len(audio)/1000:.1f}s")

        return True

    except Exception as e:
        print(f"ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def main():
    parser = argparse.ArgumentParser(
        description='Prepare voice samples for XTTS v2 cloning',
        epilog='''
Examples:
  # Validate audio quality
  python prepare_voice.py --input voice.mp3 --validate

  # Preprocess and save
  python prepare_voice.py --input voice.mp3 --output voices/speaker1.wav

  # Preprocess with custom duration
  python prepare_voice.py --input voice.mp3 --output voices/speaker1.wav --duration 12

  # Validate after processing
  python prepare_voice.py --input voice.mp3 --output voices/speaker1.wav --validate
        '''
    )

    parser.add_argument('--input', required=True, help='Input audio file (MP3/WAV/M4A)')
    parser.add_argument('--output', help='Output WAV file path')
    parser.add_argument('--duration', type=float, default=10, help='Target duration in seconds (default: 10)')
    parser.add_argument('--validate', action='store_true', help='Validate audio quality')

    args = parser.parse_args()

    # Check input exists
    if not os.path.exists(args.input):
        print(f"ERROR: Input file not found: {args.input}")
        sys.exit(1)

    # Validate if requested
    if args.validate:
        valid = validate_audio(args.input)
        if not valid:
            print("\n💡 TIP: Improve audio by:")
            print("   1. Record in quiet environment")
            print("   2. Speak clearly for 8-12 seconds")
            print("   3. Use good microphone")
            print("   4. Minimize background noise")

    # Preprocess if output specified
    if args.output:
        success = preprocess_audio(args.input, args.output, args.duration)

        # Validate output if requested
        if success and args.validate:
            print("\n" + "="*60)
            print("Validating processed audio:")
            print("="*60)
            validate_audio(args.output)

        sys.exit(0 if success else 1)
    elif not args.validate:
        print("\nNo --output specified. Use --output to preprocess audio.")
        print("Or use --validate to check quality only.")
        sys.exit(1)

if __name__ == '__main__':
    main()
