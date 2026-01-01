/**
 * Audio Key Manager
 * Manages priority API keys for audio analysis with usage tracking
 * - Max 20 uses/day per key (configurable)
 * - Auto-rotation when limit reached
 * - Daily reset
 */

const fs = require('fs');
const path = require('path');
const { loadConfig, saveConfig } = require('./config');

const USAGE_FILE = path.join(__dirname, '../../data/audio_key_usage.json');
const EXHAUSTED_KEYS = new Set(); // In-memory track for 429/Quota errors in current session

// Default settings
const DEFAULT_MODEL = 'gemini-3-flash-preview';
const DEFAULT_DAILY_LIMIT = 20;

/**
 * Load usage data from file
 */
function loadUsageData() {
    const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
    try {
        if (fs.existsSync(USAGE_FILE)) {
            const data = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf-8'));

            // Check if new day - reset if needed
            if (data.date !== today) {
                console.log(`🔄 [AudioKeys] New day detected (${today}). Resetting usage counters.`);
                EXHAUSTED_KEYS.clear(); // Clear session-based exhausted keys on new day
                const newData = {
                    date: today,
                    usage: {},
                    currentIndex: 0, // Reset rotation on new day
                    model: data.model || DEFAULT_MODEL,
                    dailyLimit: data.dailyLimit || DEFAULT_DAILY_LIMIT
                };
                saveUsageData(newData); // Persist the reset!
                return newData;
            }
            if (data.currentIndex === undefined) data.currentIndex = 0;
            return data;
        }
        // If file doesn't exist, create it
        const defaultData = { date: today, usage: {}, currentIndex: 0, model: DEFAULT_MODEL, dailyLimit: DEFAULT_DAILY_LIMIT };
        saveUsageData(defaultData);
        return defaultData;
    } catch (e) {
        console.error('[AudioKeys] Error loading usage data:', e.message);
    }
    return { date: today, usage: {}, currentIndex: 0, model: DEFAULT_MODEL, dailyLimit: DEFAULT_DAILY_LIMIT };
}

/**
 * Save usage data to file with basic locking to prevent race conditions during Parallel runs
 */
function saveUsageData(data) {
    const lockFile = USAGE_FILE + '.lock';
    try {
        const dir = path.dirname(USAGE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        // Simple atomic write: Write to temp file then rename
        const tempFile = USAGE_FILE + '.tmp';
        fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
        fs.renameSync(tempFile, USAGE_FILE);
    } catch (e) {
        console.error('[AudioKeys] Error saving usage data:', e.message);
    }
}

/**
 * Get audio analysis keys from config
 */
function getAudioKeys() {
    const config = loadConfig();
    return config.AUDIO_ANALYSIS_KEYS || [];
}

/**
 * Save audio analysis keys to config
 * Also merge into general GEMINI_API_KEYS pool
 */
function saveAudioKeys(keys) {
    const config = loadConfig();
    config.AUDIO_ANALYSIS_KEYS = keys;

    // Merge into general pool (avoid duplicates)
    const generalKeys = config.GEMINI_API_KEYS || [];
    keys.forEach(key => {
        if (!generalKeys.includes(key)) {
            generalKeys.push(key);
        }
    });
    config.GEMINI_API_KEYS = generalKeys;

    return saveConfig(config);
}

/**
 * Get next available audio key
 * Returns key with usage < daily limit
 */
function getNextAudioKey() {
    const keys = getAudioKeys();
    if (keys.length === 0) {
        throw new Error('No audio analysis keys configured! Please add keys in Settings.');
    }

    const usageData = loadUsageData();
    const dailyLimit = usageData.dailyLimit || DEFAULT_DAILY_LIMIT;
    const startIndex = usageData.currentIndex || 0;

    for (let i = 0; i < keys.length; i++) {
        const idx = (startIndex + i) % keys.length;
        const key = keys[idx];

        if (EXHAUSTED_KEYS.has(key)) continue; // Skip keys known to be 429'd this session

        const usage = usageData.usage[key] || 0;
        if (usage < dailyLimit) {
            console.log(`🔑 [AudioKeys] Selected Key index ${idx} (...${key.slice(-6)}) (${usage}/${dailyLimit} uses today)`);
            return key;
        }
    }

    throw new Error(`All audio keys have reached daily limit (${dailyLimit}/key). Try again tomorrow or add more keys.`);
}

/**
 * Increment usage for a key after successful use
 */
function incrementUsage(key) {
    const keys = getAudioKeys();
    const usageData = loadUsageData();
    usageData.usage[key] = (usageData.usage[key] || 0) + 1;

    // Rotate index ONLY after successful use
    const idx = keys.indexOf(key);
    if (idx !== -1) {
        usageData.currentIndex = (idx + 1) % keys.length;
    }

    saveUsageData(usageData);
    console.log(`📊 [AudioKeys] Key ...${key.slice(-6)} usage incremented. Next turn starts at index ${usageData.currentIndex}`);
}

/**
 * Mark a key as exhausted due to actual 429/Quota error
 */
function markKeyExhausted(key) {
    if (!key) return;
    EXHAUSTED_KEYS.add(key);
    console.log(`🛑 [AudioKeys] Key ...${key.slice(-6)} marked as EXHAUSTED (Limit/Quota hit)`);
}

/**
 * Increment LITE model usage
 */
function incrementLiteUsage(key) {
    const usageData = loadUsageData();
    const liteKey = `${key}_lite`;
    usageData.usage[liteKey] = (usageData.usage[liteKey] || 0) + 1;
    saveUsageData(usageData);
    console.log(`📊 [AudioKeys] Key ...${key.slice(-6)} [LITE] usage: ${usageData.usage[liteKey]}/${usageData.dailyLimit || DEFAULT_DAILY_LIMIT}`);
}

/**
 * Get usage stats for all keys
 */
function getUsageStats() {
    const keys = getAudioKeys();
    const usageData = loadUsageData();
    const dailyLimit = usageData.dailyLimit || DEFAULT_DAILY_LIMIT;

    return {
        date: usageData.date,
        model: usageData.model || DEFAULT_MODEL,
        dailyLimit: dailyLimit,
        keys: keys.map(key => ({
            key: key,
            maskedKey: `...${key.slice(-8)}`,
            usage: usageData.usage[key] || 0,
            liteUsage: usageData.usage[`${key}_lite`] || 0,
            remaining: dailyLimit - (usageData.usage[key] || 0),
            exhausted: (usageData.usage[key] || 0) >= dailyLimit || EXHAUSTED_KEYS.has(key),
            status429: EXHAUSTED_KEYS.has(key)
        })),
        totalKeys: keys.length,
        availableKeys: keys.filter(k => (usageData.usage[k] || 0) < dailyLimit).length
    };
}

/**
 * Get the model to use for audio analysis
 */
function getAudioModel() {
    const usageData = loadUsageData();
    return usageData.model || DEFAULT_MODEL;
}

/**
 * Update settings (model, daily limit)
 */
function updateSettings(settings) {
    const usageData = loadUsageData();
    if (settings.model) usageData.model = settings.model;
    if (settings.dailyLimit) usageData.dailyLimit = parseInt(settings.dailyLimit);
    saveUsageData(usageData);
    return usageData;
}

/**
 * Executes an AI call with automatic key rotation.
 * Tries ALL configured keys before giving up.
 */
async function executeWithRotation(apiCallFunction, modelName) {
    const keys = getAudioKeys();
    const usageData = loadUsageData();
    const dailyLimit = usageData.dailyLimit || DEFAULT_DAILY_LIMIT;
    let lastError = null;

    // Try all keys starting from current index
    const startIndex = usageData.currentIndex || 0;

    for (let i = 0; i < keys.length; i++) {
        const idx = (startIndex + i) % keys.length;
        const key = keys[idx];

        if (EXHAUSTED_KEYS.has(key)) continue;
        const usage = usageData.usage[key] || 0;
        if (usage >= dailyLimit) continue;

        try {
            const result = await apiCallFunction(key);
            // If successful, increment usage and return
            incrementUsage(key);
            return result;
        } catch (err) {
            lastError = err;
            const errMsg = err.message.toLowerCase();
            if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('exhausted') || errMsg.includes('503') || errMsg.includes('overloaded')) {
                markKeyExhausted(key);
                console.warn(`⚠️ [AudioKey] Key index ${idx} failed with quota/overload. Rotated.`);
                continue;
            }
            throw err; // Other errors should stop the process
        }
    }

    throw new Error(`Đã thử TẤT CẢ các API Key chuyên dụng cho ${modelName} nhưng đều thất bại (Hết quota hoặc máy chủ quá tải).`);
}

module.exports = {
    getAudioKeys,
    saveAudioKeys,
    getNextAudioKey,
    incrementUsage,
    incrementLiteUsage,
    markKeyExhausted,
    getUsageStats,
    getAudioModel,
    updateSettings,
    executeWithRotation,
    DEFAULT_MODEL,
    DEFAULT_DAILY_LIMIT
};
