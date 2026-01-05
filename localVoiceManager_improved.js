const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const log = require('./colors').log;

/**
 * Module xử lý Voice Local (Edge-TTS + RVC)
 * Optimized cho GTX 1060 6GB
 *
 * Requirements:
 * - Python 3.9+ với edge-tts installed
 * - RVC (Applio) đã setup
 * - Models đã train trong models/ folder
 */

class LocalVoiceManager {
    constructor(config = {}) {
        // Load config hoặc dùng defaults
        this.pythonPath = config.pythonPath || 'python';
        this.rvcPath = config.rvcPath || path.join(__dirname, '../../local_services/RVC');
        this.modelsPath = config.modelsPath || path.join(this.rvcPath, 'models');
        this.tempDir = config.tempDir || path.join(__dirname, '../../temp/local_voice');

        // Timeouts
        this.edgeTimeout = 60000; // 60s
        this.rvcTimeout = 300000;  // 5 phút (300s)

        // Ensure temp dir exists
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }

        log.info(`[LocalVoice] Initialized with RVC at: ${this.rvcPath}`);
    }

    /**
     * Tạo giọng nói lai (Edge + RVC)
     * @param {string} text Văn bản cần đọc
     * @param {string} edgeVoice Giọng nền Microsoft (ví dụ: de-DE-ConradNeural)
     * @param {string} rvcModel Tên model RVC (folder name)
     * @param {string} outputPath Đường dẫn file kết quả
     * @returns {Promise<{success: boolean, path?: string, duration?: number, error?: string}>}
     */
    async generate(text, edgeVoice, rvcModel, outputPath) {
        const timestamp = Date.now();
        const baseAudioPath = path.join(this.tempDir, `edge_${timestamp}.mp3`);
        const startTime = Date.now();

        try {
            // Validate inputs
            if (!text || text.trim().length === 0) {
                throw new Error('Text cannot be empty');
            }

            // Stage 1: Generate base audio with Edge-TTS
            log.info(`[LocalVoice] Stage 1: Generating base audio with Edge-TTS (${edgeVoice})`);
            await this.runEdgeTTS(text, edgeVoice, baseAudioPath);

            // Verify Edge-TTS output
            if (!fs.existsSync(baseAudioPath) || fs.statSync(baseAudioPath).size === 0) {
                throw new Error('Edge-TTS failed to generate audio');
            }

            log.info(`[LocalVoice] ✅ Edge-TTS completed: ${baseAudioPath}`);

            // Stage 2: Apply RVC voice conversion
            log.info(`[LocalVoice] Stage 2: Applying RVC conversion (${rvcModel})`);
            await this.runRVC(baseAudioPath, rvcModel, outputPath);

            // Verify RVC output
            if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
                throw new Error('RVC failed to generate audio');
            }

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            log.info(`[LocalVoice] ✅ RVC completed: ${outputPath} (${elapsed}s)`);

            // Get audio duration (estimate)
            const duration = await this.getAudioDuration(outputPath);

            // Cleanup temp files
            this.cleanup(baseAudioPath);

            return {
                success: true,
                path: outputPath,
                duration: duration,
                elapsed_time: parseFloat(elapsed)
            };

        } catch (error) {
            log.error(`[LocalVoice] ❌ Error: ${error.message}`);

            // Cleanup on error
            this.cleanup(baseAudioPath);

            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Run Edge-TTS CLI
     */
    runEdgeTTS(text, voice, outputPath) {
        return new Promise((resolve, reject) => {
            // Command: edge-tts --text "..." --voice ... --write-media out.mp3
            const args = [
                '-m', 'edge_tts',
                '--text', text,
                '--voice', voice,
                '--write-media', outputPath
            ];

            log.info(`[Edge-TTS] Executing: ${this.pythonPath} ${args.join(' ')}`);

            const proc = spawn(this.pythonPath, args);
            let stdout = '';
            let stderr = '';

            // Timeout
            const timeout = setTimeout(() => {
                proc.kill('SIGTERM');
                reject(new Error(`Edge-TTS timeout after ${this.edgeTimeout}ms`));
            }, this.edgeTimeout);

            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (code) => {
                clearTimeout(timeout);

                if (code === 0) {
                    log.info(`[Edge-TTS] ✅ Success`);
                    resolve();
                } else {
                    const errorMsg = stderr || stdout || `Exit code ${code}`;
                    log.error(`[Edge-TTS] ❌ Failed: ${errorMsg}`);
                    reject(new Error(`Edge-TTS failed: ${errorMsg}`));
                }
            });

            proc.on('error', (err) => {
                clearTimeout(timeout);
                reject(new Error(`Edge-TTS process error: ${err.message}`));
            });
        });
    }

    /**
     * Run RVC Inference CLI (Applio)
     * Optimized for GTX 1060 6GB
     */
    runRVC(inputPath, modelName, outputPath) {
        return new Promise((resolve, reject) => {
            // Model paths
            const modelDir = path.join(this.modelsPath, modelName);
            const modelPath = path.join(modelDir, 'model.pth');
            const indexPath = path.join(modelDir, 'index.index');

            // Verify model exists
            if (!fs.existsSync(modelPath)) {
                reject(new Error(`Model not found: ${modelPath}`));
                return;
            }

            // Build args (Applio CLI format)
            const args = [
                path.join(this.rvcPath, 'infer_cli.py'),
                '--f0method', 'rmvpe',           // Best quality
                '--input', inputPath,
                '--output', outputPath,
                '--model', modelPath,
                '--device', 'cuda:0',            // Use GPU
                '--is_half', 'True',             // FP16 (save VRAM - important for 1060!)
                '--filter_radius', '3',          // Noise reduction
                '--rms_mix_rate', '0.25'         // 75% RVC, 25% original
            ];

            // Add index if exists (improves quality)
            if (fs.existsSync(indexPath)) {
                args.push('--index', indexPath);
            }

            log.info(`[RVC] Executing: ${this.pythonPath} ${args.join(' ')}`);

            const proc = spawn(this.pythonPath, args, {
                cwd: this.rvcPath
            });

            let stdout = '';
            let stderr = '';

            // Timeout (RVC takes longer)
            const timeout = setTimeout(() => {
                proc.kill('SIGTERM');
                reject(new Error(`RVC timeout after ${this.rvcTimeout}ms`));
            }, this.rvcTimeout);

            proc.stdout.on('data', (data) => {
                const text = data.toString();
                stdout += text;
                // Log progress if available
                if (text.includes('%') || text.includes('Processing')) {
                    log.info(`[RVC] ${text.trim()}`);
                }
            });

            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (code) => {
                clearTimeout(timeout);

                if (code === 0) {
                    log.info(`[RVC] ✅ Success`);
                    resolve();
                } else {
                    const errorMsg = stderr || stdout || `Exit code ${code}`;
                    log.error(`[RVC] ❌ Failed: ${errorMsg}`);

                    // Check for specific errors
                    if (errorMsg.includes('CUDA out of memory') || errorMsg.includes('OOM')) {
                        reject(new Error('RVC failed: GPU out of memory (OOM). Close other apps or reduce batch size.'));
                    } else {
                        reject(new Error(`RVC failed: ${errorMsg}`));
                    }
                }
            });

            proc.on('error', (err) => {
                clearTimeout(timeout);
                reject(new Error(`RVC process error: ${err.message}`));
            });
        });
    }

    /**
     * Get audio duration (estimate or use pydub/ffprobe)
     */
    async getAudioDuration(filePath) {
        // Simple estimate based on file size
        // For better accuracy, use ffprobe or pydub
        try {
            const stats = fs.statSync(filePath);
            const fileSizeKB = stats.size / 1024;

            // Rough estimate: 1 minute ≈ 1MB for compressed audio
            const estimatedDuration = (fileSizeKB / 1024) * 60;

            return Math.round(estimatedDuration);
        } catch (error) {
            log.warn(`[LocalVoice] Could not estimate duration: ${error.message}`);
            return 0;
        }
    }

    /**
     * Cleanup temp files
     */
    cleanup(filePath) {
        try {
            if (filePath && fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                log.info(`[LocalVoice] Cleaned up: ${filePath}`);
            }
        } catch (error) {
            log.warn(`[LocalVoice] Cleanup failed: ${error.message}`);
        }
    }

    /**
     * List available RVC models
     */
    listModels() {
        try {
            if (!fs.existsSync(this.modelsPath)) {
                return [];
            }

            const models = fs.readdirSync(this.modelsPath)
                .filter(item => {
                    const modelDir = path.join(this.modelsPath, item);
                    const modelPath = path.join(modelDir, 'model.pth');
                    return fs.statSync(modelDir).isDirectory() && fs.existsSync(modelPath);
                })
                .map(modelName => {
                    const modelDir = path.join(this.modelsPath, modelName);
                    const modelPath = path.join(modelDir, 'model.pth');
                    const indexPath = path.join(modelDir, 'index.index');

                    return {
                        name: modelName,
                        modelPath: modelPath,
                        hasIndex: fs.existsSync(indexPath),
                        size: this.getFileSize(modelPath)
                    };
                });

            return models;
        } catch (error) {
            log.error(`[LocalVoice] List models failed: ${error.message}`);
            return [];
        }
    }

    /**
     * Get file size in MB
     */
    getFileSize(filePath) {
        try {
            const stats = fs.statSync(filePath);
            return (stats.size / (1024 * 1024)).toFixed(2) + ' MB';
        } catch (error) {
            return 'Unknown';
        }
    }

    /**
     * Verify setup (check if dependencies are available)
     */
    async verify() {
        const results = {
            edgeTTS: false,
            rvc: false,
            models: []
        };

        // Check Edge-TTS
        try {
            await this.runCommand(this.pythonPath, ['-m', 'edge_tts', '--version'], 5000);
            results.edgeTTS = true;
            log.info('[LocalVoice] ✅ Edge-TTS is available');
        } catch (error) {
            log.error('[LocalVoice] ❌ Edge-TTS not available:', error.message);
        }

        // Check RVC
        const rvcCli = path.join(this.rvcPath, 'infer_cli.py');
        if (fs.existsSync(rvcCli)) {
            results.rvc = true;
            log.info('[LocalVoice] ✅ RVC is available');
        } else {
            log.error('[LocalVoice] ❌ RVC not found at:', rvcCli);
        }

        // List models
        results.models = this.listModels();
        log.info(`[LocalVoice] Found ${results.models.length} RVC models`);

        return results;
    }

    /**
     * Helper: Run command with timeout
     */
    runCommand(command, args, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const proc = spawn(command, args);
            let output = '';

            const timer = setTimeout(() => {
                proc.kill();
                reject(new Error('Command timeout'));
            }, timeout);

            proc.stdout.on('data', (data) => {
                output += data.toString();
            });

            proc.stderr.on('data', (data) => {
                output += data.toString();
            });

            proc.on('close', (code) => {
                clearTimeout(timer);
                if (code === 0) {
                    resolve(output);
                } else {
                    reject(new Error(output || `Exit code ${code}`));
                }
            });

            proc.on('error', (err) => {
                clearTimeout(timer);
                reject(err);
            });
        });
    }
}

// Export singleton instance
module.exports = new LocalVoiceManager();

// Export class for custom instances
module.exports.LocalVoiceManager = LocalVoiceManager;
