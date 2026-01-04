const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const { log } = require('./colors');

/**
 * Local Voice + SRT Generator Module
 * Generates voice audio and SRT subtitles from text
 *
 * Supports 3 TTS engines:
 * - edge-tts: Microsoft Edge cloud TTS (RECOMMENDED)
 * - piper: Microsoft neural TTS via ONNX (offline)
 * - xtts: Coqui XTTS v2 with voice cloning (high quality)
 */

class LocalVoiceGenerator {
    constructor(config = {}) {
        this.ttsEngine = config.ttsEngine || 'edge-tts';
        this.whisperModel = config.whisperModel || 'medium';
        this.language = config.language || 'de';
        this.voiceId = config.voiceId || 'de-DE-ConradNeural';
        this.rate = config.rate || '+0%';
        this.pitch = config.pitch || '+0Hz';
    }

    /**
     * STEP 1: Generate audio from text using TTS
     * @param {string} text - Script text to convert to speech
     * @param {string} outputPath - Path to save audio file (.mp3)
     * @returns {Promise<{success: boolean, audio_path: string, duration: number}>}
     */
    async generateAudio(text, outputPath) {
        log.info(`🎙️ [LocalVoice] Generating audio with ${this.ttsEngine}...`);

        // Ensure output directory exists
        await fs.ensureDir(path.dirname(outputPath));

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
     * @param {string} audioPath - Path to audio file
     * @param {string} outputPath - Path to save SRT file
     * @returns {Promise<{success: boolean, srt_path: string, segments: number}>}
     */
    async generateSRT(audioPath, outputPath) {
        log.info(`📝 [LocalVoice] Generating SRT from audio with Whisper ${this.whisperModel}...`);

        // Ensure output directory exists
        await fs.ensureDir(path.dirname(outputPath));

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
            let segmentCount = 0;

            process.stdout.on('data', (data) => {
                const text = data.toString();
                output += text;

                // Count segments
                if (text.includes('-->')) segmentCount++;

                log.info(`[Whisper] ${text.trim()}`);
            });

            process.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            process.on('close', (code) => {
                if (code === 0) {
                    log.success(`✅ [LocalVoice] SRT generated: ${outputPath} (${segmentCount} segments)`);
                    resolve({
                        success: true,
                        srt_path: outputPath,
                        segments: segmentCount,
                        output: output
                    });
                } else {
                    reject(new Error(`Whisper failed with code ${code}: ${errorOutput}`));
                }
            });
        });
    }

    /**
     * STEP 3: Full pipeline - Text to Audio + SRT
     * @param {string} text - Script text
     * @param {string} projectId - Project ID for file naming
     * @param {string} outputDir - Output directory
     * @returns {Promise<{success: boolean, audio_path: string, srt_path: string, visual_specs: object}>}
     */
    async process(text, projectId, outputDir) {
        log.info(`🎬 [LocalVoice] Starting full pipeline for project ${projectId}...`);

        const audioPath = path.join(outputDir, `${projectId}_audio.mp3`);
        const srtPath = path.join(outputDir, `${projectId}_subtitles.srt`);

        try {
            // Step 1: Generate audio
            log.info(`[LocalVoice] Step 1/3: Text → Audio`);
            const audioResult = await this.generateAudio(text, audioPath);

            // Step 2: Generate SRT
            log.info(`[LocalVoice] Step 2/3: Audio → SRT`);
            const srtResult = await this.generateSRT(audioPath, srtPath);

            // Step 3: Parse SRT for scene mapping
            log.info(`[LocalVoice] Step 3/3: SRT → Scene Mapping`);
            const srtParser = require('./srt_parser');
            const visualSpecs = srtParser.calculateVisualSpecsFromSRT(
                srtPath,
                audioResult.duration,
                8,  // scene duration (8 seconds per scene)
                'N+1'  // scene strategy
            );

            log.success(`✅ [LocalVoice] Pipeline complete! Audio: ${audioResult.duration}s, Scenes: ${visualSpecs.num_scenes}`);

            return {
                success: true,
                audio_path: audioPath,
                audio_duration: audioResult.duration,
                srt_path: srtPath,
                srt_segments: srtResult.segments,
                visual_specs: visualSpecs,
                scene_mapping: visualSpecs.scenes || []
            };
        } catch (err) {
            log.error(`❌ [LocalVoice] Pipeline failed: ${err.message}`);
            throw err;
        }
    }

    // ===== TTS ENGINE IMPLEMENTATIONS =====

    /**
     * Edge TTS - Microsoft Cloud TTS (RECOMMENDED)
     * Pros: Free, fast (10x realtime), 400+ voices, high quality
     * Cons: Requires internet
     */
    async _edgeTTS(text, outputPath) {
        return new Promise((resolve, reject) => {
            const pythonScript = path.join(__dirname, 'scripts', 'edge_tts.py');

            const process = spawn('python', [
                pythonScript,
                '--text', text,
                '--output', outputPath,
                '--voice', this.voiceId,
                '--rate', this.rate,
                '--pitch', this.pitch
            ]);

            let duration = 0;
            let errorOutput = '';

            process.stdout.on('data', (data) => {
                const output = data.toString();
                log.info(`[Edge-TTS] ${output.trim()}`);

                // Parse duration from output
                const match = output.match(/Duration: ([\d.]+)/);
                if (match) duration = parseFloat(match[1]);
            });

            process.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            process.on('close', (code) => {
                if (code === 0) {
                    log.success(`✅ [Edge-TTS] Audio generated: ${outputPath} (${duration.toFixed(1)}s)`);
                    resolve({
                        success: true,
                        audio_path: outputPath,
                        duration,
                        engine: 'edge-tts'
                    });
                } else {
                    reject(new Error(`Edge-TTS failed with code ${code}: ${errorOutput}`));
                }
            });
        });
    }

    /**
     * Piper TTS - Offline neural TTS via ONNX
     * Pros: Offline, CPU-only, stable
     * Cons: Fewer voices, requires model downloads
     */
    async _piperTTS(text, outputPath) {
        return new Promise((resolve, reject) => {
            const pythonScript = path.join(__dirname, 'scripts', 'piper_tts.py');

            // For German: de_DE-thorsten-medium
            const modelPath = path.join(__dirname, 'models', 'piper', `${this.language}_${this.voiceId}.onnx`);

            const process = spawn('python', [
                pythonScript,
                '--text', text,
                '--output', outputPath,
                '--model', modelPath,
                '--language', this.language
            ]);

            let duration = 0;
            let errorOutput = '';

            process.stdout.on('data', (data) => {
                const output = data.toString();
                log.info(`[Piper-TTS] ${output.trim()}`);

                const match = output.match(/Duration: ([\d.]+)/);
                if (match) duration = parseFloat(match[1]);
            });

            process.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            process.on('close', (code) => {
                if (code === 0) {
                    log.success(`✅ [Piper-TTS] Audio generated: ${outputPath} (${duration.toFixed(1)}s)`);
                    resolve({
                        success: true,
                        audio_path: outputPath,
                        duration,
                        engine: 'piper'
                    });
                } else {
                    reject(new Error(`Piper-TTS failed with code ${code}: ${errorOutput}`));
                }
            });
        });
    }

    /**
     * XTTS v2 - Coqui high-quality TTS with voice cloning
     * Pros: Best quality, voice cloning, emotion
     * Cons: Slow (0.5x realtime), requires GPU, 5GB VRAM
     */
    async _xtts(text, outputPath) {
        return new Promise((resolve, reject) => {
            const pythonScript = path.join(__dirname, 'scripts', 'xtts_tts.py');

            const process = spawn('python', [
                pythonScript,
                '--text', text,
                '--output', outputPath,
                '--language', this.language,
                '--speaker', this.voiceId  // Can be a speaker name or path to reference audio
            ]);

            let duration = 0;
            let errorOutput = '';

            process.stdout.on('data', (data) => {
                const output = data.toString();
                log.info(`[XTTS] ${output.trim()}`);

                const match = output.match(/Duration: ([\d.]+)/);
                if (match) duration = parseFloat(match[1]);
            });

            process.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            process.on('close', (code) => {
                if (code === 0) {
                    log.success(`✅ [XTTS] Audio generated: ${outputPath} (${duration.toFixed(1)}s)`);
                    resolve({
                        success: true,
                        audio_path: outputPath,
                        duration,
                        engine: 'xtts'
                    });
                } else {
                    reject(new Error(`XTTS failed with code ${code}: ${errorOutput}`));
                }
            });
        });
    }
}

module.exports = { LocalVoiceGenerator };
