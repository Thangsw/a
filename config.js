const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '../../api-config.json');

// Ensure config file exists
if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({
        GEMINI_API_KEYS: [],
        TTS_CONFIG: {
            api_key: '',
            voice_id: '',
            model_id: 'eleven_multilingual_v2'
        }
    }, null, 2));
}

function loadConfig() {
    try {
        const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        console.error("Failed to load config:", e);
        return { GEMINI_API_KEYS: [], TTS_CONFIG: {} };
    }
}

function saveConfig(config) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
        return true;
    } catch (e) {
        console.error("Failed to save config:", e);
        return false;
    }
}

function getRandomKey() {
    const config = loadConfig();
    const keys = config.GEMINI_API_KEYS || [];
    if (keys.length === 0) return null;
    return keys[Math.floor(Math.random() * keys.length)];
}

// TTS Config Functions
function getTTSConfig() {
    const config = loadConfig();
    return config.TTS_CONFIG || {
        api_key: '',
        voice_id: '',
        model_id: 'eleven_multilingual_v2'
    };
}

function saveTTSConfig(ttsConfig) {
    const config = loadConfig();
    config.TTS_CONFIG = {
        ...config.TTS_CONFIG,
        ...ttsConfig
    };
    return saveConfig(config);
}

// Telegram Config Functions
function getTelegramConfig() {
    const config = loadConfig();
    return config.TELEGRAM_CONFIG || {
        token: '',
        chatId: ''
    };
}

function saveTelegramConfig(telegramConfig) {
    const config = loadConfig();
    config.TELEGRAM_CONFIG = {
        ...config.TELEGRAM_CONFIG,
        ...telegramConfig
    };
    return saveConfig(config);
}

// Proxy Config Functions
function getProxies() {
    const config = loadConfig();
    return config.PROXIES || [];
}

function saveProxies(proxies) {
    const config = loadConfig();
    config.PROXIES = Array.isArray(proxies) ? proxies : [];
    return saveConfig(config);
}

module.exports = { loadConfig, saveConfig, getRandomKey, getTTSConfig, saveTTSConfig, getTelegramConfig, saveTelegramConfig, getProxies, saveProxies };

