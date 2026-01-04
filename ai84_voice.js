/**
 * AI84.pro Voice Generator Module
 * Provider: ai84.pro (ElevenLabs proxy)
 * 
 * Documentation Highlights:
 * - Base URL: https://api.ai84.pro
 * - Auth: xi-api-key header
 * - Async TTS: POST /v2/text-to-speech/async
 * - Status Check: GET /v1/task/:task_id (or GET /v2/text-to-speech/async/:job_id)
 * - Credits: GET /v1/credits
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const ai84Automation = require('./ai84_automation'); // Import UI listener

const DATA_FILE = path.join(__dirname, '../../data/ai84_data.json');
const AI84_BASE_URL = 'https://api.ai84.pro';

// Default settings (Optimized for Cold/Analytical style - V10)
const DEFAULT_SETTINGS = {
    similarity: 0.75, // User requested
    speed: 1.0,
    stability: 0.26, // User requested
    style: 0,
    use_speaker_boost: true
};

// ============================================
// DATA MANAGEMENT
10. // ============================================

function loadAI84Data() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('[AI84] Error loading data:', e.message);
    }
    return {
        api_keys: [],
        default_voice_id: '',
        model_id: 'eleven_flash_v2_5',
        saved_voices: [],
        settings: DEFAULT_SETTINGS
    };
}

function saveAI84Data(data) {
    try {
        if (!data.settings) data.settings = DEFAULT_SETTINGS;
        const dir = path.dirname(DATA_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('[AI84] Error saving data:', e.message);
        return false;
    }
}

function getApiKey() {
    const data = loadAI84Data();
    if (data.api_keys && data.api_keys.length > 0) {
        return data.api_keys[0];
    }
    return '';
}

// ============================================
// HTTP HELPERS
// ============================================

function makeRequest(method, endpoint, body = null, keyOverride = null) {
    return new Promise((resolve, reject) => {
        const apiKey = keyOverride || getApiKey();
        if (!apiKey) {
            return reject(new Error('AI84 API Key not configured'));
        }

        const url = new URL(endpoint.startsWith('http') ? endpoint : `${AI84_BASE_URL}${endpoint}`);
        const options = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname + url.search,
            method: method,
            headers: {
                'xi-api-key': apiKey,
                'Content-Type': 'application/json'
            }
        };

        const protocol = url.protocol === 'https:' ? https : http;
        const req = protocol.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json);
                } catch (e) {
                    resolve({ raw: data, statusCode: res.statusCode });
                }
            });
        });

        req.on('error', reject);

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

async function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        const protocol = url.startsWith('https') ? https : http;

        protocol.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
            }
            if (response.statusCode >= 400) {
                return reject(new Error(`HTTP ${response.statusCode} while downloading`));
            }

            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve(destPath);
            });
        }).on('error', (err) => {
            fs.unlink(destPath, () => { });
            reject(err);
        });
    });
}

// ============================================
// API FUNCTIONS
// ============================================

async function getCredits(keyOverride = null) {
    try {
        const result = await makeRequest('GET', '/v1/credits', null, keyOverride);
        if (result.success) {
            return { success: true, credits: result.credits };
        }
        return { success: false, error: result.error || 'Failed to fetch credits' };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function getVoices(keyOverride = null) {
    try {
        // AI84 documentation doesn't show a clear /voices endpoint for ElevenLabs proxy, 
        // but typically it's /v1/voices or they use /v1/models.
        // Let's assume /v1/voices exists as it's common.
        const result = await makeRequest('GET', '/v1/voices', null, keyOverride);
        return { success: true, voices: result.voices || result.data || [] };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function createTask(text, voiceId, options = {}, keyOverride = null) {
    const data = loadAI84Data();
    const body = {
        text: text.replace(/\.(?!\s*<break)/g, '. <break time="0.5s" />'), // User requested pacing - Refined to avoid duplicates
        voice_id: voiceId || data.default_voice_id,
        model_id: options.model_id || data.model_id || 'eleven_flash_v2_5',
        with_transcript: true,
        voice_settings: {
            stability: data.settings.stability,
            similarity_boost: data.settings.similarity,
            style: data.settings.style,
            speed: data.settings.speed,
            use_speaker_boost: data.settings.use_speaker_boost || true
        }
    };

    try {
        const result = await makeRequest('POST', '/v2/text-to-speech/async', body, keyOverride);
        if (result.success && result.job_id) {
            return { success: true, task_id: result.job_id };
        }
        return { success: false, error: result.error || 'Task creation failed' };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function getTaskStatus(taskId, keyOverride = null, useUIWatch = true, expectedText = null) {
    if (useUIWatch) {
        try {
            return await ai84Automation.watchTask(taskId, expectedText);
        } catch (e) {
            console.warn(`[AI84] UI Watch failed, falling back to API polling: ${e.message}`);
        }
    }

    try {
        // Fallback or explicit API polling
        const result = await makeRequest('GET', '/v1/tasks?page=1&limit=20&type=tts', null, keyOverride);

        if (result.success && Array.isArray(result.data)) {
            // Find by ID OR by Text match (handle potential ID mismatch in UI/API sync)
            const task = result.data.find(t => {
                const idMatch = t.id === taskId;
                const cleanTarget = expectedText ? expectedText.replace(/<[^>]*>/g, '').substring(0, 50) : '';
                const cleanSource = t.metadata?.text ? t.metadata.text.replace(/<[^>]*>/g, '').substring(0, 50) : '';
                const textMatch = expectedText && cleanSource.includes(cleanTarget);
                return idMatch || textMatch;
            });

            if (task) {
                return {
                    success: true,
                    status: task.status, // "processing", "done", "failed"
                    progress: task.progress || 0,
                    audio_url: task.metadata?.audio_url,
                    srt_url: task.metadata?.transcript_url || task.metadata?.srt_url,
                    error: task.error_message
                };
            }
            // Log for debug if not found
            const topIds = result.data.slice(0, 3).map(t => t.id).join(', ');
            console.log(`   [AI84-API] Task ${taskId.substring(0, 8)} not in list. Matching by text... Top current IDs: ${topIds}`);
            return { success: false, error: 'Task not found in list yet' };
        }
        return { success: false, error: result.error || 'Failed to fetch task list' };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Full flow similar to genai_voice
 */
async function generateVoice(text, filename, outputDir, voiceId, options = {}, onProgress = null, keyOverride = null) {
    const startTime = Date.now();

    // 1. Ensure browser is open and on the right page BEFORE creating the task
    // This allows the listener to be ready to catch the first response.
    try {
        await ai84Automation.ensureBrowser();
    } catch (e) {
        // Silent
    }

    if (onProgress) onProgress('creating', 0);
    const task = await createTask(text, voiceId, options, keyOverride);
    if (!task.success) throw new Error(`Create task failed: ${task.error}`);

    const taskId = task.task_id;
    console.log(`[AI84] Task created: ${taskId}. Listening for result...`);

    if (onProgress) onProgress('processing', 10);

    const MAX_TOTAL_TIME_MS = 3600000; // 1 hour
    let finalResult = null;

    while ((Date.now() - startTime) < MAX_TOTAL_TIME_MS) {
        // FAST POLLING: Every 15-20s to ensure we don't miss the 'done' state
        const status = await getTaskStatus(taskId, keyOverride, true, text);

        if (status.success) {
            const progressStr = status.progress !== undefined ? `${status.progress}%` : 'N/A';
            console.log(`   [AI84] Status: ${status.status}, Progress: ${progressStr}`);

            if (status.status === 'done' || status.status === 'completed') {
                if (status.audio_url) {
                    finalResult = status;
                    break;
                }
            } else if (status.status === 'failed') {
                throw new Error(`Task failed on AI84 server: ${status.error || 'Unknown error'}`);
            }

            if (onProgress && status.progress !== undefined) {
                const internalProgress = 10 + (status.progress * 0.85);
                onProgress('processing', Math.round(internalProgress));
            }
        }

        // Wait significantly less (15s) for better responsiveness
        await new Promise(r => setTimeout(r, 15000));
    }

    if (!finalResult) throw new Error('Task timed out or failed to return audio URL');

    if (onProgress) onProgress('downloading', 95);

    const absoluteOutputDir = path.resolve(outputDir);
    if (!fs.existsSync(absoluteOutputDir)) fs.mkdirSync(absoluteOutputDir, { recursive: true });

    const mp3Path = path.join(absoluteOutputDir, `${filename}.mp3`);
    const srtPath = path.join(absoluteOutputDir, `${filename}.srt`);

    console.log(`[AI84] Downloading files for task ${taskId}...`);
    await downloadFile(finalResult.audio_url, mp3Path);
    if (finalResult.srt_url) {
        await downloadFile(finalResult.srt_url, srtPath);
    }

    const duration = await getAudioDuration(mp3Path);
    if (onProgress) onProgress('completed', 100);

    return {
        success: true,
        mp3_path: mp3Path,
        srt_path: fs.existsSync(srtPath) ? srtPath : null,
        duration: duration,
        task_id: taskId
    };
}

async function getAudioDuration(filePath) {
    try {
        const mp3Duration = require('mp3-duration');
        return await new Promise((resolve) => {
            mp3Duration(filePath, (err, duration) => {
                if (err) resolve(stats.size / 16000);
                else resolve(duration);
            });
        });
    } catch (e) {
        try {
            const stats = fs.statSync(filePath);
            return stats.size / 16000;
        } catch {
            return 60;
        }
    }
}

module.exports = {
    loadAI84Data,
    saveAI84Data,
    getCredits,
    getVoices,
    createTask,
    getTaskStatus,
    generateVoice,
    getAudioDuration
};
