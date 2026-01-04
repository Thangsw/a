/**
 * GenAI Labs Voice Generator Module
 * Provider: genaipro.vn (ElevenLabs proxy)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const WebSocket = require('ws');

const DATA_FILE = path.join(__dirname, '../../data/genai-data.json');
const GENAI_BASE_URL = 'https://genaipro.vn/api/v1';

// Default settings (fixed)
const DEFAULT_SETTINGS = {
    similarity: 0.75,
    speed: 1,
    stability: 0.5,
    style: 0
};

// ============================================
// DATA MANAGEMENT
// ============================================

function loadGenAIData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            // Ensure migration from single token to tokens array
            if (data.jwt_token && (!data.jwt_tokens || data.jwt_tokens.length === 0)) {
                data.jwt_tokens = [data.jwt_token];
            }
            if (!data.jwt_tokens) data.jwt_tokens = [];
            return data;
        }
    } catch (e) {
        console.error('[GenAI] Error loading data:', e.message);
    }
    return {
        jwt_tokens: [],
        default_voice_id: '',
        model_id: 'eleven_multilingual_v2',
        saved_voices: [],
        settings: DEFAULT_SETTINGS
    };
}

function saveGenAIData(data) {
    try {
        // Ensure settings are always present
        if (!data.settings) {
            data.settings = DEFAULT_SETTINGS;
        }
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('[GenAI] Error saving data:', e.message);
        return false;
    }
}

function getJwtToken() {
    const data = loadGenAIData();
    if (data.jwt_tokens && data.jwt_tokens.length > 0) {
        return data.jwt_tokens[0];
    }
    return data.jwt_token || '';
}

// ============================================
// HTTP HELPERS
// ============================================

function makeRequest(method, endpoint, body = null, tokenOverride = null) {
    return new Promise((resolve, reject) => {
        const token = tokenOverride || getJwtToken();
        if (!token) {
            return reject(new Error('GenAI JWT Token not configured'));
        }

        const url = new URL(endpoint.startsWith('http') ? endpoint : `${GENAI_BASE_URL}${endpoint}`);
        const options = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname + url.search,
            method: method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
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
                // Follow redirect
                return downloadFile(response.headers.location, destPath)
                    .then(resolve)
                    .catch(reject);
            }

            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve(destPath);
            });
        }).on('error', (err) => {
            fs.unlink(destPath, () => { }); // Delete incomplete file
            reject(err);
        });
    });
}

// ============================================
// API FUNCTIONS
// ============================================

/**
 * Check user credits/balance
 */
async function getCredits(tokenOverride = null) {
    try {
        console.log('[GenAI] Checking credits...');
        const result = await makeRequest('GET', '/me', null, tokenOverride);
        console.log('[GenAI] Credits response:', JSON.stringify(result).substring(0, 200));

        // Handle error response from API
        if (result.error || result.statusCode >= 400) {
            return { success: false, error: result.error || `HTTP ${result.statusCode}` };
        }

        // Get credits from credits array (API returns balance=0 but credits[0].amount has actual value)
        let totalCredits = result.balance || 0;
        if (result.credits && Array.isArray(result.credits) && result.credits.length > 0) {
            totalCredits = result.credits.reduce((sum, c) => sum + (c.amount || 0), 0);
        }

        return {
            success: true,
            balance: totalCredits,
            credits: result.credits || []
        };
    } catch (e) {
        console.error('[GenAI] Credits error:', e.message);
        return { success: false, error: e.message };
    }
}
/**
 * Get available voices
 */
async function getVoices(filters = {}, tokenOverride = null) {
    try {
        const params = new URLSearchParams({
            page: filters.page || 0,
            page_size: filters.page_size || 30,
            ...filters
        });
        const result = await makeRequest('GET', `/labs/voices?${params}`, null, tokenOverride);
        return {
            success: true,
            voices: result.voices || [],
            total: result.total || 0
        };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Create TTS task
 */
async function createTask(text, voiceId, options = {}, tokenOverride = null) {
    const data = loadGenAIData();
    const settings = data.settings || DEFAULT_SETTINGS;

    // PACING: Insert breaks for natural flow (Refined to avoid duplicates)
    const pacingText = text
        .replace(/\.(?!\s*<break)/g, '. <break time="0.5s" />')
        .replace(/[\!\?](?!\s*<break)/g, '$& <break time="0.5s" />')
        .replace(/,(?!\s*<break)/g, ', <break time="0.3s" />')
        .replace(/\.\.\.(?!\s*<break)/g, '... <break time="0.7s" />');

    const body = {
        input: pacingText,
        voice_id: voiceId || data.default_voice_id,
        model_id: options.model_id || data.model_id || 'eleven_multilingual_v2',
        similarity: settings.similarity,
        speed: settings.speed,
        stability: settings.stability,
        style: settings.style,
        use_speaker_boost: options.use_speaker_boost || false
    };

    try {
        console.log(`[GenAI] Creating task for ${text.length} chars...`);
        const result = await makeRequest('POST', '/labs/task', body, tokenOverride);

        if (result.task_id) {
            return { success: true, task_id: result.task_id };
        } else {
            return { success: false, error: result.error || 'Unknown error' };
        }
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Get task status
 */
async function getTaskStatus(taskId, tokenOverride = null) {
    try {
        const result = await makeRequest('GET', `/labs/task/${taskId}`, null, tokenOverride);
        return {
            success: true,
            status: result.status,
            result: result.result,      // MP3 URL
            subtitle: result.subtitle,  // SRT URL
            data: result
        };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Export subtitle for task
 */
async function exportSubtitle(taskId, options = {}, tokenOverride = null) {
    const body = {
        max_characters_per_line: options.max_chars || 40,
        max_lines_per_cue: options.max_lines || 2,
        max_seconds_per_cue: options.max_seconds || 5
    };

    try {
        await makeRequest('POST', `/labs/task/subtitle/${taskId}`, body, tokenOverride);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Full TTS flow: Create task, poll until complete, download MP3 + SRT
 */
async function generateVoice(text, filename, outputDir, voiceId, options = {}, onProgress = null, tokenOverride = null) {
    const startTime = Date.now();
    const wsToken = tokenOverride || getJwtToken();

    if (onProgress) onProgress('creating', 0);
    const task = await createTask(text, voiceId, options, tokenOverride);
    if (!task.success) {
        throw new Error(`Create task failed: ${task.error}`);
    }

    const taskId = task.task_id;
    console.log(`[GenAI] Task created: ${taskId}`);

    // Step 2: Poll for completion & WebSocket Listener
    if (onProgress) onProgress('processing', 10);

    let ws = null;
    let wsCompleted = false;

    // Optional WebSocket for "Real-time" speed
    if (wsToken) {
        try {
            ws = new WebSocket(`wss://genaipro.vn/ws?token=${wsToken}`);
            ws.on('open', () => console.log(`[GenAI] WebSocket connected for Real-time updates.`));
            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.type === 'labs_status_updated' && msg.payload?.task_id === taskId) {
                        const pct = msg.payload.process_percentage || 0;
                        if (onProgress) onProgress('processing (ws)', pct);
                        if (pct >= 100) {
                            console.log(`🚀 [GenAI] WebSocket: Task ${taskId} DONE! (Instant)`);
                            wsCompleted = true;
                        }
                    }
                } catch (e) { /* silent */ }
            });
            ws.on('error', () => { /* fallback to polling */ });
        } catch (e) {
            console.warn(`[GenAI] Failed to init WebSocket: ${e.message}`);
        }
    }

    let attempts = 0;
    const FIRST_WAIT_MS = 300000; // 5 minutes
    const INTERVAL_MS = 120000;  // 2 minutes
    const MAX_TOTAL_TIME_MS = 7200000; // 2 hours
    let taskResult = null;

    // First Wait: 5 Minutes
    if (!wsCompleted) {
        console.log(`[GenAI] Waiting 5 minutes before FIRST status check... (WebSocket is active)`);
        // Use shorter sleeps in a loop to react to WebSocket faster
        const checkSteps = 30; // 300s / 10s
        for (let i = 0; i < checkSteps; i++) {
            if (wsCompleted) break;
            await new Promise(r => setTimeout(r, 10000));
        }
    }

    while (!wsCompleted && (Date.now() - startTime) < MAX_TOTAL_TIME_MS) {
        if (wsCompleted) break;

        const status = await getTaskStatus(taskId, tokenOverride);
        if (!status.success) {
            console.warn(`[GenAI] Failed to get status for ${taskId}, retrying in 2 mins...`);
        } else {
            const pct = status.data?.process_percentage || 0;
            if (status.status === 'completed' || pct >= 100) {
                // IMPORTANT: Ensure result URL is present before breaking
                if (status.result) {
                    taskResult = status;
                    break;
                } else {
                    console.log(`[GenAI] Task marked completed but result URL missing. Waiting...`);
                }
            } else if (status.status === 'failed') {
                if (ws) ws.close();
                throw new Error('Task failed on GenAI server');
            }
            if (onProgress) onProgress('processing', pct || Math.min(95, 10 + attempts * 5));
        }

        attempts++;
        // Wait 2 minutes for next check, but check wsCompleted frequently
        const intervalSteps = 12; // 120s / 10s
        for (let i = 0; i < intervalSteps; i++) {
            if (wsCompleted) break;
            await new Promise(r => setTimeout(r, 10000));
        }
    }

    // Always close WS
    if (ws) ws.close();

    // If WebSocket finished but taskResult is null OR result URL missing, we need to fetch one last time (with retries)
    if (!taskResult || !taskResult.result) {
        let finalAttempts = 0;
        const maxFinalRetries = 10; // Try 10 times with 3s delay each

        while (finalAttempts < maxFinalRetries) {
            const finalCheck = await getTaskStatus(taskId, tokenOverride);
            if (finalCheck.success && (finalCheck.status === 'completed' || (finalCheck.data?.process_percentage >= 100))) {
                if (finalCheck.result) {
                    taskResult = finalCheck;
                    break;
                } else {
                    console.log(`[GenAI] Final check #${finalAttempts + 1}: result URL still missing...`);
                }
            }
            finalAttempts++;
            await new Promise(r => setTimeout(r, 3000));
        }
    }

    if (!taskResult || (!taskResult.result && !taskResult.subtitle)) {
        throw new Error('Task timed out or completed without result files');
    }

    console.log(`[GenAI] Task completed in ${(Date.now() - startTime) / 1000}s`);

    // Step 3: Request subtitle export (Only if not already provided)
    if (!taskResult.subtitle) {
        if (onProgress) onProgress('exporting_subtitle', 92);
        try {
            await exportSubtitle(taskId, {}, tokenOverride);
            // Wait a bit for subtitle to be ready
            let subRetry = 0;
            while (subRetry < 5) {
                const subCheck = await getTaskStatus(taskId, tokenOverride);
                if (subCheck.subtitle) {
                    taskResult.subtitle = subCheck.subtitle;
                    break;
                }
                subRetry++;
                await new Promise(r => setTimeout(r, 3000));
            }
        } catch (e) {
            console.warn(`[GenAI] Subtitle export failed: ${e.message}`);
        }
    }

    const finalStatus = taskResult;

    // Step 4: Download files
    if (onProgress) onProgress('downloading', 95);

    // Ensure output directory exists (absolute path)
    const absoluteOutputDir = path.resolve(outputDir);
    if (!fs.existsSync(absoluteOutputDir)) {
        fs.mkdirSync(absoluteOutputDir, { recursive: true });
    }

    const mp3Path = path.join(absoluteOutputDir, `${filename}.mp3`);
    const srtPath = path.join(absoluteOutputDir, `${filename}.srt`);

    // Download MP3
    if (finalStatus.result) {
        console.log(`[GenAI] Downloading MP3 from: ${finalStatus.result}`);
        await downloadFile(finalStatus.result, mp3Path);
        if (!fs.existsSync(mp3Path)) throw new Error('MP3 download appeared to succeed but file does not exist');
        console.log(`[GenAI] Saved MP3: ${mp3Path} (${fs.statSync(mp3Path).size} bytes)`);
    } else {
        throw new Error('No MP3 URL found in final task status');
    }

    // Download SRT if available
    if (finalStatus.subtitle) {
        console.log(`[GenAI] Downloading SRT from: ${finalStatus.subtitle}`);
        await downloadFile(finalStatus.subtitle, srtPath);
        console.log(`[GenAI] Saved SRT: ${srtPath}`);
    }

    if (onProgress) onProgress('completed', 100);

    // Get duration from MP3
    const duration = await getAudioDuration(mp3Path);

    return {
        success: true,
        mp3_path: mp3Path,
        srt_path: fs.existsSync(srtPath) ? srtPath : null,
        duration: duration,
        task_id: taskId
    };
}

/**
 * Get audio duration using mp3-duration (No ffprobe required)
 */
async function getAudioDuration(filePath) {
    try {
        const mp3Duration = require('mp3-duration');
        return await new Promise((resolve) => {
            mp3Duration(filePath, (err, duration) => {
                if (err) {
                    console.warn(`[GenAI] Duration check failed: ${err.message}`);
                    return resolve(60); // Return 60 on error
                }
                resolve(duration);
            });
        });
    } catch (e) {
        console.error('[GenAI] Failed to load mp3-duration:', e.message);
        // Fallback: estimate from file size (rough: ~16kB per second for MP3 128kbps)
        try {
            const stats = fs.statSync(filePath);
            return stats.size / 16000;
        } catch {
            return 60; // Default fallback
        }
    }
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
    loadGenAIData,
    saveGenAIData,
    getCredits,
    getVoices,
    createTask,
    getTaskStatus,
    exportSubtitle,
    generateVoice,
    getAudioDuration
};
